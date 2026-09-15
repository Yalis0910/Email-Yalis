import asyncio
import json
import time
import re
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple, AsyncGenerator
import httpx
from app.database import get_db
from app.services.ai_service import AIService

# Domains / senders that are clearly non-commercial / automated system notifications
NON_COMMERCIAL_DOMAINS = {
    "github.com", "gitlab.com", "bitbucket.org", "sentry.io", "datadoghq.com",
    "docker.com", "npm.js", "pypi.org", "cloudflare.com", "vercel.com",
    "netlify.com", "linear.app", "atlassian.net", "jira.com", "trello.com",
    "slack.com", "discord.com", "zoom.us", "google.com", "apple.com",
    "notify.cloudflare.com", "notifications.google.com"
}

NON_COMMERCIAL_PREFIXES = {
    "noreply", "no-reply", "notification", "notifications", "mailer-daemon",
    "postmaster", "alert", "alerts", "billing", "receipts", "newsletter",
    "digest", "system", "updates", "account-security"
}

COMMERCIAL_KEYWORDS = [
    "inquiry", "quote", "quotation", "price", "pricing", "cost", "moq", "rfq",
    "sample", "catalog", "catalogue", "specification", "datasheet", "pi",
    "proforma", "invoice", "payment", "bank", "swift", "deposit", "tt", "l/c",
    "lead time", "delivery", "shipping", "freight", "container", "fob", "cif",
    "exw", "order", "purchase", "po", "contract", "terms", "warranty",
    "询价", "报价", "核价", "样品", "样板", "打样", "起订量", "单价", "形式发票",
    "发票", "订单", "采购", "定金", "首付", "尾款", "水单", "电汇", "合同",
    "交期", "排产", "发货", "海运", "空运", "提单", "装箱单"
]

