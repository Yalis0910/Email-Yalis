import asyncio
import base64
import hashlib
import json
import re
import os
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, AsyncGenerator
from bs4 import BeautifulSoup
from googleapiclient.discovery import build

from app.config import ATTACHMENTS_DIR
from app.database import get_db
from app.services.gmail_auth import GmailAuthService
from app.services.asset_extractor import AssetExtractor

# In-memory progress tracking for active sync jobs
SYNC_PROGRESS: Dict[str, Dict[str, Any]] = {}
SYNC_QUEUES: Dict[str, List[asyncio.Queue]] = {}

def get_or_create_sync_queue(account_id: str) -> asyncio.Queue:
    if account_id not in SYNC_QUEUES:
        SYNC_QUEUES[account_id] = []
    q = asyncio.Queue()
    SYNC_QUEUES[account_id].append(q)
    return q

def remove_sync_queue(account_id: str, q: asyncio.Queue):
    if account_id in SYNC_QUEUES and q in SYNC_QUEUES[account_id]:
        SYNC_QUEUES[account_id].remove(q)

async def notify_progress(account_id: str, status: str, current: int, total: int, message: str):
    data = {
        "account_id": account_id,
        "status": status,
        "current": current,
        "total": total,
        "message": message,
        "timestamp": datetime.now().isoformat()
    }
    SYNC_PROGRESS[account_id] = data

    # Update account table in DB
    try:
        async with get_db() as db:
            await db.execute("""
                UPDATE accounts SET
                    sync_status = ?,
                    sync_progress_current = ?,
                    sync_progress_total = ?,
                    sync_message = ?,
                    last_synced_at = CASE WHEN ? = 'completed' THEN datetime('now', 'localtime') ELSE last_synced_at END
                WHERE id = ?
            """, (status, current, total, message, status, account_id))
            await db.commit()
    except Exception:
        pass

    # Broadcast to SSE queues
    if account_id in SYNC_QUEUES:
        for q in SYNC_QUEUES[account_id]:
            await q.put(data)

