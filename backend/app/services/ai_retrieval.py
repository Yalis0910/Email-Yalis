import re
from typing import Dict, Any, List, Optional, Tuple
from app.database import get_db
from app.services.trade_terms import expand_trade_keywords

def extract_keyword_window(text: str, keywords: List[str], window_size: int = 500) -> str:
    """Extracts a sliding text window centered around the first matching keyword instead of arbitrary prefix."""
    if not text:
        return ""
    clean = text.strip().replace("\r", " ").replace("\n", " ")
    if len(clean) <= window_size:
        return clean
    lower_text = clean.lower()
    best_pos = -1
    for kw in keywords:
        if not kw or len(kw) < 2:
            continue
        pos = lower_text.find(kw.lower())
        if pos != -1 and (best_pos == -1 or pos < best_pos):
            best_pos = pos
    if best_pos == -1:
        return clean[:window_size] + "..."
    lead_in = min(int(window_size * 0.2), 60)
    start = max(0, best_pos - lead_in)
    end = min(len(clean), start + window_size)
    snip = clean[start:end].strip()
    prefix = "... " if start > 0 else ""
    suffix = " ..." if end < len(clean) else ""
    return prefix + snip + suffix

def extract_emails(text: str) -> List[str]:
    """Extracts email addresses from text"""
    pattern = r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+'
    found = re.findall(pattern, text)
    seen = set()
    result = []
    for email in found:
        lowered = email.lower()
        if lowered not in seen:
            seen.add(lowered)
            result.append(lowered)
    return result

async def detect_query_intent(query: str, extracted_emails: List[str]) -> Dict[str, bool]:
    """
    Detects if user is asking about:
    - spendings / subscriptions / SaaS costs
    - contacts / communication frequency / specific person
    - specific email content
    """
    q = query.lower()
    financial_keywords = [
        "花了多少", "费用", "支出", "账单", "订阅", "发票", "扣费", "续费", "月费", "年费", 
        "saas", "成本", "消费", "收据", "invoice", "receipt", "subscription", "cost", "spend"
    ]
    contact_keywords = [
        "谁联系我", "往来最频繁", "联系人", "发件人", "收件人", "联系过", "邮件往来", "沟通", 
        "来往", "发信", "发送过", "发过", "写过", "寄过", "收过", "收到过", "回复过", 
        "写信", "发给", "寄给", "张三", "李四", "contact"
    ]

    is_financial = any(kw in q for kw in financial_keywords)
    is_contact = bool(extracted_emails) or any(kw in q for kw in contact_keywords)

    return {
        "financial": is_financial,
        "contact": is_contact,
        "email_content": True
    }

