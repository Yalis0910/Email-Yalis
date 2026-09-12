import os
import json
import urllib.parse
from typing import Dict, Any, List, Optional, Tuple
import httpx
from app.database import get_db

COPILOT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_emails",
            "description": "在本地邮件库中根据发件人、收件人、关键词或时间范围精准检索邮件。返回结果包含邮件基本信息及关联的附件列表（含附件ID与文件名）。支持双向收发信穿透查询。",
            "parameters": {
                "type": "object",
                "properties": {
                    "keywords": {
                        "type": "string",
                        "description": "在邮件主题、摘要或正文中搜索的关键词"
                    },
                    "from_email": {
                        "type": "string",
                        "description": "发件人邮箱地址或发件人名称（模糊或精确匹配）"
                    },
                    "to_email": {
                        "type": "string",
                        "description": "收件人邮箱地址（用于查询发给特定人的邮件）"
                    },
                    "contact_email": {
                        "type": "string",
                        "description": "联系人邮箱（同时匹配发件人或收件人，双向查询所有往来邮件）"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回邮件最大数量，默认 10 封",
                        "default": 10
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_attachment",
            "description": "深入解析并提取指定附件的具体内容。支持 PDF 文档（合同、报价单、发票）、Excel 表格（.xlsx/.xls）、CSV/纯文本数据（.csv/.txt/.md/.json 等）以及图像物理规格。当用户提问涉及附件中的明细数据（如订单金额、单价、款项条款、表格数据、技术参数）时必须调用此工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "attachment_id": {
                        "type": "string",
                        "description": "附件ID（从 search_emails 返回的 attachments 列表中获取，如 att_xxx）"
                    },
                    "filename": {
                        "type": "string",
                        "description": "附件文件名（若未获取到 attachment_id，可传入附件文件名或部分关键词进行匹配）"
                    },
                    "email_id": {
                        "type": "string",
                        "description": "附件所属的邮件ID（可选，辅助精准定位）"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_contact_info",
            "description": "查询指定联系人的档案信息、互动频次统计（收信量、发信量、首末次往来时间）以及历史已生成的 AI 人脉画像总结报告。",
            "parameters": {
                "type": "object",
                "properties": {
                    "email_or_name": {
                        "type": "string",
                        "description": "联系人的电子邮箱地址（如 alex@example.com）或联系人姓名（如 张三）"
                    }
                },
                "required": ["email_or_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_subscriptions",
            "description": "查询本地识别登记的 SaaS 软件订阅、周期性扣费账单与财务支出台账。",
            "parameters": {
                "type": "object",
                "properties": {
                    "service_name": {
                        "type": "string",
                        "description": "服务商或软件名称（如 GitHub, OpenAI, Google, AWS）"
                    },
                    "cycle": {
                        "type": "string",
                        "enum": ["monthly", "yearly", "one_time", "unknown"],
                        "description": "扣费周期"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_digital_assets",
            "description": "查询在各类第三方平台注册过的数字资产账号、平台分类及首次发现时间。",
            "parameters": {
                "type": "object",
                "properties": {
                    "platform_name": {
                        "type": "string",
                        "description": "第三方平台或网站名称"
                    },
                    "category": {
                        "type": "string",
                        "description": "资产分类，如 dev_ops, productivity, finance, entertainment, social, ai_tools 等"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "通过互联网进行外部公开信息检索。当用户询问本地邮件或数据库中不存在的外部事实、公司/服务商背景介绍、最新资讯、汇率换算、技术文档或需要对发件人域名/外部平台进行公开网络调研时调用此工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词或短语（如：'OpenAI 公司介绍'、'Stripe 支付业务'、'USD to CNY 汇率'）"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回的搜索条目上限，默认为 5 条",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        }
    }
]

def parse_attachment_file(file_path: str, filename: str, mime_type: Optional[str] = None, max_chars: int = 5000) -> str:
    """
    Parses an attachment file (PDF, Excel, CSV/TXT/MD/JSON, Image) and returns structured text.
    Safely caps extracted text at max_chars to prevent overflowing model token limits.
    """
    if not os.path.exists(file_path):
        return f"[解析失败]: 附件文件未在本地磁盘找到: {file_path}"

    file_size = os.path.getsize(file_path)
    if file_size == 0:
        return f"[解析提示]: 附件文件大小为 0 字节: {filename}"

    ext = os.path.splitext(filename)[1].lower()

    # 1. PDF
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(file_path)
            num_pages = len(reader.pages)
            extracted_chunks = []
            cur_len = 0

            for i, page in enumerate(reader.pages):
                if cur_len >= max_chars:
                    extracted_chunks.append(f"\n... (已达文本提取上限，后续 {num_pages - i} 页略)")
                    break
                p_text = page.extract_text() or ""
                p_clean = p_text.strip()
                if p_clean:
                    chunk = f"--- 第 {i+1}/{num_pages} 页 ---\n{p_clean}"
                    extracted_chunks.append(chunk)
                    cur_len += len(chunk)

            if not extracted_chunks:
                return f"[PDF 文件信息]: {filename}（共 {num_pages} 页，文件大小 {round(file_size/1024, 1)} KB）。未提取到可读文字内容，可能是扫描图片型 PDF，建议直接查看源文件。"

            header = f"[PDF 解析结果 - {filename}（共 {num_pages} 页，大小 {round(file_size/1024, 1)} KB）]:\n"
            content = "\n\n".join(extracted_chunks)
            if len(content) > max_chars:
                content = content[:max_chars] + f"\n... (已截断至前 {max_chars} 字符)"
            return header + content
        except Exception as e:
            return f"[PDF 解析异常]: {filename} - {str(e)}"

    # 2. Excel (.xlsx, .xls)
    elif ext in [".xlsx", ".xls"]:
        try:
            import openpyxl
            wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
            sheet_names = wb.sheetnames
            sheets_output = []
            cur_len = 0

            for s_name in sheet_names[:3]:
                if cur_len >= max_chars:
                    sheets_output.append("... (已达到文本上限，略去其余工作表)")
                    break
                ws = wb[s_name]
                rows_text = [f"### 工作表: {s_name}"]
                row_count = 0
                for row in ws.iter_rows(values_only=True):
                    row_vals = [str(v).strip() if v is not None else "" for v in row]
                    if not any(row_vals):
                        continue
                    rows_text.append(" | ".join(row_vals[:20]))
                    row_count += 1
                    if row_count >= 50:
                        rows_text.append("... (已截取前 50 行)")
                        break
                sheet_chunk = "\n".join(rows_text)
                sheets_output.append(sheet_chunk)
                cur_len += len(sheet_chunk)
            wb.close()

            header = f"[Excel 表格解析结果 - {filename}（含工作表: {', '.join(sheet_names)}）]:\n"
            content = "\n\n".join(sheets_output)
            if len(content) > max_chars:
                content = content[:max_chars] + f"\n... (已截断至前 {max_chars} 字符)"
            return header + content
        except Exception as e:
            return f"[Excel 解析异常]: {filename} - {str(e)}"

    # 3. CSV & Text files
    elif ext in [".csv", ".txt", ".log", ".md", ".json", ".py", ".js", ".html", ".xml", ".yml", ".yaml"]:
        try:
            raw_data = None
            for enc in ["utf-8", "gbk", "latin-1"]:
                try:
                    with open(file_path, "r", encoding=enc) as f:
                        raw_data = f.read(max_chars + 100)
                    break
                except (UnicodeDecodeError, LookupError):
                    continue

            if raw_data is None:
                return f"[文本编码解析失败]: {filename}（无法用 utf-8/gbk 解码）"

            header = f"[文本数据内容 - {filename}（大小 {round(file_size/1024, 1)} KB）]:\n"
            if len(raw_data) > max_chars:
                content = raw_data[:max_chars] + f"\n... (已截断至前 {max_chars} 字符)"
            else:
                content = raw_data
            return header + content
        except Exception as e:
            return f"[文本解析异常]: {filename} - {str(e)}"

    # 4. Images (.jpg, .jpeg, .png, .webp, .bmp, .gif)
    elif ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]:
        try:
            from PIL import Image
            with Image.open(file_path) as im:
                img_format = im.format or ext.replace(".", "").upper()
                width, height = im.size
                img_mode = im.mode
            return f"[图像附件规格 - {filename}]:\n- 图像格式: {img_format}\n- 分辨率: {width} x {height} 像素\n- 色彩模式: {img_mode}\n- 文件大小: {round(file_size/1024, 1)} KB\n(说明: 当前为图像文件，以上为其物理图像规格属性)"
        except Exception as e:
            return f"[图像元数据读取异常]: {filename} - {str(e)}"

    # 5. Other formats
    else:
        return f"[附件文件信息 - {filename}]:\n- 扩展名: {ext or '未知'}\n- 文件大小: {round(file_size/1024, 1)} KB\n- 说明: 该格式暂不支持直接文本内容提取，但文件已完好保存在本地。"


async def perform_web_search(query: str, limit: int = 5) -> Tuple[List[Dict[str, str]], str]:
    """
    Performs external web search via DuckDuckGo (HTML search & Instant Answer API).
    Returns (results, summary).
    """
    clean_query = query.strip()
    if not clean_query:
        return [], "搜索失败：关键词为空"

    limit = max(1, min(limit, 10))
    results = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    try:
        async with httpx.AsyncClient(headers=headers, timeout=8.0, follow_redirects=True) as client:
            # 1. Primary: DuckDuckGo HTML search
            try:
                resp = await client.post(
                    "https://html.duckduckgo.com/html/",
                    data={"q": clean_query}
                )
                if resp.status_code == 200:
                    html_text = resp.content.decode("utf-8", errors="replace")
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(html_text, "html.parser")
                    for r in soup.select(".result"):
                        title_el = r.select_one(".result__title a")
                        snippet_el = r.select_one(".result__snippet")
                        if not title_el or not snippet_el:
                            continue
                        raw_href = title_el.get("href", "")
                        clean_url = raw_href
                        if "uddg=" in raw_href:
                            try:
                                qs = urllib.parse.parse_qs(urllib.parse.urlparse(raw_href).query)
                                clean_url = qs.get("uddg", [raw_href])[0]
                            except Exception:
                                pass
                        results.append({
                            "title": title_el.get_text(strip=True),
                            "snippet": snippet_el.get_text(strip=True),
                            "url": clean_url
                        })
                        if len(results) >= limit:
                            break
            except Exception:
                pass

            # 2. Fallback: DuckDuckGo Instant Answer API
            if not results:
                try:
                    resp_api = await client.get(
                        "https://api.duckduckgo.com/",
                        params={"q": clean_query, "format": "json"}
                    )
                    if resp_api.status_code == 200:
                        data = resp_api.json()
                        if data.get("AbstractText"):
                            results.append({
                                "title": data.get("Heading") or clean_query,
                                "snippet": data.get("AbstractText"),
                                "url": data.get("AbstractURL") or ""
                            })
                        for rel in data.get("RelatedTopics", [])[:limit]:
                            if isinstance(rel, dict) and rel.get("Text"):
                                results.append({
                                    "title": rel.get("Text")[:40] + "...",
                                    "snippet": rel.get("Text"),
                                    "url": rel.get("FirstURL") or ""
                                })
                            if len(results) >= limit:
                                break
                except Exception:
                    pass
    except Exception as e:
        return [], f"外部检索连接异常: {str(e)}"

    if not results:
        return [], f"联网检索 '{clean_query}' 未找到相关公开网页"

    summary = f"成功联网检索到 {len(results)} 条关于 '{clean_query}' 的网页结果"
    return results, summary


async def execute_copilot_tool(
    name: str, 
    args: Dict[str, Any], 
    account_id: Optional[str] = None
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], str]:
    """
    Executes a copilot tool directly against the local SQLite database.
    Returns:
      (result_dict, referenced_emails, human_readable_summary)
    """
    referenced_emails = []

    async with get_db() as db:
        acc_filter = "account_id = ? AND " if account_id else ""
        acc_params = [account_id] if account_id else []

        if name == "get_contact_info":
            target = str(args.get("email_or_name", "")).strip()
            if not target:
                return {"error": "缺少联系人邮箱或姓名参数"}, [], "查询失败：参数为空"

            c_cur = await db.execute(f"""
                SELECT id, account_id, email, name, domain, inbound_count, outbound_count, 
                       first_interaction, last_interaction, weight
                FROM contacts
                WHERE {acc_filter} (lower(email) = lower(?) OR lower(name) = lower(?) OR lower(email) LIKE lower(?))
                LIMIT 1
            """, acc_params + [target, target, f"%{target}%"])
            contact = await c_cur.fetchone()

            if not contact:
                return {
                    "status": "not_found",
                    "message": f"在本地联系人列表中未找到与 '{target}' 匹配的记录"
                }, [], f"未找到联系人 {target}"

            # Check cached AI report
            rep_cur = await db.execute("""
                SELECT report_markdown, summary_tags, updated_at 
                FROM contact_ai_reports 
                WHERE contact_id = ? OR contact_email = ?
                LIMIT 1
            """, (contact["id"], contact["email"]))
            report = await rep_cur.fetchone()

            result = {
                "id": contact["id"],
                "name": contact["name"] or "未知",
                "email": contact["email"],
                "domain": contact["domain"] or "",
                "inbound_count": contact["inbound_count"],
                "outbound_count": contact["outbound_count"],
                "total_count": contact["inbound_count"] + contact["outbound_count"],
                "first_interaction": contact["first_interaction"] or "未知",
                "last_interaction": contact["last_interaction"] or "未知",
                "has_ai_report": bool(report and report["report_markdown"]),
                "ai_report_snippet": report["report_markdown"][:500] if report and report["report_markdown"] else None
            }
            summary = f"成功获取联系人档案: {result['name']} <{result['email']}>，共往来 {result['total_count']} 封信"
            return result, [], summary

        elif name == "search_emails":
            contact_email = (args.get("contact_email") or "").strip()
            from_email = (args.get("from_email") or "").strip()
            to_email = (args.get("to_email") or "").strip()
            keywords = (args.get("keywords") or "").strip()
            limit = min(int(args.get("limit") or 10), 25)

            conditions = []
            params = list(acc_params)

            if contact_email:
                conditions.append("(lower(from_email) LIKE lower(?) OR lower(to_emails) LIKE lower(?) OR lower(cc_emails) LIKE lower(?))")
                params.extend([f"%{contact_email}%", f"%{contact_email}%", f"%{contact_email}%"])
            else:
                if from_email:
                    conditions.append("(lower(from_email) LIKE lower(?) OR lower(from_name) LIKE lower(?))")
                    params.extend([f"%{from_email}%", f"%{from_email}%"])
                if to_email:
                    conditions.append("(lower(to_emails) LIKE lower(?) OR lower(cc_emails) LIKE lower(?))")
                    params.extend([f"%{to_email}%", f"%{to_email}%"])

            if keywords:
                conditions.append("(subject LIKE ? OR snippet LIKE ?)")
                params.extend([f"%{keywords}%", f"%{keywords}%"])

            where_clause = ""
            if acc_filter:
                conditions.insert(0, acc_filter[:-5])
            if conditions:
                where_clause = "WHERE " + " AND ".join(conditions)

            query_sql = f"""
                SELECT id, account_id, subject, from_name, from_email, to_emails, cc_emails, 
                       date_timestamp, date_str, snippet, body_text
                FROM emails
                {where_clause}
                ORDER BY date_timestamp DESC
                LIMIT ?
            """
            params.append(limit)

            cur = await db.execute(query_sql, params)
            emails = await cur.fetchall()

            email_ids = [m["id"] for m in emails]
            email_attachments_map = {}
            if email_ids:
                placeholders = ",".join("?" * len(email_ids))
                att_cur = await db.execute(f"""
                    SELECT id, email_id, filename, file_size, category, mime_type 
                    FROM attachments 
                    WHERE email_id IN ({placeholders})
                """, email_ids)
                att_rows = await att_cur.fetchall()
                for a in att_rows:
                    email_attachments_map.setdefault(a["email_id"], []).append({
                        "id": a["id"],
                        "filename": a["filename"],
                        "category": a["category"] or "other",
                        "size_kb": round((a["file_size"] or 0) / 1024, 1)
                    })

            email_records = []
            for m in emails:
                ref_info = {
                    "id": m["id"],
                    "subject": m["subject"] or "(无主题)",
                    "from": f"{m['from_name']} <{m['from_email']}>" if m["from_name"] else m["from_email"],
                    "date": m["date_str"] or ""
                }
                referenced_emails.append(ref_info)

                is_outbound = False
                target_check = contact_email or to_email
                if target_check and (target_check.lower() in (m["to_emails"] or "").lower() or target_check.lower() in (m["cc_emails"] or "").lower()):
                    is_outbound = True

                email_records.append({
                    "id": m["id"],
                    "direction": "我方发出" if is_outbound else "对方来信",
                    "subject": m["subject"] or "(无主题)",
                    "from": ref_info["from"],
                    "to": m["to_emails"] or "",
                    "date": m["date_str"] or "",
                    "snippet": (m["snippet"] or m["body_text"] or "")[:300].strip(),
                    "attachments": email_attachments_map.get(m["id"], [])
                })

            total_atts = sum(len(r["attachments"]) for r in email_records)
            summary = f"在邮件库中检索到 {len(email_records)} 封符合条件的邮件"
            if total_atts > 0:
                summary += f"（含 {total_atts} 个附件，可调用 inspect_attachment 解析）"
            return {"matched_count": len(email_records), "emails": email_records}, referenced_emails, summary

        elif name == "inspect_attachment":
            att_id = (args.get("attachment_id") or "").strip()
            filename = (args.get("filename") or "").strip()
            email_id = (args.get("email_id") or "").strip()

            target_att = None
            if att_id:
                c_cur = await db.execute(f"SELECT * FROM attachments WHERE {acc_filter} id = ? LIMIT 1", acc_params + [att_id])
                target_att = await c_cur.fetchone()

            if not target_att and filename:
                c_cur = await db.execute(f"SELECT * FROM attachments WHERE {acc_filter} (lower(filename) = lower(?) OR lower(filename) LIKE lower(?)) ORDER BY created_at DESC LIMIT 1", acc_params + [filename, f"%{filename}%"])
                target_att = await c_cur.fetchone()

            if not target_att and email_id:
                c_cur = await db.execute(f"SELECT * FROM attachments WHERE {acc_filter} email_id = ? ORDER BY file_size DESC LIMIT 1", acc_params + [email_id])
                target_att = await c_cur.fetchone()

            if not target_att:
                return {
                    "status": "not_found",
                    "message": f"未在本地数据库中检索到指定附件 (attachment_id={att_id}, filename={filename})"
                }, [], f"未找到指定附件: {filename or att_id}"

            att_dict = dict(target_att)

            # Resolve actual file path via resolve_attachment_file
            try:
                from app.routers.attachments import resolve_attachment_file
                resolved = await resolve_attachment_file(att_dict["id"])
                file_path = resolved.get("file_path") or resolved.get("storage_path")
            except Exception as ex:
                file_path = att_dict.get("storage_path")
                if not file_path or not os.path.exists(file_path):
                    err_msg = getattr(ex, "detail", str(ex))
                    return {
                        "status": "error",
                        "attachment_id": att_dict["id"],
                        "filename": att_dict["filename"],
                        "message": f"无法获取附件本地文件: {err_msg}"
                    }, [], f"附件获取失败: {att_dict['filename']}"

            parsed_content = parse_attachment_file(
                file_path=file_path,
                filename=att_dict["filename"],
                mime_type=att_dict.get("mime_type")
            )

            # Fetch source email for reference card
            ref_cur = await db.execute("SELECT id, subject, from_name, from_email, date_str FROM emails WHERE id = ? LIMIT 1", (att_dict["email_id"],))
            em = await ref_cur.fetchone()
            if em:
                referenced_emails.append({
                    "id": em["id"],
                    "subject": em["subject"] or "(无主题)",
                    "from": f"{em['from_name']} <{em['from_email']}>" if em["from_name"] else em["from_email"],
                    "date": em["date_str"] or ""
                })

            result = {
                "status": "success",
                "attachment_id": att_dict["id"],
                "filename": att_dict["filename"],
                "file_size": att_dict["file_size"],
                "category": att_dict.get("category"),
                "email_id": att_dict["email_id"],
                "content": parsed_content
            }
            summary = f"成功解析附件: {att_dict['filename']} ({round((att_dict['file_size'] or 0)/1024, 1)} KB)"
            return result, referenced_emails, summary

        elif name == "query_subscriptions":
            service = (args.get("service_name") or "").strip()
            cycle = (args.get("cycle") or "").strip()

            conditions = []
            params = list(acc_params)
            if service:
                conditions.append("lower(service_name) LIKE lower(?)")
                params.append(f"%{service}%")
            if cycle:
                conditions.append("cycle = ?")
                params.append(cycle)

            if acc_filter:
                conditions.insert(0, acc_filter[:-5])
            where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

            cur = await db.execute(f"""
                SELECT service_name, currency, amount, cycle, invoice_date, source_email_id 
                FROM subscriptions 
                {where_clause} 
                ORDER BY amount DESC LIMIT 15
            """, params)
            subs = await cur.fetchall()

            sub_records = [
                {
                    "service_name": s["service_name"],
                    "currency": s["currency"],
                    "amount": s["amount"],
                    "cycle": s["cycle"],
                    "invoice_date": s["invoice_date"] or "未知"
                }
                for s in subs
            ]
            summary = f"查询到 {len(sub_records)} 条账单与订阅记录"
            return {"subscriptions": sub_records}, [], summary

        elif name == "query_digital_assets":
            platform = (args.get("platform_name") or "").strip()
            cat = (args.get("category") or "").strip()

            conditions = []
            params = list(acc_params)
            if platform:
                conditions.append("lower(platform_name) LIKE lower(?)")
                params.append(f"%{platform}%")
            if cat:
                conditions.append("category = ?")
                params.append(cat)

            if acc_filter:
                conditions.insert(0, acc_filter[:-5])
            where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

            cur = await db.execute(f"""
                SELECT platform_name, category, registered_email, first_detected_at 
                FROM digital_assets 
                {where_clause} 
                LIMIT 15
            """, params)
            assets = await cur.fetchall()

            asset_records = [
                {
                    "platform_name": a["platform_name"],
                    "category": a["category"],
                    "registered_email": a["registered_email"],
                    "first_detected_at": a["first_detected_at"] or "未知"
                }
                for a in assets
            ]
            summary = f"查询到 {len(asset_records)} 个数字资产与平台账号"
            return {"assets": asset_records}, [], summary

        elif name == "search_web":
            query = (args.get("query") or "").strip()
            limit = int(args.get("limit") or 5)
            if not query:
                return {"error": "缺少搜索关键词 query 参数"}, [], "搜索失败：关键词为空"

            web_results, summary = await perform_web_search(query, limit)
            result = {
                "query": query,
                "matched_count": len(web_results),
                "results": web_results
            }
            return result, [], summary

        else:
            return {"error": f"未知工具名称: {name}"}, [], f"未知工具: {name}"