class GmailSyncService:
    @staticmethod
    def _parse_headers(headers_list: List[Dict[str, str]]) -> Dict[str, str]:
        headers = {}
        for h in headers_list:
            headers[h.get("name", "").lower()] = h.get("value", "")
        return headers

    @staticmethod
    def _parse_email_address(raw_str: str) -> Tuple[str, str]:
        """
        Parses 'Display Name <email@domain.com>' into ('Display Name', 'email@domain.com')
        """
        if not raw_str:
            return "", ""
        match = re.search(r'^(.*?)\s*<([^>]+)>$', raw_str.strip())
        if match:
            return match.group(1).strip('"\' '), match.group(2).strip().lower()
        return "", raw_str.strip().lower()

    @classmethod
    def _extract_body_and_attachments(cls, payload: Dict[str, Any]) -> Tuple[str, str, List[Dict[str, Any]]]:
        body_text = ""
        body_html = ""
        attachments = []

        def walk_parts(part):
            nonlocal body_text, body_html, attachments
            mime_type = part.get("mimeType", "")
            filename = part.get("filename", "")
            body = part.get("body", {})

            # Check if this part is an attachment
            if filename:
                att_id = body.get("attachmentId")
                att_size = body.get("size", 0)
                attachments.append({
                    "filename": filename,
                    "mime_type": mime_type,
                    "size": att_size,
                    "attachment_id": att_id
                })
            else:
                data = body.get("data")
                if data:
                    try:
                        decoded = base64.urlsafe_b64decode(data.encode("ASCII")).decode("utf-8", errors="replace")
                        if mime_type == "text/plain" and not body_text:
                            body_text = decoded
                        elif mime_type == "text/html" and not body_html:
                            body_html = decoded
                    except Exception:
                        pass

            for subpart in part.get("parts", []):
                walk_parts(subpart)

        walk_parts(payload)

        # If body_text is empty but HTML is available, generate plain text via BeautifulSoup
        if not body_text and body_html:
            try:
                soup = BeautifulSoup(body_html, "html.parser")
                body_text = soup.get_text(separator="\n", strip=True)
            except Exception:
                body_text = body_html[:1000]

        return body_text, body_html, attachments

    @classmethod
    async def sync_account_emails(cls, account_id: str, full_sync: bool = False, max_results: Optional[int] = None):
        """
        Main sync routine for an account
        """
        await notify_progress(account_id, "syncing", 0, 0, "正在连接 Gmail 服务...")
        try:
            creds = await GmailAuthService.get_valid_credentials(account_id)
            if not creds:
                await notify_progress(account_id, "error", 0, 0, "认证凭据无效或已失效，请重新授权")
                return

            service = build("gmail", "v1", credentials=creds)

            # Get latest profile & historyId
            profile = service.users().getProfile(userId="me").execute()
            latest_history_id = profile.get("historyId")

            await notify_progress(account_id, "syncing", 0, 0, "正在检索云端邮件列表...")

            # List all messages
            all_messages = []
            page_token = None
            query_filter = ""  # fetch all

            while True:
                req = service.users().messages().list(
                    userId="me",
                    q=query_filter,
                    pageToken=page_token,
                    maxResults=500
                )
                res = req.execute()
                messages = res.get("messages", [])
                if messages:
                    all_messages.extend(messages)
                
                await notify_progress(account_id, "syncing", len(all_messages), len(all_messages), f"已检索到 {len(all_messages)} 封邮件...")

                page_token = res.get("nextPageToken")
                if not page_token:
                    break
                if max_results and len(all_messages) >= max_results:
                    all_messages = all_messages[:max_results]
                    break

            total_messages = len(all_messages)
            if total_messages == 0:
                await notify_progress(account_id, "completed", 0, 0, "邮箱内无邮件记录")
                return

            # Query existing message IDs from SQLite
            async with get_db() as db:
                async with db.execute("SELECT id FROM emails WHERE account_id = ?", (account_id,)) as cur:
                    existing_ids = {row[0] async for row in cur}

            if not full_sync and existing_ids:
                new_messages = [msg for msg in all_messages if msg["id"] not in existing_ids]
            else:
                new_messages = all_messages

            if len(new_messages) == 0:
                await notify_progress(
                    account_id,
                    "completed",
                    total_messages,
                    total_messages,
                    f"增量同步完成：全部 {total_messages} 封邮件均已就绪（无新增信件）。"
                )
                async with get_db() as db:
                    await db.execute("""
                        UPDATE accounts SET
                            sync_status = 'completed',
                            sync_progress_current = (SELECT COUNT(*) FROM emails WHERE account_id = ?),
                            sync_progress_total = (SELECT COUNT(*) FROM emails WHERE account_id = ?),
                            sync_message = '增量同步完成：邮件已是最新，无新增邮件',
                            last_synced_at = datetime('now', 'localtime')
                        WHERE id = ?
                    """, (account_id, account_id, account_id))
                    await db.commit()
                return

            await notify_progress(account_id, "syncing", 0, len(new_messages), f"共发现 {len(new_messages)} 封新增邮件，开始批量高速拉取与解析...")

            # Batch fetch messages in chunks of 50
            chunk_size = 50
            processed_count = 0

            for i in range(0, len(new_messages), chunk_size):
                chunk = new_messages[i:i + chunk_size]
                fetched_details = []

                # Use batch request
                batch = service.new_batch_http_request()

                def callback(request_id, response, exception):
                    if exception is None and response:
                        fetched_details.append(response)

                for msg in chunk:
                    batch.add(
                        service.users().messages().get(userId="me", id=msg["id"], format="full"),
                        callback=callback
                    )

                # Execute batch request in thread pool to avoid blocking asyncio loop
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, batch.execute)

                # Process and save the fetched batch
                await cls._save_batch_messages(account_id, fetched_details)

                processed_count += len(chunk)
                await notify_progress(
                    account_id,
                    "syncing",
                    processed_count,
                    len(new_messages),
                    f"正在解析入库新邮件: {processed_count} / {len(new_messages)} 封 ({(processed_count*100)//len(new_messages)}%)"
                )

            # Update account total_synced and history_id
            async with get_db() as db:
                await db.execute("""
                    UPDATE accounts SET
                        history_id = ?,
                        total_synced = (SELECT COUNT(*) FROM emails WHERE account_id = ?)
                    WHERE id = ?
                """, (latest_history_id, account_id, account_id))
            # Rebuild contacts accurately from emails
            from app.services.stats_service import StatsService
            await StatsService.rebuild_contacts(account_id)

            await notify_progress(account_id, "completed", total_messages, total_messages, f"全量同步完成，已成功入库与深度挖掘 {total_messages} 封邮件！")

        except Exception as e:
            await notify_progress(account_id, "error", 0, 0, f"同步发生异常: {str(e)}")

    @classmethod
    async def _save_batch_messages(cls, account_id: str, messages: List[Dict[str, Any]]):
        if not messages:
            return

        async with get_db() as db:
            for msg in messages:
                msg_id = msg.get("id")
                thread_id = msg.get("threadId")
                internal_date = int(msg.get("internalDate", 0))
                size_estimate = int(msg.get("sizeEstimate", 0))
                label_ids = json.dumps(msg.get("labelIds", []))

                payload = msg.get("payload", {})
                headers_dict = cls._parse_headers(payload.get("headers", []))

                subject = headers_dict.get("subject", "无主题")
                from_raw = headers_dict.get("from", "")
                from_name, from_email = cls._parse_email_address(from_raw)
                to_emails = headers_dict.get("to", "")
                cc_emails = headers_dict.get("cc", "")
                date_str = headers_dict.get("date", "")
                snippet = msg.get("snippet", "")

                body_text, body_html, raw_attachments = cls._extract_body_and_attachments(payload)
                has_attachments = 1 if len(raw_attachments) > 0 else 0

                # 1. Insert or Replace into emails
                await db.execute("""
                    INSERT INTO emails (
                        id, account_id, thread_id, subject, from_name, from_email,
                        to_emails, cc_emails, date_timestamp, date_str, snippet,
                        body_text, body_html, labels, has_attachments, size_estimate
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        subject = excluded.subject,
                        from_name = excluded.from_name,
                        from_email = excluded.from_email,
                        to_emails = excluded.to_emails,
                        snippet = excluded.snippet,
                        body_text = excluded.body_text,
                        body_html = excluded.body_html
                """, (
                    msg_id, account_id, thread_id, subject, from_name, from_email,
                    to_emails, cc_emails, internal_date, date_str, snippet,
                    body_text, body_html, label_ids, has_attachments, size_estimate
                ))

                # 2. Extract & Insert Attachments
                for att in raw_attachments:
                    att_category = AssetExtractor.classify_attachment(att["filename"], att["mime_type"])
                    att_id = f"att_{msg_id}_{hashlib.md5(att['filename'].encode()).hexdigest()[:8]}"
                    dummy_hash = hashlib.sha256(f"{msg_id}_{att['filename']}".encode()).hexdigest()

                    await db.execute("""
                        INSERT OR IGNORE INTO attachments (
                            id, email_id, account_id, filename, file_size, mime_type, category, file_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        att_id, msg_id, account_id, att["filename"], att["size"],
                        att["mime_type"], att_category, dummy_hash
                    ))

                # 3. Extract Digital Assets (SaaS / Platforms / Services)
                platform_info = AssetExtractor.identify_platform(from_email, from_name, subject)
                if platform_info:
                    p_name, domain, category, conf = platform_info
                    asset_id = f"asset_{account_id}_{re.sub(r'[^a-zA-Z0-9]', '_', p_name).lower()}"
                    first_date = datetime.fromtimestamp(internal_date / 1000 if internal_date else 0, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

                    await db.execute("""
                        INSERT INTO digital_assets (
                            id, account_id, platform_name, domain, category,
                            registered_email, first_detected_at, last_activity_at,
                            source_email_id, confidence_score
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            last_activity_at = MAX(digital_assets.last_activity_at, excluded.last_activity_at),
                            confidence_score = MAX(digital_assets.confidence_score, excluded.confidence_score)
                    """, (
                        asset_id, account_id, p_name, domain, category,
                        account_id.replace("acc_", ""), first_date, first_date,
                        msg_id, conf
                    ))

                # 4. Extract Subscriptions & Invoices
                sub_info = AssetExtractor.detect_subscription_bill(from_email, from_name, subject, snippet, body_text)
                if sub_info and sub_info.get("amount", 0) > 0:
                    sub_id = f"sub_{msg_id}"
                    invoice_date = datetime.fromtimestamp(internal_date / 1000 if internal_date else 0, tz=timezone.utc).strftime('%Y-%m-%d')
                    await db.execute("""
                        INSERT OR IGNORE INTO subscriptions (
                            id, account_id, service_name, currency, amount, cycle, invoice_date, source_email_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        sub_id, account_id, sub_info["service_name"], sub_info["currency"],
                        sub_info["amount"], sub_info["cycle"], invoice_date, msg_id
                    ))

            await db.commit()
