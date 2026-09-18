from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.responses import FileResponse
from typing import Optional, Dict, Any
from pathlib import Path
import os
import re
import asyncio
import imaplib
import email
from email.header import decode_header
from app.database import get_db
from app.config import ATTACHMENTS_DIR
from app.dependencies import get_current_user, check_account_access, get_authorized_account_ids

router = APIRouter(prefix="/api/attachments", tags=["attachments"])

def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', '_', name)

def decode_mime_str(s: Optional[str]) -> str:
    if not s:
        return ""
    try:
        decoded_parts = decode_header(s)
        res = []
        for part, enc in decoded_parts:
            if isinstance(part, bytes):
                res.append(part.decode(enc or "utf-8", errors="replace"))
            else:
                res.append(str(part))
        return "".join(res)
    except Exception:
        return str(s)

async def resolve_attachment_file(attachment_id: str) -> dict:
    async with get_db() as db:
        async with db.execute("SELECT * FROM attachments WHERE id = ?", (attachment_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="未找到该附件记录")
            att = dict(row)

        storage_path = att.get("storage_path")
        if storage_path and os.path.exists(storage_path) and os.path.getsize(storage_path) > 0:
            att["file_path"] = storage_path
            return att

        # Check default ATTACHMENTS_DIR path
        safe_name = sanitize_filename(att["filename"])
        expected_path = ATTACHMENTS_DIR / f"{att['id']}_{safe_name}"
        if expected_path.exists() and expected_path.stat().st_size > 0:
            await db.execute("UPDATE attachments SET storage_path = ? WHERE id = ?", (str(expected_path), att["id"]))
            await db.commit()
            att["file_path"] = str(expected_path)
            return att

        # If not on disk, try on-demand fetch via Gmail API or IMAP
        async with db.execute("SELECT email, access_token, provider, imap_host, imap_port, use_ssl, account_type FROM accounts WHERE id = ?", (att["account_id"],)) as cur:
            acc_row = await cur.fetchone()

        if not acc_row:
            raise HTTPException(status_code=404, detail="附件所属邮箱账户不存在")

        provider = (acc_row["provider"] or "").lower() if acc_row["provider"] else ""
        account_type = (acc_row["account_type"] or "").lower() if acc_row["account_type"] else ""

        saved_path = None
        loop = asyncio.get_event_loop()

        # 1. Try fetch via Gmail API if provider is gmail or account_type is gmail_oauth
        if provider == "gmail" or account_type == "gmail_oauth":
            try:
                from app.services.gmail_auth import GmailAuthService
                from googleapiclient.discovery import build
                import base64

                creds = await GmailAuthService.get_valid_credentials(att["account_id"])
                if creds:
                    def fetch_from_gmail():
                        try:
                            service = build("gmail", "v1", credentials=creds)
                            msg = service.users().messages().get(userId="me", id=att["email_id"], format="full").execute()
                            payload = msg.get("payload", {})
                            target_fn = att["filename"].strip('"\' ').lower()

                            def find_attachment_bytes(part):
                                fn = part.get("filename", "")
                                if fn and (
                                    fn.strip('"\' ').lower() == target_fn
                                    or sanitize_filename(fn) == safe_name
                                    or sanitize_filename(decode_mime_str(fn)) == safe_name
                                ):
                                    body = part.get("body", {})
                                    att_id = body.get("attachmentId")
                                    if att_id:
                                        att_res = service.users().messages().attachments().get(
                                            userId="me", messageId=att["email_id"], id=att_id
                                        ).execute()
                                        data_b64 = att_res.get("data")
                                        if data_b64:
                                            return base64.urlsafe_b64decode(data_b64.encode("utf-8"))
                                    elif body.get("data"):
                                        return base64.urlsafe_b64decode(body["data"].encode("utf-8"))
                                for subpart in part.get("parts", []):
                                    res = find_attachment_bytes(subpart)
                                    if res is not None:
                                        return res
                                return None

                            content_bytes = find_attachment_bytes(payload)
                            if content_bytes:
                                with open(expected_path, "wb") as f:
                                    f.write(content_bytes)
                                return str(expected_path)
                        except Exception as e:
                            print(f"[Gmail Attachment Fetch Error] {e}")
                        return None

                    saved_path = await loop.run_in_executor(None, fetch_from_gmail)
            except Exception as e:
                print(f"[Gmail Credentials Error] {e}")

        # 2. Fallback to IMAP fetch if not resolved and has access_token/password
        if not saved_path and acc_row["access_token"]:
            email_addr = acc_row["email"]
            app_pwd = acc_row["access_token"]
            email_id = att["email_id"]
            filename = att["filename"]
            target_host = acc_row["imap_host"] or "imap.gmail.com"
            target_port = int(acc_row["imap_port"] or 993)
            use_ssl = bool(acc_row["use_ssl"] if acc_row["use_ssl"] is not None else True)

            def fetch_from_imap():
                try:
                    if use_ssl:
                        mail = imaplib.IMAP4_SSL(target_host, target_port, timeout=25)
                    else:
                        mail = imaplib.IMAP4(target_host, target_port, timeout=25)

                    try:
                        mail.login(email_addr, app_pwd)
                        folders_to_try = ['"[Gmail]/All Mail"', '"[Gmail]/&YkBnCZCuTvY-"', '"INBOX"']
                        found_folder = False
                        for f_name in folders_to_try:
                            try:
                                st, _ = mail.select(f_name, readonly=True)
                                if st == "OK":
                                    status, data = mail.search(None, f'HEADER Message-ID "<{email_id}>"')
                                    if not data or not data[0]:
                                        status, data = mail.search(None, f'HEADER Message-ID "{email_id}"')
                                    if data and data[0]:
                                        found_folder = True
                                        break
                            except Exception:
                                continue

                        if not found_folder:
                            try:
                                mail.select("INBOX", readonly=True)
                                status, data = mail.search(None, f'HEADER Message-ID "<{email_id}>"')
                                if not data or not data[0]:
                                    status, data = mail.search(None, f'HEADER Message-ID "{email_id}"')
                            except Exception:
                                pass

                        if not data or not data[0]:
                            return None

                        num = data[0].split()[-1]
                        st, msg_data = mail.fetch(num, "(RFC822)")
                        if st != "OK" or not msg_data:
                            return None

                        raw_msg = email.message_from_bytes(msg_data[0][1])
                        target_fn_clean = filename.strip('"\' ').lower()
                        for part in raw_msg.walk():
                            fn = part.get_filename()
                            if fn:
                                decoded_fn = decode_mime_str(fn)
                                if (
                                    decoded_fn.strip('"\' ').lower() == target_fn_clean
                                    or fn.strip('"\' ').lower() == target_fn_clean
                                    or sanitize_filename(decoded_fn) == sanitize_filename(filename)
                                ):
                                    payload = part.get_payload(decode=True)
                                    if payload:
                                        with open(expected_path, "wb") as f:
                                            f.write(payload)
                                        return str(expected_path)
                        return None
                    finally:
                        try:
                            mail.logout()
                        except Exception:
                            pass
                except Exception as e:
                    print(f"[IMAP Attachment Fetch Error] {e}")
                    return None

            saved_path = await loop.run_in_executor(None, fetch_from_imap)

        if not saved_path or not os.path.exists(saved_path):
            raise HTTPException(status_code=404, detail="附件文件暂不可用或无法从邮箱服务器获取")

        await db.execute("UPDATE attachments SET storage_path = ? WHERE id = ?", (saved_path, att["id"]))
        await db.commit()
        att["file_path"] = saved_path
        return att

@router.get("")
async def list_attachments(
    account_id: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)

    if authorized is not None and not authorized and not account_id:
        return {"items": [], "total": 0, "page": page, "limit": limit}

    conditions = []
    params = []

    if account_id:
        conditions.append("a.account_id = ?")
        params.append(account_id)
    elif authorized is not None:
        placeholders = ",".join("?" for _ in authorized)
        conditions.append(f"a.account_id IN ({placeholders})")
        params.extend(list(authorized))

    if category:
        conditions.append("a.category = ?")
        params.append(category)
    if search:
        conditions.append("a.filename LIKE ?")
        params.append(f"%{search}%")

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * limit

    async with get_db() as db:
        count_sql = f"SELECT COUNT(*) FROM attachments a {where_clause}"
        async with db.execute(count_sql, params) as cur:
            total = (await cur.fetchone())[0]

        query = f"""
            SELECT a.id, a.email_id, a.account_id, a.filename, a.file_size,
                   a.mime_type, a.category, a.file_hash, a.storage_path, a.created_at,
                   e.subject as email_subject, e.from_name as email_from
            FROM attachments a
            LEFT JOIN emails e ON a.email_id = e.id
            {where_clause}
            ORDER BY a.created_at DESC
            LIMIT ? OFFSET ?
        """
        async with db.execute(query, (*params, limit, offset)) as cur:
            rows = await cur.fetchall()
            items = [dict(r) for r in rows]

    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit
    }