class SalesService:
    @classmethod
    def is_obvious_system_sender(cls, email: str, name: str = "", user_domains: Optional[set] = None) -> bool:
        """Fast rule-based detection of machine/system/notification senders"""
        email_clean = (email or "").strip().lower()
        if not email_clean or "@" not in email_clean:
            return True
        user_part, domain_part = email_clean.split("@", 1)
        
        # Internal company domain should not be considered generic external system sender
        if user_domains and domain_part in user_domains:
            return False

        if domain_part in NON_COMMERCIAL_DOMAINS:
            return True
        for prefix in NON_COMMERCIAL_PREFIXES:
            if user_part == prefix or user_part.startswith(f"{prefix}-") or user_part.startswith(f"{prefix}_") or user_part.startswith(f"{prefix}+"):
                return True
        return False

    @classmethod
    async def evaluate_contact_tier(
        cls, 
        contact_id: str, 
        force_refresh: bool = False,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Evaluates A/B/C/D customer tier and deal stage for a contact.
        Tier A: 重点战略 (高价值 + 高意向)
        Tier B: 培育增长 (中等价值 + 明确意向)
        Tier C: 广泛孵化 (潜在或低价值)
        Tier D: 其它 (系统通知/日常推销/非商机联系人)
        """
        async with get_db() as db:
            c_cur = await db.execute("""
                SELECT id, account_id, email, name, domain, inbound_count, outbound_count,
                       first_interaction, last_interaction, weight, tier, tier_reason,
                       tier_locked, deal_stage, estimated_value, last_follow_up_at
                FROM contacts WHERE id = ?
            """, (contact_id,))
            contact = await c_cur.fetchone()

        if not contact:
            return {"success": False, "error": "未找到联系人"}

        contact_dict = dict(contact)
        c_email = (contact_dict["email"] or "").strip().lower()

        # If already locked by user and not forced refresh, preserve manual decision
        if contact_dict.get("tier_locked") and not force_refresh:
            return {
                "success": True,
                "contact_id": contact_id,
                "tier": contact_dict.get("tier") or "D",
                "tier_reason": contact_dict.get("tier_reason") or "业务员手动锁定评级",
                "tier_locked": True,
                "deal_stage": contact_dict.get("deal_stage") or "lead",
                "estimated_value": contact_dict.get("estimated_value") or 0.0
            }

        # Step 1: Check internal company address vs obvious system/newsletter sender -> Fast Tier D
        user_emails = set()
        user_domains = set()
        async with get_db() as db:
            acc_cur = await db.execute("SELECT email FROM accounts")
            for a in await acc_cur.fetchall():
                if a["email"]:
                    em = a["email"].lower().strip()
                    user_emails.add(em)
                    if "@" in em:
                        user_domains.add(em.split("@")[1])

        c_domain = (contact_dict.get("domain") or "").lower().strip()
        if c_email in user_emails or (c_domain and c_domain in user_domains):
            tier = "D"
            reason = "内部团队协同账号，非外部客户"
            stage = "lead"
            est_val = 0.0
            async with get_db() as db:
                await db.execute("""
                    UPDATE contacts 
                    SET tier = ?, tier_reason = ?, deal_stage = ?, estimated_value = ?
                    WHERE id = ? AND tier_locked = 0
                """, (tier, reason, stage, est_val, contact_id))
                await db.commit()
            return {
                "success": True,
                "contact_id": contact_id,
                "tier": tier,
                "tier_reason": reason,
                "tier_locked": False,
                "deal_stage": stage,
                "estimated_value": est_val
            }

        if cls.is_obvious_system_sender(c_email, contact_dict.get("name") or "", user_domains=user_domains):
            tier = "D"
            reason = "系统或平台通知账号，非商务客户"
            stage = "lead"
            est_val = 0.0
            async with get_db() as db:
                await db.execute("""
                    UPDATE contacts 
                    SET tier = ?, tier_reason = ?, deal_stage = ?, estimated_value = ?
                    WHERE id = ? AND tier_locked = 0
                """, (tier, reason, stage, est_val, contact_id))
                await db.commit()
            return {
                "success": True,
                "contact_id": contact_id,
                "tier": tier,
                "tier_reason": reason,
                "tier_locked": False,
                "deal_stage": stage,
                "estimated_value": est_val
            }

        # Step 2: Fetch email history (up to 25 emails)
        async with get_db() as db:
            e_cur = await db.execute("""
                SELECT id, subject, from_name, from_email, to_emails, date_str, snippet, body_text, has_attachments
                FROM emails
                WHERE (lower(from_email) = lower(?) OR to_emails LIKE ? OR cc_emails LIKE ?)
                ORDER BY date_timestamp DESC
                LIMIT 25
            """, (c_email, f"%{c_email}%", f"%{c_email}%"))
            emails = await e_cur.fetchall()

            # Query attachments for these emails to find invoices, quotes, POs, specs
            email_ids = [em["id"] for em in emails]
            att_info_list = []
            if email_ids:
                placeholders = ",".join("?" * len(email_ids))
                a_cur = await db.execute(f"""
                    SELECT email_id, filename, file_size, category 
                    FROM attachments 
                    WHERE email_id IN ({placeholders})
                """, email_ids)
                att_rows = await a_cur.fetchall()
                for a in att_rows:
                    att_info_list.append(f"{a['filename']} ({a['category'] or 'file'})")

        if not emails:
            tier = "D"
            reason = "暂无往来邮件正文记录"
            stage = "lead"
            est_val = 0.0
            async with get_db() as db:
                await db.execute("""
                    UPDATE contacts 
                    SET tier = ?, tier_reason = ?, deal_stage = ?, estimated_value = ?
                    WHERE id = ? AND tier_locked = 0
                """, (tier, reason, stage, est_val, contact_id))
                await db.commit()
            return {
                "success": True,
                "contact_id": contact_id,
                "tier": tier,
                "tier_reason": reason,
                "tier_locked": False,
                "deal_stage": stage,
                "estimated_value": est_val
            }

        # Format digest of recent emails
        email_snippets = []
        has_commercial_signals = False
        for em in emails[:15]:
            subj = em["subject"] or "(无主题)"
            snip = (em["body_text"] or em["snippet"] or "")[:260].replace("\n", " ")
            txt_lower = (subj + " " + snip).lower()
            if any(kw in txt_lower for kw in COMMERCIAL_KEYWORDS):
                has_commercial_signals = True
            email_snippets.append(f"- [{em['date_str']}] 主题: 《{subj}》 | 内容片段: {snip}")

        emails_text = "\n".join(email_snippets)
        atts_text = ", ".join(att_info_list[:10]) if att_info_list else "无商业单据附件"

        prompt = f"""你是一位资深的外贸与企业级大客户销售总监及 CRM 数据专家。
请根据下方联系人的历史往来邮件与附件，对该客户进行精准的价值与意向分级评定。

【客户基础信息】：
- 姓名/称呼: {contact_dict['name'] or '未知'}
- 电子邮箱: {contact_dict['email']}
- 机构域名: {contact_dict['domain'] or '未知'}
- 往来信件数: 累计收发 {contact_dict['inbound_count'] + contact_dict['outbound_count']} 封
- 关联附件清单: {atts_text}

【往来邮件核心摘要（最新部分）】：
{emails_text}

【分级评定标准】：
- **A 级 (重点战略客户)**：高价值 + 高意向。特征：明确的采购需求/批量询价、索要形式发票(PI)/索样/合同签订、高客单价或大订单意向、频繁商务交流、已成单或进入实质谈判阶段的大客户。
- **B 级 (培育增长客户)**：中等价值 + 明确意向。特征：对产品/服务有明确兴趣与询盘交流、索要产品目录/报价单、正在进行技术或交期交流、具备明确成单潜力但尚处于推进中的客户。
- **C 级 (广泛孵化客户)**：潜在或低价值。特征：偶发建联、单次简单咨询、暂无明确采购预算或时间表、小批量零售散单或沟通意愿一般。
- **D 级 (其它)**：非商业商机、系统推送、招聘/广告/平台通用通知、日常协作服务商。

【商机生命周期阶段 (deal_stage)】：
可选值之一：'lead'(普通线索) / 'inquiry'(询盘交流) / 'sample'(打样寄样) / 'quote'(报价议价) / 'won'(已成单) / 'lost'(已丢单) / 'stale'(停滞沉睡)

请严格输出如下合法的 JSON 格式（不要有任何额外闲聊）：
```json
{{
  "tier": "A" 或 "B" 或 "C" 或 "D",
  "tier_reason": "一句话精炼概括评级核心依据 (不超过 60 字)",
  "deal_stage": "inquiry",
  "estimated_value": 5000.0
}}
```"""

        base_url, api_key, resolved_model = await AIService.resolve_model_and_credentials(model=model)
        target_url = base_url.rstrip("/")
        if not target_url.endswith("/chat/completions"):
            target_url = f"{target_url}/chat/completions"

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload = {
            "model": resolved_model,
            "messages": [
                {"role": "system", "content": "你是一个严格、客观的 B2B/外贸销售 CRM 客户分级与意向分析系统，只输出合法规范的 JSON。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2
        }

        tier = "C" if has_commercial_signals else "D"
        tier_reason = "基于往来邮件交互与意向关键词初步研判"
        deal_stage = "inquiry" if has_commercial_signals else "lead"
        estimated_val = 0.0

        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                resp = await client.post(target_url, headers=headers, json=payload)
                if resp.status_code == 200:
                    raw_text = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text)
                    clean_json = match.group(1) if match else raw_text.strip()
                    parsed = json.loads(clean_json)
                    if parsed.get("tier") in ["A", "B", "C", "D"]:
                        tier = parsed["tier"]
                    if parsed.get("tier_reason"):
                        tier_reason = parsed["tier_reason"].strip()
                    if parsed.get("deal_stage") in ["lead", "inquiry", "sample", "quote", "won", "lost", "stale"]:
                        deal_stage = parsed["deal_stage"]
                    if parsed.get("estimated_value") is not None:
                        try:
                            estimated_val = float(parsed["estimated_value"])
                        except Exception:
                            pass

                    # Business rule protection: confirmed won clients with frequent exchanges are strategic Tier A
                    total_cnt = (contact_dict.get("inbound_count") or 0) + (contact_dict.get("outbound_count") or 0)
                    if (deal_stage == "won" or contact_dict.get("deal_stage") == "won") and total_cnt >= 15:
                        tier = "A"
                        if not tier_reason or "散单" in tier_reason or "低价值" in tier_reason or "培育" in tier_reason:
                            tier_reason = "已成单且往来交互密切的核心重点战略客户"
        except Exception:
            # Fallback heuristic without leaking raw HTTP/socket errors
            total_cnt = (contact_dict.get("inbound_count") or 0) + (contact_dict.get("outbound_count") or 0)
            if contact_dict.get("deal_stage") == "won" and total_cnt >= 15:
                tier = "A"
                tier_reason = "已成单且往来交互密切的核心重点战略客户（规则引擎研判）"
                deal_stage = "won"
            elif has_commercial_signals and total_cnt >= 6:
                tier = "B"
                tier_reason = "含高频商务询盘与商业往来（规则引擎研判）"
                deal_stage = "inquiry"
            elif has_commercial_signals:
                tier = "C"
                tier_reason = "含商务询价沟通迹象（规则引擎研判）"
                deal_stage = "inquiry"
            else:
                tier = "D"
                tier_reason = "往来信件无显著商务询价或交易意向"
                deal_stage = "lead"

        # Update contacts table
        async with get_db() as db:
            await db.execute("""
                UPDATE contacts 
                SET tier = ?, tier_reason = ?, deal_stage = ?, estimated_value = ?
                WHERE id = ? AND tier_locked = 0
            """, (tier, tier_reason, deal_stage, estimated_val, contact_id))
            await db.commit()

        return {
            "success": True,
            "contact_id": contact_id,
            "tier": tier,
            "tier_reason": tier_reason,
            "tier_locked": False,
            "deal_stage": deal_stage,
            "estimated_value": estimated_val
        }

    @classmethod
    async def update_contact_tier(
        cls,
        contact_id: str,
        tier: str,
        tier_reason: Optional[str] = None,
        tier_locked: bool = False,
        deal_stage: Optional[str] = None,
        estimated_value: Optional[float] = None,
        next_follow_up_due: Optional[str] = None
    ) -> Dict[str, Any]:
        """Manually updates and locks contact tier, stage, or estimated value"""
        async with get_db() as db:
            update_fields = ["tier = ?", "tier_locked = ?"]
            params = [tier.upper(), 1 if tier_locked else 0]

            if tier_reason is not None:
                update_fields.append("tier_reason = ?")
                params.append(tier_reason.strip())
            if deal_stage is not None:
                update_fields.append("deal_stage = ?")
                params.append(deal_stage.strip())
            if estimated_value is not None:
                update_fields.append("estimated_value = ?")
                params.append(float(estimated_value))
            if next_follow_up_due is not None:
                update_fields.append("next_follow_up_due = ?")
                params.append(next_follow_up_due.strip())

            params.append(contact_id)
            await db.execute(f"UPDATE contacts SET {', '.join(update_fields)} WHERE id = ?", params)
            await db.commit()

            c_cur = await db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,))
            row = await c_cur.fetchone()
            return dict(row) if row else {}

    @classmethod
    async def get_tier_stats(cls, account_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Returns counts of contacts by tier (A, B, C, D, unrated, locked) and total contacts.
        """
        async with get_db() as db:
            acc_sql = "WHERE account_id = ?" if account_id else ""
            acc_params = [account_id] if account_id else []

            c_cur = await db.execute(f"""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN tier = 'A' THEN 1 ELSE 0 END) as tier_a,
                    SUM(CASE WHEN tier = 'B' THEN 1 ELSE 0 END) as tier_b,
                    SUM(CASE WHEN tier = 'C' THEN 1 ELSE 0 END) as tier_c,
                    SUM(CASE WHEN tier = 'D' THEN 1 ELSE 0 END) as tier_d,
                    SUM(CASE WHEN tier IS NULL OR tier = '' THEN 1 ELSE 0 END) as unrated,
                    SUM(CASE WHEN tier_locked = 1 THEN 1 ELSE 0 END) as locked_count
                FROM contacts
                {acc_sql}
            """, acc_params)
            row = await c_cur.fetchone()
            row_dict = dict(row) if row else {}
            tier_a = row_dict.get("tier_a", 0) or 0
            tier_b = row_dict.get("tier_b", 0) or 0
            tier_c = row_dict.get("tier_c", 0) or 0
            tier_d = row_dict.get("tier_d", 0) or 0
            return {
                "total": row_dict.get("total", 0) or 0,
                "tier_a": tier_a,
                "tier_b": tier_b,
                "tier_c": tier_c,
                "tier_d": tier_d,
                "tier_counts": {
                    "A": tier_a,
                    "B": tier_b,
                    "C": tier_c,
                    "D": tier_d
                },
                "unrated": row_dict.get("unrated", 0) or 0,
                "locked": row_dict.get("locked_count", 0) or 0
            }

    @classmethod
    async def batch_evaluate_contacts(
        cls, 
        account_id: Optional[str] = None, 
        limit: int = 30,
        mode: str = "all_funnel"
    ) -> AsyncGenerator[str, None]:
        """
        Streams batch evaluation progress for contacts using a smart funnel:
        Modes:
        - all_funnel: Instant rule triage on 100% of contacts, followed by concurrent AI evaluation on top active contacts
        - top_active: Concurrent AI evaluation strictly on top N most active contacts
        - unrated: Evaluates only contacts without a tier
        """
        async with get_db() as db:
            acc_sql = "WHERE account_id = ?" if account_id else ""
            acc_params = [account_id] if account_id else []

            # Fetch user account emails and domains
            user_emails = set()
            user_domains = set()
            acc_cur = await db.execute("SELECT email FROM accounts")
            for a in await acc_cur.fetchall():
                if a["email"]:
                    em = a["email"].lower().strip()
                    user_emails.add(em)
                    if "@" in em:
                        user_domains.add(em.split("@")[1])

            # Query contacts based on mode
            if mode == "unrated":
                where_clause = f"{acc_sql} {'AND' if acc_sql else 'WHERE'} (tier IS NULL OR tier = '')"
            else:
                where_clause = acc_sql

            c_cur = await db.execute(f"""
                SELECT id, account_id, email, name, domain, inbound_count, outbound_count, weight, tier, tier_locked, deal_stage, tier_reason, estimated_value
                FROM contacts
                {where_clause}
                ORDER BY tier_locked ASC, (inbound_count + outbound_count) DESC, weight DESC
            """, acc_params)
            contacts = [dict(r) for r in await c_cur.fetchall()]

        total = len(contacts)
        yield f"data: {json.dumps({'type': 'start', 'total': total, 'mode': mode}, ensure_ascii=False)}\n\n"

        if total == 0:
            yield f"data: {json.dumps({'type': 'done', 'processed': 0, 'total': 0, 'summary': {'A': 0, 'B': 0, 'C': 0, 'D': 0}}, ensure_ascii=False)}\n\n"
            return

        counts = {"A": 0, "B": 0, "C": 0, "D": 0}
        t0 = time.time()

        if mode == "top_active":
            # Only evaluate top N contacts
            target_contacts = contacts[:limit]
            sub_total = len(target_contacts)
            yield f"data: {json.dumps({'type': 'start', 'total': sub_total, 'mode': mode}, ensure_ascii=False)}\n\n"

            sem = asyncio.Semaphore(3)
            processed = 0

            async def eval_single(c_dict):
                if c_dict.get("tier_locked"):
                    curr_t = c_dict.get("tier") or "D"
                    return {
                        "contact_id": c_dict["id"],
                        "email": c_dict["email"],
                        "name": c_dict.get("name") or c_dict["email"].split("@")[0],
                        "tier": curr_t,
                        "tier_reason": c_dict.get("tier_reason") or "业务员手动锁定评级",
                        "deal_stage": c_dict.get("deal_stage") or "lead",
                        "is_fast_rule": True,
                        "locked": True
                    }
                async with sem:
                    res = await cls.evaluate_contact_tier(c_dict["id"], force_refresh=True)
                    return {
                        "contact_id": c_dict["id"],
                        "email": c_dict["email"],
                        "name": c_dict.get("name") or c_dict["email"].split("@")[0],
                        "tier": res.get("tier", "D"),
                        "tier_reason": res.get("tier_reason", ""),
                        "deal_stage": res.get("deal_stage", "lead"),
                        "is_fast_rule": False,
                        "locked": False
                    }

            tasks = [asyncio.create_task(eval_single(c)) for c in target_contacts]
            for f in asyncio.as_completed(tasks):
                res = await f
                assigned_tier = res.get("tier", "D")
                counts[assigned_tier] = counts.get(assigned_tier, 0) + 1
                processed += 1
                yield f"data: {json.dumps({'type': 'progress', 'processed': processed, 'total': sub_total, 'current': res['email'], 'name': res.get('name'), 'tier': assigned_tier, 'reason': res.get('tier_reason'), 'deal_stage': res.get('deal_stage'), 'locked': res.get('locked', False), 'is_fast_rule': res.get('is_fast_rule', False)}, ensure_ascii=False)}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'processed': processed, 'total': sub_total, 'summary': counts, 'duration_seconds': round(time.time() - t0, 1)}, ensure_ascii=False)}\n\n"
            return

        # mode == "all_funnel" or "unrated"
        # Step 1: Multi-stage rule triage
        rule_updates = []
        deep_eval_contacts = []

        for c in contacts:
            if c.get("tier_locked"):
                curr = c.get("tier") or "D"
                counts[curr] = counts.get(curr, 0) + 1
                continue

            c_email = (c.get("email") or "").lower().strip()
            user_part, domain_part = c_email.split("@", 1) if "@" in c_email else (c_email, "")
            inbound = c.get("inbound_count") or 0
            outbound = c.get("outbound_count") or 0
            total_cnt = inbound + outbound
            stage = c.get("deal_stage") or "lead"

            # Rule 1: Internal company account
            if c_email in user_emails or domain_part in user_domains:
                rule_updates.append(("D", "内部团队协同账号，非外部客户", "lead", 0.0, c["id"]))
                counts["D"] += 1
                continue

            # Rule 2: Obvious non-commercial bot / system sender
            if domain_part in NON_COMMERCIAL_DOMAINS or any(user_part == p or user_part.startswith(f"{p}-") or user_part.startswith(f"{p}_") for p in NON_COMMERCIAL_PREFIXES):
                rule_updates.append(("D", "系统或平台通知账号，非商务客户", "lead", 0.0, c["id"]))
                counts["D"] += 1
                continue

            # Rule 3: Confirmed won deal with extensive exchanges
            if stage == "won" and total_cnt >= 15:
                rule_updates.append(("A", "已成单且往来交互密切的核心重点战略客户", "won", c.get("estimated_value") or 0.0, c["id"]))
                counts["A"] += 1
                continue

            # Rule 4: Client never replied (zero inbound)
            if inbound == 0:
                if outbound >= 5:
                    rule_updates.append(("C", "单向主动跟进中，客户尚未回复（孵化阶段）", "lead", 0.0, c["id"]))
                    counts["C"] += 1
                else:
                    rule_updates.append(("D", "单向发出邮件，无客户回信互动", "lead", 0.0, c["id"]))
                    counts["D"] += 1
                continue

            # Rule 5: Very low interactions (total <= 2 emails)
            if total_cnt <= 2:
                rule_updates.append(("C", "偶发咨询线索，交互频次较低", "lead", 0.0, c["id"]))
                counts["C"] += 1
                continue

            deep_eval_contacts.append(c)

        # Batch execute rule updates in DB
        if rule_updates:
            async with get_db() as db:
                await db.executemany("""
                    UPDATE contacts 
                    SET tier = ?, tier_reason = ?, deal_stage = ?, estimated_value = ?
                    WHERE id = ? AND tier_locked = 0
                """, rule_updates)
                await db.commit()

        # Partition deep candidates: top `limit` for LLM concurrency, rest for volume classification
        deep_eval_contacts.sort(key=lambda x: (x.get("inbound_count") or 0) + (x.get("outbound_count") or 0), reverse=True)
        top_candidates = deep_eval_contacts[:limit]
        remaining_candidates = deep_eval_contacts[limit:]

        remaining_updates = []
        for c in remaining_candidates:
            inb = c.get("inbound_count") or 0
            outb = c.get("outbound_count") or 0
            tot = inb + outb
            if inb >= 5 and outb >= 5:
                t = "B"
                r = "持续双向商务沟通客户（基于互动频次研判）"
                s = "inquiry"
            elif tot >= 5:
                t = "C"
                r = "具备稳定双向交流的潜在跟进客户"
                s = "inquiry"
            else:
                t = "C"
                r = "早期建联线索，双向互动频次较低"
                s = "lead"
            counts[t] = counts.get(t, 0) + 1
            remaining_updates.append((t, r, s, c.get("estimated_value") or 0.0, c["id"]))

        if remaining_updates:
            async with get_db() as db:
                await db.executemany("""
                    UPDATE contacts 
                    SET tier = ?, tier_reason = ?, deal_stage = ?, estimated_value = ?
                    WHERE id = ? AND tier_locked = 0
                """, remaining_updates)
                await db.commit()

        fast_classified_count = len(rule_updates) + len(remaining_updates)
        yield f"data: {json.dumps({'type': 'triage', 'total': total, 'fast_classified': fast_classified_count, 'deep_eval_count': len(top_candidates), 'message': f'智能规则漏斗已秒级分类 {fast_classified_count} 个联系人，启动前 {len(top_candidates)} 个核心客户并发深度评估...'}, ensure_ascii=False)}\n\n"

        # Concurrently evaluate top candidates
        sem = asyncio.Semaphore(3)
        processed_ai = 0
        ai_total = len(top_candidates)

        async def eval_candidate(c_dict):
            async with sem:
                res = await cls.evaluate_contact_tier(c_dict["id"], force_refresh=True)
                return {
                    "contact_id": c_dict["id"],
                    "email": c_dict["email"],
                    "name": c_dict.get("name") or c_dict["email"].split("@")[0],
                    "tier": res.get("tier", "D"),
                    "tier_reason": res.get("tier_reason", ""),
                    "deal_stage": res.get("deal_stage", "lead")
                }

        tasks = [asyncio.create_task(eval_candidate(c)) for c in top_candidates]
        for f in asyncio.as_completed(tasks):
            res = await f
            assigned_tier = res.get("tier", "D")
            counts[assigned_tier] = counts.get(assigned_tier, 0) + 1
            processed_ai += 1
            current_total_processed = fast_classified_count + processed_ai
            yield f"data: {json.dumps({'type': 'progress', 'processed': current_total_processed, 'total': total, 'ai_processed': processed_ai, 'ai_total': ai_total, 'current': res['email'], 'name': res.get('name'), 'tier': assigned_tier, 'reason': res.get('tier_reason'), 'deal_stage': res.get('deal_stage'), 'is_deep': True}, ensure_ascii=False)}\n\n"

        # Recalculate final precise counts from database
        final_stats = await cls.get_tier_stats(account_id=account_id)
        final_summary = {
            "A": final_stats.get("tier_a", 0),
            "B": final_stats.get("tier_b", 0),
            "C": final_stats.get("tier_c", 0),
            "D": final_stats.get("tier_d", 0),
        }

        yield f"data: {json.dumps({'type': 'done', 'processed': total, 'total': total, 'summary': final_summary, 'duration_seconds': round(time.time() - t0, 1)}, ensure_ascii=False)}\n\n"

    @classmethod
    async def get_follow_up_radar(cls, account_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Calculates follow-up radar alerts:
        1. A-Tier Stale: Overdue > 3 days
        2. B-Tier Stale: Overdue > 7 days
        3. Unanswered Inbound: Client sent latest email > 24 hours ago, no outbound reply yet
        4. Stagnant Deals: In 'quote' or 'sample' stage with no contact in > 5 days
        """
        now = datetime.now()
        async with get_db() as db:
            acc_filter = "WHERE account_id = ?" if account_id else ""
            acc_params = [account_id] if account_id else []

            # Fetch A & B tier contacts
            c_cur = await db.execute(f"""
                SELECT id, account_id, email, name, domain, tier, tier_reason, deal_stage,
                       estimated_value, inbound_count, outbound_count, last_interaction, last_follow_up_at
                FROM contacts
                {acc_filter}
                ORDER BY (CASE WHEN tier = 'A' THEN 1 WHEN tier = 'B' THEN 2 WHEN tier = 'C' THEN 3 ELSE 4 END),
                         last_interaction DESC
            """, acc_params)
            contacts = await c_cur.fetchall()

            # Also fetch user account email to accurately detect outbound vs inbound
            user_emails = set()
            acc_cur = await db.execute("SELECT email FROM accounts")
            for a in await acc_cur.fetchall():
                if a["email"]:
                    user_emails.add(a["email"].lower().strip())

        SYSTEM_EMAIL_PREFIXES = (
            "mailer-daemon", "postmaster", "noreply", "no-reply", 
            "notifications", "notification", "support", "billing", 
            "bounce", "delivery-subsystem", "mailerdaemon", "daemon"
        )

        urgent_list = []
        warning_list = []
        active_list = []
        all_radar_items = []
        scatter_points = []
        unique_domains = set()

        # Silence bucket counters
        aging_distribution = {
            "under_7d": 0,    # < 7 days
            "7_to_14d": 0,    # 7 - 14 days
            "15_to_30d": 0,   # 15 - 30 days
            "31_to_60d": 0,   # 31 - 60 days
            "over_60d": 0     # > 60 days
        }

        for c in contacts:
            cd = dict(c)
            c_email = cd["email"].lower()
            name_val = cd.get("name") or ""
            name_lower = name_val.lower()

            # Filter out system and bounce noise
            if any(p in c_email for p in SYSTEM_EMAIL_PREFIXES):
                continue
            if "delivery subsystem" in name_lower or "mail delivery" in name_lower or "mailer-daemon" in name_lower:
                continue

            last_date_str = cd.get("last_interaction") or ""
            tier = cd.get("tier") or "D"
            stage = cd.get("deal_stage") or "lead"
            domain = (cd.get("domain") or "").strip()
            inbound_cnt = cd.get("inbound_count") or 0
            outbound_cnt = cd.get("outbound_count") or 0
            email_total = inbound_cnt + outbound_cnt

            if domain and domain not in ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "qq.com", "163.com"]:
                unique_domains.add(domain)

            days_silent = 0
            if last_date_str:
                try:
                    clean_d = last_date_str[:19].replace("T", " ")
                    last_dt = datetime.strptime(clean_d, "%Y-%m-%d %H:%M:%S")
                    days_silent = (now - last_dt).days
                except Exception:
                    try:
                        clean_d = last_date_str[:10]
                        last_dt = datetime.strptime(clean_d, "%Y-%m-%d")
                        days_silent = (now - last_dt).days
                    except Exception:
                        days_silent = 0

            # Categorize aging distribution
            if days_silent < 7:
                aging_distribution["under_7d"] += 1
            elif days_silent <= 14:
                aging_distribution["7_to_14d"] += 1
            elif days_silent <= 30:
                aging_distribution["15_to_30d"] += 1
            elif days_silent <= 60:
                aging_distribution["31_to_60d"] += 1
            else:
                aging_distribution["over_60d"] += 1

            # Determine alert severity
            is_urgent = False
            is_warning = False
            is_active = False
            radar_reason = ""
            action_suggestion = ""

            # Check A tier threshold (3 days)
            if tier == "A":
                if days_silent >= 3:
                    is_urgent = True
                    radar_reason = f"⭐ A类重点战略客户已沉寂 {days_silent} 天未互动"
                    action_suggestion = "建议发送项目进展关怀或原料调价窗口预警，锁住大单排期"
                elif stage in ["quote", "sample"]:
                    is_warning = True
                    radar_reason = f"A类商机处于关键【{stage}】推进期，需密切留意对方决策动态"
                    action_suggestion = "询问样品测试反馈或对报价方案的确认意见"
                else:
                    is_active = True
                    radar_reason = f"A类重点客户近期活跃 (沉寂 {days_silent} 天)"
                    action_suggestion = "沟通顺畅，继续保持定期项目协同与推进"
            elif tier == "B":
                if days_silent >= 7:
                    is_warning = True
                    radar_reason = f"📈 B类培育客户已超 {days_silent} 天无往来"
                    action_suggestion = "可推送最新产品样册或成功案例进行二次促单破冰"
                else:
                    is_active = True
                    radar_reason = f"B类客户保持平稳往来 (沉寂 {days_silent} 天)"
                    action_suggestion = "可按计划推进下一个询盘或产品推荐节点"
            elif tier == "C":
                if days_silent <= 14:
                    is_active = True
                    radar_reason = f"C类潜在客户近期有触达"
                    action_suggestion = "关注客户业务动向，争取挖掘有效询盘需求"

            item = {
                "contact_id": cd["id"],
                "account_id": cd["account_id"],
                "email": cd["email"],
                "name": name_val or cd["email"].split("@")[0],
                "domain": domain,
                "tier": tier,
                "deal_stage": stage,
                "estimated_value": cd.get("estimated_value") or 0.0,
                "inbound_count": inbound_cnt,
                "outbound_count": outbound_cnt,
                "email_total": email_total,
                "days_silent": days_silent,
                "last_interaction": last_date_str,
                "radar_reason": radar_reason,
                "action_suggestion": action_suggestion,
                "urgency": "urgent" if is_urgent else ("warning" if is_warning else "healthy")
            }

            if is_urgent:
                urgent_list.append(item)
                all_radar_items.append(item)
            elif is_warning:
                warning_list.append(item)
                all_radar_items.append(item)
            elif is_active:
                active_list.append(item)

            # Scatter coordinate point: [days_silent, tier_score, email_total, item]
            # tier_score: A -> 4, B -> 3, C -> 2, D -> 1
            tier_scores = {"A": 4, "B": 3, "C": 2, "D": 1}
            scatter_points.append({
                **item,
                "coord": [days_silent, tier_scores.get(tier, 1), email_total]
            })

        # Sort urgent by days_silent desc, then estimated_value desc
        urgent_list.sort(key=lambda x: (x["tier"] == "A", x["days_silent"]), reverse=True)
        warning_list.sort(key=lambda x: x["days_silent"], reverse=True)
        active_list.sort(key=lambda x: (x["tier"] == "A", -x["days_silent"]), reverse=True)

        return {
            "total_urgent": len(urgent_list),
            "total_warning": len(warning_list),
            "total_active": len(active_list),
            "total_domains": len(unique_domains),
            "urgent_items": urgent_list[:150],
            "warning_items": warning_list[:150],
            "active_items": active_list[:50],
            "scatter_points": scatter_points[:300],
            "aging_distribution": aging_distribution,
            "summary": {
                "a_tier_overdue": sum(1 for x in urgent_list if x["tier"] == "A"),
                "b_tier_overdue": sum(1 for x in warning_list if x["tier"] == "B"),
                "active_count": len(active_list),
                "total_alerts": len(urgent_list) + len(warning_list),
                "unique_domains_count": len(unique_domains)
            }
        }

    @classmethod
    async def review_contact_deal(
        cls, 
        contact_id: str, 
        deal_status: str, # 'won' or 'lost'
        deal_amount: float = 0.0,
        currency: str = "USD",
        user_notes: str = "",
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Analyzes the full email trail of a won or lost deal to perform deep post-mortem,
        summarizes key drivers/blockers, and synthesizes reusable playbook tactics into sales_playbook.
        """
        async with get_db() as db:
            c_cur = await db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,))
            contact = await c_cur.fetchone()

        if not contact:
            return {"success": False, "error": "未找到指定联系人"}

        c_dict = dict(contact)
        c_email = c_dict["email"]
        account_id = c_dict["account_id"]

        # Fetch chronological emails
        async with get_db() as db:
            e_cur = await db.execute("""
                SELECT id, subject, from_name, from_email, to_emails, date_str, snippet, body_text, has_attachments
                FROM emails
                WHERE (lower(from_email) = lower(?) OR to_emails LIKE ? OR cc_emails LIKE ?)
                ORDER BY date_timestamp ASC
                LIMIT 40
            """, (c_email, f"%{c_email}%", f"%{c_email}%"))
            email_rows = await e_cur.fetchall()

        email_trail = []
        for em in email_rows:
            subj = em["subject"] or "(无主题)"
            body_sample = (em["body_text"] or em["snippet"] or "")[:350].replace("\n", " ")
            email_trail.append(f"[{em['date_str']}] 《{subj}》\n内容: {body_sample}\n")

        full_dialogue_text = "\n".join(email_trail)
        if len(full_dialogue_text) > 12000:
            full_dialogue_text = full_dialogue_text[:12000] + "\n...(早期邮件略)..."

        deal_label = "【成单赢单 (Deal Won)】" if deal_status == "won" else "【丢单流失 (Deal Lost)】"

        prompt = f"""你是一位外贸与企业级销售战术复盘大师。
以下是业务员与客户从初次建联到最终结果的全部邮件往来记录。该案例最终结果为：{deal_label}。
业务员填写的补充背景说明：{user_notes if user_notes.strip() else '无额外说明'}。

【客户档案】：
- 客户称呼: {c_dict['name'] or '未知'} <{c_dict['email']}>
- 涉及金额: {currency} {deal_amount}

【完整邮件对话脉络】：
{full_dialogue_text}

--------------------------------------------------
请对该案例进行深度复盘与经验提炼，输出一份专业的总结报告，并提炼 1 条极具实战价值的高转化回复话术模板。
请严格输出如下合法的 JSON 格式：
```json
{{
  "core_reasons": "### 🎯 关键成因分析\\n1. (要点1)\\n2. (要点2)\\n3. (要点3)",
  "key_timeline": "### ⏱️ 关键博弈历程\\n- [建联期] ...\\n- [僵持/谈判期] ...\\n- [决胜/分水岭] ...",
  "lessons_learned": "### 💡 实战避坑与复盘启示\\n- (给业务员团队的落地建议与实战原则)",
  "extracted_playbook": {{
    "scenario_type": "objection_price / objection_terms / objection_delivery / objection_competitor / follow_up_stale / win_reasons",
    "title": "从该案例沉淀的实战话术标题",
    "trigger_pattern": "适用场景或客户提出的抗拒点关键词",
    "response_strategy": "核心应对策略与拆解逻辑",
    "reply_template": "得体的高质量回复草稿模板（中英文结合，包含称谓与格式）"
  }}
}}
```"""

        base_url, api_key, resolved_model = await AIService.resolve_model_and_credentials(model=model)
        target_url = base_url.rstrip("/")
        if not target_url.endswith("/chat/completions"):
            target_url = f"{target_url}/chat/completions"

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload = {
            "model": resolved_model,
            "messages": [
                {"role": "system", "content": "你是一位专注于销售复盘、商业谈判分析与销售话术沉淀的顶级专家。请输出合法的 JSON。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2
        }

        core_reasons = ""
        key_timeline = ""
        lessons_learned = ""
        extracted_pb = None

        try:
            async with httpx.AsyncClient(timeout=35.0) as client:
                resp = await client.post(target_url, headers=headers, json=payload)
                if resp.status_code == 200:
                    raw_text = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text)
                    clean_json = match.group(1) if match else raw_text.strip()
                    parsed = json.loads(clean_json)
                    core_reasons = parsed.get("core_reasons") or ""
                    key_timeline = parsed.get("key_timeline") or ""
                    lessons_learned = parsed.get("lessons_learned") or ""
                    extracted_pb = parsed.get("extracted_playbook")
        except Exception as e:
            core_reasons = f"### 🎯 复盘总结\n针对联系人 {c_email} 的交易历程进行了梳理。"
            key_timeline = f"### ⏱️ 历程\n双方累计收发 {len(email_rows)} 封信件。"
            lessons_learned = f"### 💡 启示\n持续做好关键客户的响应节奏与商务抗拒化解。"

        review_id = f"rev_{uuid.uuid4().hex[:12]}"
        async with get_db() as db:
            # Insert deal review record
            await db.execute("""
                INSERT INTO deal_reviews (id, contact_id, account_id, deal_status, deal_amount, currency, core_reasons, key_timeline, lessons_learned, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            """, (review_id, contact_id, account_id, deal_status, deal_amount, currency, core_reasons, key_timeline, lessons_learned))

            # Update contact deal_stage
            await db.execute("""
                UPDATE contacts 
                SET deal_stage = ?, tier = (CASE WHEN ? = 'won' THEN 'A' ELSE tier END),
                    estimated_value = (CASE WHEN ? > 0 THEN ? ELSE estimated_value END),
                    last_follow_up_at = datetime('now', 'localtime')
                WHERE id = ?
            """, (deal_status, deal_status, deal_amount, deal_amount, contact_id))

            # Return extracted playbook as an AI suggestion without auto-inserting to prevent dirty data
            saved_pb_id = None
            await db.commit()

        return {
            "success": True,
            "review_id": review_id,
            "contact_id": contact_id,
            "deal_status": deal_status,
            "core_reasons": core_reasons,
            "key_timeline": key_timeline,
            "lessons_learned": lessons_learned,
            "extracted_playbook": extracted_pb,
            "saved_playbook_id": saved_pb_id
        }

    @classmethod
    async def get_contact_deal_reviews(cls, contact_id: str) -> List[Dict[str, Any]]:
        """Fetches history deal reviews for a contact"""
        async with get_db() as db:
            cur = await db.execute("""
                SELECT id, contact_id, account_id, deal_status, deal_amount, currency,
                       core_reasons, key_timeline, lessons_learned, created_at
                FROM deal_reviews
                WHERE contact_id = ?
                ORDER BY created_at DESC
            """, (contact_id,))
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

    @classmethod
    async def stream_follow_up_draft(
        cls, 
        contact_id: str, 
        prompt_hint: str = "",
        model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        Streams a personalized follow-up/reactivation draft using the contact's background and matching sales playbook tactics.
        """
        async with get_db() as db:
            c_cur = await db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,))
            contact = await c_cur.fetchone()

        if not contact:
            yield f"data: {json.dumps({'type': 'error', 'error': '未找到对应联系人'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        c_dict = dict(contact)
        c_email = c_dict["email"]
        c_name = c_dict["name"] or c_email.split("@")[0]

        # Fetch recent emails
        async with get_db() as db:
            e_cur = await db.execute("""
                SELECT id, subject, from_name, from_email, to_emails, date_str, snippet, body_text
                FROM emails
                WHERE (lower(from_email) = lower(?) OR to_emails LIKE ? OR cc_emails LIKE ?)
                ORDER BY date_timestamp DESC
                LIMIT 10
            """, (c_email, f"%{c_email}%", f"%{c_email}%"))
            emails = await e_cur.fetchall()

            # Fetch top playbook tactics for reference
            pb_cur = await db.execute("SELECT title, response_strategy, reply_template FROM sales_playbook ORDER BY is_system_preset DESC LIMIT 3")
            playbooks = await pb_cur.fetchall()

        recent_lines = []
        for em in emails[:5]:
            subj = em["subject"] or "(无主题)"
            snip = (em["body_text"] or em["snippet"] or "")[:200].replace("\n", " ")
            recent_lines.append(f"- [{em['date_str']}] 《{subj}》: {snip}")
        recent_text = "\n".join(recent_lines) if recent_lines else "暂无历史往来文本"

        pb_reference = ""
        for p in playbooks:
            pb_reference += f"【参考策略: {p['title']}】\n核心思路: {p['response_strategy']}\n\n"

        prompt = f"""请针对以下客户，起草一封得体、专业、具备高转化破冰力度的商务跟进/催单邮件。

【目标客户信息】：
- 客户称呼: {c_name} <{c_email}> (所属域名: {c_dict.get('domain') or '未知'})
- 客户等级: {c_dict.get('tier', 'B')} 级客户 | 当前生命周期阶段: {c_dict.get('deal_stage', 'inquiry')}
- 业务员特别指示: {prompt_hint if prompt_hint.strip() else '进行常规有效破冰，激活客户互动，探询推进节点'}

【双方近期往来历史上下文】：
{recent_text}

【销售对策库推荐战术参考】：
{pb_reference}

【邮件写作要求】：
1. 语气专业、真诚、有商业分寸，杜绝空洞催促；
2. 结合往来上下文，以具体的产品细节/排产窗口/最新原材料价格走势/样品测试进展为切入点；
3. 输出完整正文（含称谓、正文段落、行动号召 Call to Action 及署名占位符），排版清晰美观。直接输出邮件内容，不要输出多余说明。
"""
        messages = [
            {"role": "system", "content": "你是一位出色的外贸与大客户销售总监，精通商务心理学与高情商邮件沟通。"},
            {"role": "user", "content": prompt}
        ]

        async for chunk in AIService._stream_llm(messages, temperature=0.6, max_tokens=1500, model=model):
            yield chunk

    # -------------------------------------------------------------
    # Playbook CRUD
    # -------------------------------------------------------------
    @classmethod
    async def list_playbooks(cls, scenario_type: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
        async with get_db() as db:
            conditions = []
            params = []
            if scenario_type and scenario_type != "all":
                conditions.append("scenario_type = ?")
                params.append(scenario_type)
            if search and search.strip():
                conditions.append("(title LIKE ? OR trigger_pattern LIKE ? OR response_strategy LIKE ?)")
                q = f"%{search.strip()}%"
                params.extend([q, q, q])

            where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
            cur = await db.execute(f"""
                SELECT id, scenario_type, title, trigger_pattern, response_strategy,
                       reply_template, source_contact_id, is_system_preset, created_at, updated_at
                FROM sales_playbook
                {where_clause}
                ORDER BY is_system_preset DESC, updated_at DESC
            """, params)
            rows = await cur.fetchall()
            result = []
            for r in rows:
                item = dict(r)
                # Ensure frontend compatibility for both reply_template and template_text
                item["template_text"] = item.get("reply_template") or ""
                raw_patterns = item.get("trigger_pattern") or ""
                item["trigger_patterns"] = [p.strip() for p in raw_patterns.split(",") if p.strip()] if isinstance(raw_patterns, str) else []
                result.append(item)
            return result

    @classmethod
    async def create_playbook(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        new_id = f"pb_{uuid.uuid4().hex[:12]}"
        reply_template = data.get("reply_template") or data.get("template_text") or ""
        trigger_pattern = data.get("trigger_pattern")
        if trigger_pattern is None and "trigger_patterns" in data:
            tp = data["trigger_patterns"]
            trigger_pattern = ", ".join(tp) if isinstance(tp, list) else str(tp)
        elif isinstance(trigger_pattern, list):
            trigger_pattern = ", ".join(trigger_pattern)

        async with get_db() as db:
            await db.execute("""
                INSERT INTO sales_playbook (id, scenario_type, title, trigger_pattern, response_strategy, reply_template, source_contact_id, is_system_preset, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now', 'localtime'), datetime('now', 'localtime'))
            """, (
                new_id,
                data.get("scenario_type") or "custom",
                data.get("title") or "新销售话术",
                trigger_pattern or "",
                data.get("response_strategy") or "",
                reply_template,
                data.get("source_contact_id")
            ))
            await db.commit()
            cur = await db.execute("SELECT * FROM sales_playbook WHERE id = ?", (new_id,))
            created = dict(await cur.fetchone())
            created["template_text"] = created.get("reply_template") or ""
            raw_patterns = created.get("trigger_pattern") or ""
            created["trigger_patterns"] = [p.strip() for p in raw_patterns.split(",") if p.strip()] if isinstance(raw_patterns, str) else []
            return created

    @classmethod
    async def update_playbook(cls, playbook_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        reply_template = data.get("reply_template") or data.get("template_text")
        trigger_pattern = data.get("trigger_pattern")
        if trigger_pattern is None and "trigger_patterns" in data:
            tp = data["trigger_patterns"]
            trigger_pattern = ", ".join(tp) if isinstance(tp, list) else str(tp)
        elif isinstance(trigger_pattern, list):
            trigger_pattern = ", ".join(trigger_pattern)

        async with get_db() as db:
            await db.execute("""
                UPDATE sales_playbook
                SET scenario_type = COALESCE(?, scenario_type),
                    title = COALESCE(?, title),
                    trigger_pattern = COALESCE(?, trigger_pattern),
                    response_strategy = COALESCE(?, response_strategy),
                    reply_template = COALESCE(?, reply_template),
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            """, (
                data.get("scenario_type"),
                data.get("title"),
                trigger_pattern,
                data.get("response_strategy"),
                reply_template,
                playbook_id
            ))
            await db.commit()
            cur = await db.execute("SELECT * FROM sales_playbook WHERE id = ?", (playbook_id,))
            row = await cur.fetchone()
            if not row:
                return None
            updated = dict(row)
            updated["template_text"] = updated.get("reply_template") or ""
            raw_patterns = updated.get("trigger_pattern") or ""
            updated["trigger_patterns"] = [p.strip() for p in raw_patterns.split(",") if p.strip()] if isinstance(raw_patterns, str) else []
            return updated

    @classmethod
    async def delete_playbook(cls, playbook_id: str) -> bool:
        async with get_db() as db:
            await db.execute("DELETE FROM sales_playbook WHERE id = ?", (playbook_id,))
            await db.commit()
        return True