async def search_context_for_query(
    query: str, 
    account_id: Optional[str] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    allowed_account_ids: Optional[List[str]] = None
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    High-precision hybrid retrieval with strict RBAC account isolation:
    1. Entity Extraction: extract emails & match contact names (with multi-turn context support)
    2. Targeted Bi-directional Email & Contact Retrieval: query both inbound & outbound emails directly
    3. Financial & Subscriptions context if intent detected
    4. General FTS5 / LIKE keyword search for email content
    5. Controlled Fallback (strictly avoid irrelevant emails when targeted entity is searched)
    Returns (context_prompt_str, referenced_emails)
    """
    extracted_emails = extract_emails(query)

    # Multi-turn context resolution: if current query has pronoun/anaphoric intent,
    # inspect recent history to extract contacts, emails, or references
    pronoun_markers = [
        "这名", "这位", "该客户", "这个客户", "该联系人", "他", "她", "对方", "这个人", 
        "邮箱是什么", "联系方式", "是谁", "刚才说的", "上面说的", "上次", "丢单客户", "上一笔", "为什么会"
    ]
    has_pronoun = any(p in query for p in pronoun_markers)
    if (has_pronoun or not extracted_emails) and history:
        for h in reversed(history[-3:]):
            h_text = h.get("content", "")
            if not h_text:
                continue
            h_emails = extract_emails(h_text)
            for he in h_emails:
                if he not in extracted_emails:
                    extracted_emails.append(he)

    intent = await detect_query_intent(query, extracted_emails)
    
    context_sections = []
    referenced_emails = []
    existing_ref_ids = set()

    async with get_db() as db:
        if account_id:
            acc_filter = "account_id = ? AND "
            acc_params = [account_id]
        elif allowed_account_ids is not None:
            if not allowed_account_ids:
                return "（当前用户未被分配任何邮箱权限）", []
            placeholders = ",".join("?" for _ in allowed_account_ids)
            acc_filter = f"account_id IN ({placeholders}) AND "
            acc_params = list(allowed_account_ids)
        else:
            acc_filter = ""
            acc_params = []

        # ---------------------------------------------------------
        # 1. Targeted Entity & Contact Search (Priority 1)
        # ---------------------------------------------------------
        targeted_contacts = []
        # Match by extracted email addresses
        for em in extracted_emails:
            c_cur = await db.execute(f"""
                SELECT id, account_id, email, name, domain, inbound_count, outbound_count, 
                       first_interaction, last_interaction, weight
                FROM contacts
                WHERE {acc_filter} (lower(email) = ? OR lower(email) LIKE ?)
                LIMIT 3
            """, acc_params + [em, f"%{em}%"])
            c_rows = await c_cur.fetchall()
            for r in c_rows:
                if r["id"] not in [tc["id"] for tc in targeted_contacts]:
                    targeted_contacts.append(r)

        # If no email in query, check if any contact name appears in query or recent history
        if not targeted_contacts:
            all_c_cur = await db.execute(f"""
                SELECT id, account_id, email, name, domain, inbound_count, outbound_count, 
                       first_interaction, last_interaction, weight
                FROM contacts
                WHERE {acc_filter} name IS NOT NULL AND length(name) >= 2
                ORDER BY weight DESC LIMIT 50
            """, acc_params)
            all_c_rows = await all_c_cur.fetchall()
            for r in all_c_rows:
                c_name = r["name"].strip().lower() if r["name"] else ""
                if c_name and c_name in query.lower():
                    targeted_contacts.append(r)
                    if r["email"].lower() not in extracted_emails:
                        extracted_emails.append(r["email"].lower())

            # If still not found and query has anaphoric intent, check recent history for contact names
            if not targeted_contacts and has_pronoun and history:
                for h in reversed(history[-3:]):
                    h_text = (h.get("content", "") or "").lower()
                    for r in all_c_rows:
                        c_name = r["name"].strip().lower() if r["name"] else ""
                        if c_name and len(c_name) >= 3 and c_name in h_text:
                            if r["id"] not in [tc["id"] for tc in targeted_contacts]:
                                targeted_contacts.append(r)
                                if r["email"].lower() not in extracted_emails:
                                    extracted_emails.append(r["email"].lower())
                    if targeted_contacts:
                        break

        # If targeted contacts found, build contact info & check cached AI report
        if targeted_contacts:
            contact_lines = ["【目标联系人画像与档案数据】:"]
            for tc in targeted_contacts:
                contact_lines.append(
                    f"- 姓名: {tc['name'] or '未知'} | 邮箱: {tc['email']} | 机构域名: {tc['domain'] or '未知'}\n"
                    f"  往来总量: {tc['inbound_count'] + tc['outbound_count']} 封 (收到对方来信: {tc['inbound_count']} 封, 我方发出: {tc['outbound_count']} 封)\n"
                    f"  首次互动: {tc['first_interaction'] or '未知'} | 最近互动: {tc['last_interaction'] or '未知'}"
                )
                # Check for cached AI report
                rep_cur = await db.execute("""
                    SELECT report_markdown, summary_tags, updated_at 
                    FROM contact_ai_reports 
                    WHERE contact_id = ? OR contact_email = ?
                    LIMIT 1
                """, (tc["id"], tc["email"]))
                rep_row = await rep_cur.fetchone()
                if rep_row and rep_row["report_markdown"]:
                    rep_snippet = rep_row["report_markdown"]
                    if len(rep_snippet) > 600:
                        rep_snippet = rep_snippet[:600] + "..."
                    contact_lines.append(f"  [该联系人已有 AI 报告要点]: {rep_snippet.strip()}")

            context_sections.append("\n".join(contact_lines))

        # Direct bi-directional email retrieval for targeted email / contacts
        target_email_list = list(set(extracted_emails + [tc["email"].lower() for tc in targeted_contacts]))
        if target_email_list:
            for t_email in target_email_list:
                # Query emails where this contact is either sender OR recipient
                e_cur = await db.execute(f"""
                    SELECT id, account_id, subject, from_name, from_email, to_emails, cc_emails, 
                           date_timestamp, date_str, snippet, body_text
                    FROM emails
                    WHERE {acc_filter} (
                        lower(from_email) = ? 
                        OR lower(from_email) LIKE ? 
                        OR lower(to_emails) LIKE ? 
                        OR lower(cc_emails) LIKE ?
                    )
                    ORDER BY date_timestamp DESC LIMIT 15
                """, acc_params + [t_email, f"%{t_email}%", f"%{t_email}%", f"%{t_email}%"])
                target_emails = await e_cur.fetchall()
                
                if target_emails:
                    email_lines = [f"【与联系人 {t_email} 的直接往来邮件记录（共命中 {len(target_emails)} 封）】:"]
                    for m in target_emails:
                        if m["id"] not in existing_ref_ids:
                            existing_ref_ids.add(m["id"])
                            ref_info = {
                                "id": m["id"],
                                "subject": m["subject"] or "(无主题)",
                                "from": f"{m['from_name']} <{m['from_email']}>" if m['from_name'] else m['from_email'],
                                "date": m["date_str"] or ""
                            }
                            referenced_emails.append(ref_info)

                        # Determine communication direction
                        is_outbound = t_email in (m["to_emails"] or "").lower() or t_email in (m["cc_emails"] or "").lower()
                        direction_label = "【我方发出】" if is_outbound else "【对方来信】"

                        body_sample = (m["body_text"] or m["snippet"] or "").strip().replace("\r", " ").replace("\n", " ")
                        if len(body_sample) > 400:
                            body_sample = body_sample[:400] + "..."

                        email_lines.append(
                            f"- [REF:{m['id']}|{m['subject'] or '(无主题)'}|{m['date_str']}]\n"
                            f"  方向: {direction_label} | 发件人: {m['from_name'] or ''} <{m['from_email']}> | 收件人: {m['to_emails'] or '未知'}\n"
                            f"  日期: {m['date_str']} | 主题: {m['subject'] or '(无主题)'}\n"
                            f"  内容概要: {body_sample}"
                        )
                    context_sections.append("\n".join(email_lines))

        # ---------------------------------------------------------
        # 2. Financial & Subscriptions context
        # ---------------------------------------------------------
        if intent["financial"]:
            sub_cursor = await db.execute(f"""
                SELECT service_name, currency, amount, cycle, invoice_date, source_email_id 
                FROM subscriptions 
                {"WHERE " + acc_filter[:-5] if acc_filter else ""} 
                ORDER BY amount DESC LIMIT 15
            """, acc_params)
            subs = await sub_cursor.fetchall()
            if subs:
                sub_lines = ["【本地财务与订阅台账数据】:"]
                for s in subs:
                    sub_lines.append(f"- 服务: {s['service_name']} | 金额: {s['currency']} {s['amount']} | 周期: {s['cycle']} | 日期: {s['invoice_date'] or '未知'}")
                context_sections.append("\n".join(sub_lines))

            # Digital assets summary
            asset_cursor = await db.execute(f"""
                SELECT platform_name, category, registered_email, first_detected_at 
                FROM digital_assets 
                {"WHERE " + acc_filter[:-5] if acc_filter else ""} 
                LIMIT 15
            """, acc_params)
            assets = await asset_cursor.fetchall()
            if assets:
                asset_lines = ["【已登记的数字资产与 SaaS 账号】:"]
                for a in assets:
                    asset_lines.append(f"- 平台: {a['platform_name']} ({a['category']}) | 注册邮箱: {a['registered_email']} | 首次发现: {a['first_detected_at'] or '未知'}")
                context_sections.append("\n".join(asset_lines))

        # ---------------------------------------------------------
        # 3. Contacts summary context (for broad contact intent only)
        # ---------------------------------------------------------
        if intent["contact"] and not target_email_list and not targeted_contacts:
            c_cursor = await db.execute(f"""
                SELECT email, name, inbound_count, outbound_count, last_interaction 
                FROM contacts 
                {"WHERE " + acc_filter[:-5] if acc_filter else ""} 
                ORDER BY (inbound_count + outbound_count) DESC LIMIT 10
            """, acc_params)
            contacts = await c_cursor.fetchall()
            if contacts:
                c_lines = ["【主要往来联系人数据】:"]
                for c in contacts:
                    c_lines.append(f"- 联系人: {c['name'] or '未知'} <{c['email']}> | 收信: {c['inbound_count']} 封 | 发信: {c['outbound_count']} 封 | 最近往来: {c['last_interaction'] or '未知'}")
                context_sections.append("\n".join(c_lines))

        # ---------------------------------------------------------
        # 4. General Keyword Search via FTS5 / LIKE (if fewer than 3 emails found)
        # ---------------------------------------------------------
        if len(referenced_emails) < 3:
            # Strip emails from query to extract meaningful keywords
            clean_q = query
            for em in extracted_emails:
                clean_q = clean_q.replace(em, " ")
            
            # Robust extraction of Chinese words and alphanumeric tokens
            raw_tokens = re.findall(r'[\u4e00-\u9fa5]{2,6}|[a-zA-Z0-9_]{2,}', clean_q)
            stopwords = {
                "请问", "帮我", "一下", "什么", "怎么", "找找", "关于", "最近", "有哪些", "有没有", 
                "这个", "用户", "发送", "邮件", "历史", "内容", "记录", "查询", "邮箱", "查看",
                "谢谢", "可以", "是否", "通知", "谁是", "哪个", "发过", "收过", "发信", "收信"
            }
            search_words = [t for t in raw_tokens if t.lower() not in stopwords and len(t) >= 2]
            expanded_en = expand_trade_keywords(search_words + [clean_q])

            all_fts_tokens = list(search_words[:4])
            for en_term in expanded_en:
                clean_en = en_term.replace('"', '').strip()
                if clean_en and clean_en.lower() not in [x.lower() for x in all_fts_tokens]:
                    all_fts_tokens.append(clean_en)

            matched_emails = []
            if all_fts_tokens:
                fts_query = " OR ".join(f'"{w}"' for w in all_fts_tokens[:8])
                try:
                    if account_id:
                        cursor = await db.execute("""
                            SELECT e.id, e.subject, e.from_name, e.from_email, e.to_emails, e.date_str, e.snippet, e.body_text
                            FROM email_fts f
                            JOIN emails e ON f.id = e.id
                            WHERE f.account_id = ? AND email_fts MATCH ?
                            LIMIT 8
                        """, (account_id, fts_query))
                    elif allowed_account_ids is not None:
                        if not allowed_account_ids:
                            cursor = None
                        else:
                            placeholders = ",".join("?" for _ in allowed_account_ids)
                            cursor = await db.execute(f"""
                                SELECT e.id, e.subject, e.from_name, e.from_email, e.to_emails, e.date_str, e.snippet, e.body_text
                                FROM email_fts f
                                JOIN emails e ON f.id = e.id
                                WHERE f.account_id IN ({placeholders}) AND email_fts MATCH ?
                                LIMIT 8
                            """, list(allowed_account_ids) + [fts_query])
                    else:
                        cursor = await db.execute("""
                            SELECT e.id, e.subject, e.from_name, e.from_email, e.to_emails, e.date_str, e.snippet, e.body_text
                            FROM email_fts f
                            JOIN emails e ON f.id = e.id
                            WHERE email_fts MATCH ?
                            LIMIT 8
                        """, (fts_query,))
                    matched_emails = await cursor.fetchall() if cursor else []
                except Exception:
                    matched_emails = []

            # Fallback LIKE search if FTS yields few results
            candidate_keywords = search_words[:2] + expanded_en[:3]
            if len(matched_emails) < 2 and candidate_keywords:
                like_conditions = []
                params = []
                for kw in candidate_keywords:
                    like_conditions.append("(subject LIKE ? OR snippet LIKE ? OR from_name LIKE ? OR from_email LIKE ? OR to_emails LIKE ?)")
                    params.extend([f"%{kw}%"] * 5)
                like_clause = " OR ".join(like_conditions)

                first_kw = candidate_keywords[0]
                cursor = await db.execute(f"""
                    SELECT id, subject, from_name, from_email, to_emails, date_str, snippet, body_text
                    FROM emails
                    WHERE {acc_filter} ({like_clause})
                    ORDER BY 
                        CASE WHEN lower(subject) LIKE lower(?) THEN 3 ELSE 1 END DESC,
                        date_timestamp DESC 
                    LIMIT 6
                """, acc_params + params + [f"%{first_kw}%"])
                fallback_emails = await cursor.fetchall()
                for f_mail in fallback_emails:
                    if f_mail["id"] not in existing_ref_ids and f_mail["id"] not in [m["id"] for m in matched_emails]:
                        matched_emails.append(f_mail)

            if matched_emails:
                all_snippet_kws = search_words + expanded_en
                general_lines = ["【关键词相关邮件检索结果】:"]
                for m in matched_emails:
                    if m["id"] in existing_ref_ids:
                        continue
                    existing_ref_ids.add(m["id"])
                    ref_info = {
                        "id": m["id"],
                        "subject": m["subject"] or "(无主题)",
                        "from": f"{m['from_name']} <{m['from_email']}>" if m['from_name'] else m['from_email'],
                        "date": m["date_str"] or ""
                    }
                    referenced_emails.append(ref_info)
                    body_sample = extract_keyword_window(m["body_text"] or m["snippet"] or "", all_snippet_kws, window_size=500)
                    general_lines.append(
                        f"- [REF:{m['id']}|{m['subject'] or '(无主题)'}|{m['date_str']}]\n"
                        f"  发件人: {ref_info['from']} | 收件人: {m['to_emails'] if ('to_emails' in m.keys()) else ''} | 日期: {m['date_str']}\n"
                        f"  主题: {m['subject'] or '(无主题)'}\n"
                        f"  内容摘要: {body_sample}"
                    )
                if len(general_lines) > 1:
                    context_sections.append("\n".join(general_lines))

        # ---------------------------------------------------------
        # 5. Controlled Fallback
        # ---------------------------------------------------------
        # CRITICAL: If the user specifically queried about a target entity (email or contact name),
        # and we found ZERO emails, DO NOT pull random recent emails! Instead explicitly record that.
        if target_email_list or targeted_contacts:
            if not referenced_emails:
                target_names = [tc['name'] for tc in targeted_contacts if tc['name']]
                names_str = f" / 姓名: {', '.join(target_names)}" if target_names else ""
                context_sections.append(
                    f"【系统检索明确反馈】：\n"
                    f"系统已精确检索指定目标（邮箱: {', '.join(target_email_list)}{names_str}），"
                    f"但在本地邮件库与往来信件中，未找到与该用户的任何收发信记录。"
                )
        else:
            # Only if this is an open-ended general query and completely empty, pull recent emails
            is_broad_recent_query = any(w in query for w in ["最新", "最近来信", "近况", "收件箱", "未读", "今天", "最近邮件", "近几天"]) and not any(p in query for p in ["这名", "这个", "该", "他是谁", "邮箱是什么", "联系方式", "谁是", "哪位", "为什么", "怎么回事"])
            if not referenced_emails and not context_sections:
                if is_broad_recent_query:
                    cursor = await db.execute(f"""
                        SELECT id, subject, from_name, from_email, to_emails, date_str, snippet, body_text
                        FROM emails
                        {"WHERE " + acc_filter[:-5] if acc_filter else ""}
                        ORDER BY date_timestamp DESC LIMIT 5
                    """, acc_params)
                    recent_emails = await cursor.fetchall()
                    if recent_emails:
                        recent_lines = ["【本地最新接收邮件（通用参考）】:"]
                        for m in recent_emails:
                            if m["id"] not in existing_ref_ids:
                                existing_ref_ids.add(m["id"])
                                ref_info = {
                                    "id": m["id"],
                                    "subject": m["subject"] or "(无主题)",
                                    "from": f"{m['from_name']} <{m['from_email']}>" if m['from_name'] else m['from_email'],
                                    "date": m["date_str"] or ""
                                }
                                referenced_emails.append(ref_info)
                                body_sample = (m["body_text"] or m["snippet"] or "").strip().replace("\r", " ").replace("\n", " ")
                                if len(body_sample) > 300:
                                    body_sample = body_sample[:300] + "..."
                                recent_lines.append(
                                    f"- [REF:{m['id']}|{m['subject'] or '(无主题)'}|{m['date_str']}]\n"
                                    f"  发件人: {ref_info['from']} | 日期: {m['date_str']}\n"
                                    f"  主题: {m['subject'] or '(无主题)'}\n"
                                    f"  内容摘要: {body_sample}"
                                )
                        context_sections.append("\n".join(recent_lines))
                else:
                    context_sections.append(
                        "【系统检索明确反馈】：根据当前提问关键词，在本地邮件库中未检索到直接匹配的收发信记录。"
                    )

    full_context = "\n\n".join(context_sections)
    return full_context, referenced_emails