@router.get("/categories")
async def get_attachment_categories(
    account_id: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)

    if authorized is not None and not authorized and not account_id:
        return []

    conditions = []
    params = []
    if account_id:
        conditions.append("account_id = ?")
        params.append(account_id)
    elif authorized is not None:
        placeholders = ",".join("?" for _ in authorized)
        conditions.append(f"account_id IN ({placeholders})")
        params.extend(list(authorized))

    acc_filter = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    async with get_db() as db:
        query = f"""
            SELECT category, COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_size
            FROM attachments
            {acc_filter}
            GROUP BY category
        """
        async with db.execute(query, params) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

@router.get("/{attachment_id}")
async def get_attachment_detail(
    attachment_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    async with get_db() as db:
        async with db.execute("""
            SELECT a.*, e.subject as email_subject, e.from_name as email_from, e.from_email as email_from_addr, e.date_str as email_date
            FROM attachments a
            LEFT JOIN emails e ON a.email_id = e.id
            WHERE a.id = ?
        """, (attachment_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="未找到该附件")
            att = dict(row)

    check_account_access(att["account_id"], current_user)
    return att

@router.get("/{attachment_id}/preview")
async def preview_attachment(
    attachment_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    att = await resolve_attachment_file(attachment_id)
    check_account_access(att["account_id"], current_user)
    file_path = att["file_path"]
    filename = att["filename"]
    ext = os.path.splitext(filename)[1].lower()

    media_type = att.get("mime_type") or "application/octet-stream"
    if ext == ".pdf":
        media_type = "application/pdf"
    elif ext in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]:
        if ext == ".png": media_type = "image/png"
        elif ext == ".gif": media_type = "image/gif"
        elif ext == ".svg": media_type = "image/svg+xml"
        elif ext == ".webp": media_type = "image/webp"
        else: media_type = "image/jpeg"
    elif ext in [".txt", ".csv", ".json", ".log", ".md", ".xml"]:
        media_type = "text/plain; charset=utf-8"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=filename,
        content_disposition_type="inline"
    )

@router.get("/{attachment_id}/download")
async def download_attachment(
    attachment_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    att = await resolve_attachment_file(attachment_id)
    check_account_access(att["account_id"], current_user)
    file_path = att["file_path"]
    filename = att["filename"]

    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=filename,
        content_disposition_type="attachment"
    )

@router.get("/{attachment_id}/content")
async def get_attachment_content(
    attachment_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    att = await resolve_attachment_file(attachment_id)
    check_account_access(att["account_id"], current_user)
    file_path = Path(att["file_path"])

    try:
        raw = file_path.read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("gbk", errors="replace")
        return {
            "id": att["id"],
            "filename": att["filename"],
            "mime_type": att.get("mime_type"),
            "size": att.get("file_size"),
            "content": text
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法解析该文件文本: {str(e)}")
