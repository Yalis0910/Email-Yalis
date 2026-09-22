import imaplib
import email
from email.header import decode_header
import hashlib
import json
import re
import os
import sqlite3
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple, Set
from bs4 import BeautifulSoup

from app.config import DB_PATH, ATTACHMENTS_DIR
from app.database import get_db
from app.services.asset_extractor import AssetExtractor
from app.services.gmail_sync import notify_progress

# Maximum size (bytes) for automatic attachment download during sync
# Files under 150KB (invoices, logos, badges) are saved immediately;
# Larger files (designs, archives, vectors) are lazily fetched on-demand when clicked
ATTACHMENT_AUTO_DOWNLOAD_MAX_SIZE = 150 * 1024

# Known provider default configurations
PROVIDER_DEFAULTS = {
    "gmail": {"host": "imap.gmail.com", "port": 993, "ssl": True},
    "qq": {"host": "imap.qq.com", "port": 993, "ssl": True},
    "163": {"host": "imap.163.com", "port": 993, "ssl": True},
    "126": {"host": "imap.126.com", "port": 993, "ssl": True},
    "outlook": {"host": "outlook.office365.com", "port": 993, "ssl": True},
    "exmail": {"host": "imap.exmail.qq.com", "port": 993, "ssl": True},
    "aliyun": {"host": "imap.qiye.aliyun.com", "port": 993, "ssl": True},
    "custom": {"host": "", "port": 993, "ssl": True}
}

# Stop events registry for active IMAP background sync workers
IMAP_STOP_EVENTS: Dict[str, threading.Event] = {}

def get_or_create_stop_event(account_id: str) -> threading.Event:
    if account_id not in IMAP_STOP_EVENTS:
        IMAP_STOP_EVENTS[account_id] = threading.Event()
    return IMAP_STOP_EVENTS[account_id]

def signal_stop_sync(account_id: str):
    if account_id in IMAP_STOP_EVENTS:
        IMAP_STOP_EVENTS[account_id].set()

def safe_imap_logout(mail: Any):
    """
    Safely logs out and shuts down the underlying socket of an IMAP4 connection,
    ensuring zero connection leaks even when the remote server is unresponsive or errors out.
    """
    if not mail:
        return
    try:
        mail.logout()
    except Exception:
        try:
            if hasattr(mail, "sock") and mail.sock:
                mail.sock.close()
        except Exception:
            pass

class GenericImapService:
    @staticmethod
    def _decode_str(raw_header: str) -> str:
        if not raw_header:
            return ""
        decoded_fragments = decode_header(raw_header)
        text = ""
        for frag, enc in decoded_fragments:
            if isinstance(frag, bytes):
                try:
                    text += frag.decode(enc or "utf-8", errors="replace")
                except Exception:
                    text += frag.decode("latin1", errors="replace")
            else:
                text += str(frag)
        return text

    @staticmethod
    def _parse_email_address(raw_str: str) -> Tuple[str, str]:
        if not raw_str:
            return "", ""
        match = re.search(r'^(.*?)\s*<([^>]+)>$', raw_str.strip())
        if match:
            return match.group(1).strip('"\' '), match.group(2).strip().lower()
        return "", raw_str.strip().lower()

    @staticmethod
    def _unpack_corrupted_multipart(raw_text: str) -> Tuple[str, str]:
        """
        If a message was stored or parsed as a raw MIME multipart string (e.g. starting with --boundary),
        extract clean text/plain and text/html, decoding Quoted-Printable / Base64.
        """
        if not raw_text:
            return "", ""
        stripped = raw_text.lstrip()
        if not stripped.startswith("--"):
            return raw_text, ""

        first_line = stripped.splitlines()[0].strip()
        # MIME boundary lines start with '--' followed by the boundary identifier
        boundary = first_line[2:].strip()
        if not boundary:
            return raw_text, ""

        fake_mime = f'Content-Type: multipart/mixed; boundary="{boundary}"\r\n\r\n' + stripped
        try:
            from email import policy
            inner_msg = email.message_from_string(fake_mime, policy=policy.default)
        except Exception:
            inner_msg = email.message_from_string(fake_mime)

        extracted_text = ""
        extracted_html = ""
        for part in inner_msg.walk():
            ct = part.get_content_type()
            disp = str(part.get("Content-Disposition", ""))
            if "attachment" in disp:
                continue
            try:
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                if ct == "text/plain" and not extracted_text:
                    extracted_text = decoded
                elif ct == "text/html" and not extracted_html:
                    extracted_html = decoded
            except Exception:
                pass

        if not extracted_text and extracted_html:
            try:
                soup = BeautifulSoup(extracted_html, "html.parser")
                extracted_text = soup.get_text(separator="\n", strip=True)
            except Exception:
                extracted_text = extracted_html[:1000]

        if extracted_text or extracted_html:
            return extracted_text, extracted_html
        return raw_text, ""


    @classmethod
    def test_connection(
        cls,
        email_addr: str,
        password: str,
        host: str = "imap.gmail.com",
        port: int = 993,
        use_ssl: bool = True
    ) -> bool:
        clean_pwd = password.replace(" ", "")
        target_host = host.strip() or "imap.gmail.com"
        target_port = int(port or 993)

        mail = None
        try:
            if use_ssl:
                mail = imaplib.IMAP4_SSL(target_host, target_port, timeout=20)
            else:
                mail = imaplib.IMAP4(target_host, target_port, timeout=20)
            mail.login(email_addr, clean_pwd)
            return True
        finally:
            safe_imap_logout(mail)

    @classmethod
    async def save_imap_account(
        cls,
        email_addr: str,
        password: str,
        provider: str = "custom",
        imap_host: str = "imap.gmail.com",
        imap_port: int = 993,
        use_ssl: bool = True
    ) -> Dict[str, Any]:
        clean_pwd = password.replace(" ", "")
        target_host = (imap_host or "imap.gmail.com").strip()
        target_port = int(imap_port or 993)

        # Test connection in worker thread
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, cls.test_connection, email_addr, clean_pwd, target_host, target_port, use_ssl)

        account_id = f"acc_{email_addr.lower()}"
        display_name = email_addr.split("@")[0]

        async with get_db() as db:
            await db.execute("""
                INSERT INTO accounts (
                    id, email, display_name, avatar_url, access_token, sync_status, sync_message,
                    account_type, provider, imap_host, imap_port, use_ssl
                ) VALUES (?, ?, ?, '', ?, 'idle', 'IMAP 服务就绪', 'imap', ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    display_name = excluded.display_name,
                    access_token = excluded.access_token,
                    account_type = 'imap',
                    provider = excluded.provider,
                    imap_host = excluded.imap_host,
                    imap_port = excluded.imap_port,
                    use_ssl = excluded.use_ssl,
                    sync_message = '已更新 IMAP 连接凭据'
            """, (account_id, email_addr.lower(), display_name, clean_pwd, provider, target_host, target_port, 1 if use_ssl else 0))
            await db.commit()

        return {
            "id": account_id,
            "email": email_addr.lower(),
            "display_name": display_name,
            "provider": provider,
            "imap_host": target_host,
            "imap_port": target_port
        }

    @classmethod
    def _discover_folders(cls, mail: Any) -> Tuple[List[str], Set[str]]:
        """
        Scans all folders on the IMAP server via LIST.
        Returns:
            target_folders: List of folder names to query
            sent_folders: Set of folder names classified as Outbound / Sent
        """
        all_aggregate_folder = None
        inbox_folder = "INBOX"
        sent_folders = set()
        candidate_folders = []

        try:
            code, mailboxes = mail.list()
            if code == "OK" and mailboxes:
                for mb in mailboxes:
                    text = mb.decode("utf-8", errors="ignore")
                    # Parse flags, delimiter, folder name
                    match = re.search(r'\(([^)]*)\)\s+"?([^"]+)"?\s+(.*)', text)
                    if not match:
                        continue

                    flags_str = match.group(1).upper()
                    flags = flags_str.split()
                    raw_folder_name = match.group(3).strip('" ')

                    # Skip unselectable folders
                    if r'\NOSELECT' in flags:
                        continue

                    # Check for Aggregate "All Mail" (Gmail / Google Workspace)
                    if r'\ALL' in flags:
                        all_aggregate_folder = raw_folder_name
                        continue

                    # Check for Trash / Spam / Junk / Drafts exclusion
                    is_excluded = (
                        r'\TRASH' in flags or
                        r'\JUNK' in flags or
                        r'\SPAM' in flags or
                        r'\DRAFTS' in flags
                    )
                    fn_lower = raw_folder_name.lower()
                    if not is_excluded:
                        trash_junk_keywords = ["trash", "junk", "spam", "deleted", "bin", "垃圾", "已删除", "废纸篓", "草稿", "draft", "广告"]
                        if any(kw in fn_lower for kw in trash_junk_keywords):
                            is_excluded = True

                    if is_excluded:
                        continue

                    # Check if Sent folder
                    is_sent = (
                        r'\SENT' in flags or
                        "sent" in fn_lower or
                        "已发送" in raw_folder_name or
                        "发件箱" in raw_folder_name
                    )
                    if is_sent:
                        sent_folders.add(raw_folder_name)

                    if raw_folder_name.upper() == "INBOX":
                        inbox_folder = raw_folder_name

                    candidate_folders.append(raw_folder_name)
        except Exception:
            pass

        # If Gmail aggregate All Mail exists, it encompasses everything
        if all_aggregate_folder:
            return [all_aggregate_folder], sent_folders

        if not candidate_folders:
            candidate_folders = [inbox_folder]

        # Ensure INBOX is first
        sorted_folders = []
        if inbox_folder in candidate_folders:
            sorted_folders.append(inbox_folder)
        for f in candidate_folders:
            if f not in sorted_folders:
                sorted_folders.append(f)

        return sorted_folders, sent_folders

    @classmethod
    async def sync_imap_emails(cls, account_id: str, max_results: Optional[int] = None, full_sync: bool = False):
        """
        Background generic IMAP fetch routine with multi-folder discovery and incremental pre-check
        """
        await notify_progress(account_id, "syncing", 0, 0, "正在连接邮件服务器...")

        async with get_db() as db:
            async with db.execute("""
                SELECT email, access_token, provider, imap_host, imap_port, use_ssl
                FROM accounts WHERE id = ?
            """, (account_id,)) as cur:
                row = await cur.fetchone()
                if not row:
                    await notify_progress(account_id, "error", 0, 0, "未找到账号")
                    return
                email_addr = row["email"]
                app_pwd = row["access_token"]
                provider = row["provider"] or "custom"
                host = row["imap_host"] or PROVIDER_DEFAULTS.get(provider, {}).get("host", "imap.gmail.com")
                port = row["imap_port"] or PROVIDER_DEFAULTS.get(provider, {}).get("port", 993)
                use_ssl = bool(row["use_ssl"] if row["use_ssl"] is not None else True)

        is_gmail = (
            "gmail" in host.lower()
            or provider.lower() == "gmail"
            or "@gmail.com" in email_addr.lower()
            or "google" in host.lower()
        )

        loop = asyncio.get_event_loop()

        def worker_sync():
            # Circuit breaker to immediately abort further requests if stop is requested or rate limit detected
            stop_event = get_or_create_stop_event(account_id)
            stop_event.clear()
            rate_limit_detected = [False]
            rate_limit_msg = [""]

            # 1. Fetch existing message IDs from local database
            con_check = sqlite3.connect(DB_PATH, timeout=30.0)
            cur_check = con_check.cursor()
            cur_check.execute("SELECT id FROM emails WHERE account_id = ?", (account_id,))
            existing_ids = set(r[0] for r in cur_check.fetchall())
            con_check.close()

            mail = None
            worker_pool_conns = []
            pool_lock = threading.Lock()

            try:
                if use_ssl:
                    mail = imaplib.IMAP4_SSL(host, port, timeout=35)
                else:
                    mail = imaplib.IMAP4(host, port, timeout=35)

                try:
                    mail.login(email_addr, app_pwd)
                except Exception as e:
                    err_lower = str(e).lower()
                    if "exceeded command or bandwidth limits" in err_lower:
                        raise RuntimeError("Account exceeded command or bandwidth limits")
                    if "too many simultaneous" in err_lower:
                        raise RuntimeError("Gmail [ALERT] Too many simultaneous connections")
                    raise e

                # Discover folders automatically
                target_folders, sent_folder_names = cls._discover_folders(mail)

                folder_map = {}
                for folder in target_folders:
                    if stop_event.is_set():
                        break
                    folder_arg = folder if (folder.startswith('"') and folder.endswith('"')) else f'"{folder}"'
                    try:
                        st, _ = mail.select(folder_arg, readonly=True)
                        if st == "OK":
                            st_search, msg_nums = mail.search(None, "ALL")
                            if st_search == "OK" and msg_nums and msg_nums[0]:
                                nums = msg_nums[0].split()
                                nums.reverse()
                                if max_results:
                                    nums = nums[:max_results]
                                folder_map[folder] = nums
                    except Exception:
                        continue

                total_found = sum(len(n) for n in folder_map.values())
                if total_found == 0 or stop_event.is_set():
                    return total_found, 0, False, 0

                # 2. Fast Header Pre-check Filter: only download what's NOT in local DB
                tasks = []
                seen_in_this_run = set()
                GMAIL_BATCH_LIMIT = 250
                target_batch_cap = max_results if max_results else (GMAIL_BATCH_LIMIT if is_gmail else None)

                if not full_sync and len(existing_ids) > 0:
                    asyncio.run_coroutine_threadsafe(
                        notify_progress(account_id, "syncing", 0, total_found, f"正在快速比对 {total_found} 封邮件报头，过滤已有数据..."),
                        loop
                    )
                    for folder, nums in folder_map.items():
                        if stop_event.is_set():
                            break
                        folder_arg = folder if (folder.startswith('"') and folder.endswith('"')) else f'"{folder}"'
                        try:
                            mail.select(folder_arg, readonly=True)
                        except Exception:
                            continue

                        chunk_size = 100 if is_gmail else 150
                        for i in range(0, len(nums), chunk_size):
                            if stop_event.is_set():
                                break
                            # Stop pre-check early if we already have enough tasks for the current safe batch
                            if target_batch_cap and len(tasks) >= target_batch_cap:
                                break
                            chunk = nums[i:i + chunk_size]
                            num_str = b",".join(chunk).decode()
                            try:
                                st, data = mail.fetch(num_str, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
                                if st == "OK" and data:
                                    for item in data:
                                        if isinstance(item, tuple) and len(item) >= 2:
                                            header_prefix = item[0].decode('utf-8', errors='ignore')
                                            m_num = re.search(r'^(\d+)\s+', header_prefix)
                                            num_val = m_num.group(1).encode() if m_num else None

                                            raw_header = item[1].decode('utf-8', errors='ignore')
                                            m = re.search(r'Message-ID:\s*<([^>]+)>', raw_header, re.IGNORECASE)
                                            msg_id = m.group(1).strip() if m else None
                                            if not msg_id:
                                                m2 = re.search(r'Message-ID:\s*(.+)', raw_header, re.IGNORECASE)
                                                msg_id = m2.group(1).strip() if m2 else None

                                            if num_val:
                                                if not msg_id or (msg_id not in existing_ids and msg_id not in seen_in_this_run):
                                                    if msg_id:
                                                        seen_in_this_run.add(msg_id)
                                                    tasks.append((folder, num_val))
                            except Exception as e:
                                err_str = str(e).lower()
                                if "exceeded command or bandwidth limits" in err_str:
                                    rate_limit_detected[0] = True
                                    rate_limit_msg[0] = str(e)
                                    stop_event.set()
                                    break
                                if "too many simultaneous" in err_str:
                                    rate_limit_detected[0] = True
                                    rate_limit_msg[0] = str(e)
                                    stop_event.set()
                                    break
                                # Fallback if header fetch fails
                                for n in chunk:
                                    tasks.append((folder, n))

                            # Gentle pacing for Gmail to prevent burst command rate warnings
                            if is_gmail:
                                import time
                                time.sleep(0.12)
                        if target_batch_cap and len(tasks) >= target_batch_cap:
                            break
                else:
                    for folder, nums in folder_map.items():
                        for n in nums:
                            tasks.append((folder, n))

                if rate_limit_detected[0]:
                    raise RuntimeError(rate_limit_msg[0] or "Account exceeded command or bandwidth limits")

                if stop_event.is_set():
                    return total_found, 0, False, 0

                raw_new_msgs_count = len(tasks)
                if raw_new_msgs_count == 0:
                    return total_found, 0, False, 0

                # Batch capping calculation
                has_more_batch = False
                total_pending_all = max(raw_new_msgs_count, max(0, total_found - len(existing_ids)))
                if target_batch_cap and len(tasks) > target_batch_cap:
                    tasks = tasks[:target_batch_cap]

                new_msgs_count = len(tasks)
                if total_pending_all > new_msgs_count:
                    has_more_batch = True

                if has_more_batch:
                    start_msg = f"检测到共有约 {total_pending_all} 封待同步，采用防风控平稳模式拉取本批 {new_msgs_count} 封..."
                else:
                    start_msg = f"共发现 {new_msgs_count} 封新增邮件，开始批量稳定拉取与解析..."

                asyncio.run_coroutine_threadsafe(
                    notify_progress(account_id, "syncing", 0, new_msgs_count, start_msg),
                    loop
                )

                chunk_size = 10
                chunks = [tasks[i:i + chunk_size] for i in range(0, new_msgs_count, chunk_size)]

                # Gmail: strictly 1 connection to prevent "Too many simultaneous connections" alerts
                max_workers = 1 if is_gmail else min(4, max(1, len(chunks)))

                # Threshold to switch to lightweight fetch:
                # 128KB for Gmail: saves up to 90% bandwidth and prevents hourly/daily quota exhaustion;
                # 1024KB for other generic providers.
                raw_rfc822_threshold = 128 * 1024 if is_gmail else 1024 * 1024

                def fetch_chunk_with_conn(conn, chunk_tuples, curr_folder_state):
                    """
                    Fetches messages smartly using the provided connection:
                    - Normal emails (<= raw_rfc822_threshold) are batch-fetched in 1 IMAP command.
                    - Large emails (> raw_rfc822_threshold) are fetched lightweight (headers + body text + structure)
                      without streaming multi-megabyte image/file payloads.
                    """
                    if stop_event.is_set() or rate_limit_detected[0]:
                        return []

                    # Group numbers by folder
                    folder_to_nums = {}
                    for f, n in chunk_tuples:
                        folder_to_nums.setdefault(f, []).append(n)

                    chunk_items = []
                    for folder, nums in folder_to_nums.items():
                        if stop_event.is_set() or rate_limit_detected[0]:
                            break

                        # Ensure folder is selected
                        if curr_folder_state.get("folder") != folder:
                            folder_arg = folder if (folder.startswith('"') and folder.endswith('"')) else f'"{folder}"'
                            try:
                                st, _ = conn.select(folder_arg, readonly=True)
                                if st != "OK":
                                    continue
                                curr_folder_state["folder"] = folder
                            except Exception as e:
                                err_s = str(e).lower()
                                if "exceeded command or bandwidth limits" in err_s or "too many simultaneous" in err_s:
                                    rate_limit_detected[0] = True
                                    rate_limit_msg[0] = str(e)
                                    stop_event.set()
                                    return []
                                continue

                        is_sent = (folder in sent_folder_names)

                        # 1. Quick size detection (takes ~0.2s for 10 emails)
                        seq = b",".join(nums).decode()
                        sizes = {}
                        try:
                            st_sz, sz_data = conn.fetch(seq, "(RFC822.SIZE)")
                            if st_sz == "OK" and sz_data:
                                for item in sz_data:
                                    if isinstance(item, bytes):
                                        t = item.decode('utf-8', errors='ignore')
                                        m_sz = re.search(r'^(\d+)\s+.*RFC822\.SIZE\s+(\d+)', t)
                                        if m_sz:
                                            sizes[m_sz.group(1)] = int(m_sz.group(2))
                        except Exception as e:
                            err_s = str(e).lower()
                            if "exceeded command or bandwidth limits" in err_s or "too many simultaneous" in err_s:
                                rate_limit_detected[0] = True
                                rate_limit_msg[0] = str(e)
                                stop_event.set()
                                return []

                        # Partition into small (<= raw_rfc822_threshold) and large (> raw_rfc822_threshold)
                        small_nums = []
                        large_nums = []
                        for n in nums:
                            n_str = n.decode() if isinstance(n, bytes) else str(n)
                            if sizes.get(n_str, 0) > raw_rfc822_threshold:
                                large_nums.append(n)
                            else:
                                small_nums.append(n)

                        # 2. Batch fetch small emails in 1 fast command
                        if small_nums:
                            small_seq = b",".join(small_nums).decode()
                            try:
                                st, data = conn.fetch(small_seq, "(RFC822)")
                                if st == "OK" and data:
                                    for item in data:
                                        if isinstance(item, tuple) and len(item) >= 2:
                                            hp = item[0].decode('utf-8', errors='ignore')
                                            m_n = re.search(r'^(\d+)\s+', hp)
                                            nv = m_n.group(1) if m_n else ""
                                            try:
                                                msg = email.message_from_bytes(item[1])
                                                chunk_items.append((nv, msg, folder, is_sent))
                                            except Exception:
                                                pass
                            except Exception as e:
                                err_s = str(e).lower()
                                if "exceeded command or bandwidth limits" in err_s or "too many simultaneous" in err_s:
                                    rate_limit_detected[0] = True
                                    rate_limit_msg[0] = str(e)
                                    stop_event.set()
                                    return []

                        # 3. Lightweight fetch for large emails
                        for ln in large_nums:
                            if stop_event.is_set() or rate_limit_detected[0]:
                                break
                            ln_str = ln.decode() if isinstance(ln, bytes) else str(ln)
                            try:
                                st, l_data = conn.fetch(ln, "(BODY.PEEK[HEADER] BODYSTRUCTURE BODY.PEEK[1])")
                                if st == "OK" and l_data:
                                    hdr_raw = b""
                                    body_raw = b""
                                    bs_raw = ""
                                    for item in l_data:
                                        if isinstance(item, tuple) and len(item) >= 2:
                                            pfx = item[0].decode('utf-8', errors='ignore')
                                            if "HEADER" in pfx:
                                                hdr_raw = item[1]
                                            elif "BODY[1]" in pfx:
                                                body_raw = item[1]
                                            elif "BODYSTRUCTURE" in pfx:
                                                bs_raw = item[0].decode('utf-8', errors='ignore')
                                        elif isinstance(item, bytes):
                                            if b"BODYSTRUCTURE" in item:
                                                bs_raw = item.decode('utf-8', errors='ignore')

                                    if hdr_raw:
                                        if body_raw and body_raw.lstrip().startswith(b"--"):
                                            first_line_raw = body_raw.lstrip().splitlines()[0].strip()
                                            if first_line_raw.startswith(b"--"):
                                                inner_boundary = first_line_raw[2:].strip()
                                                hdr_raw = re.sub(
                                                    rb'(?i)content-type:\s*multipart/[^;\r\n]+;[^\r\n]*boundary=([\"\']?)[^\r\n\"\']+\1',
                                                    b'Content-Type: multipart/mixed; boundary="' + inner_boundary + b'"',
                                                    hdr_raw
                                                )
                                        full_msg_raw = hdr_raw.rstrip() + b"\r\n\r\n" + (body_raw or b"")
                                        msg = email.message_from_bytes(full_msg_raw)
                                        matched_atts = re.findall(
                                            r'"(?:BASE64|7BIT|8BIT|QUOTED-PRINTABLE)"\s+(\d+)\s+NIL\s+\("(?:INLINE|ATTACHMENT)"\s+\("FILENAME"\s+"([^"]+)"\)\)',
                                            bs_raw, re.IGNORECASE
                                        )
                                        if not matched_atts:
                                            fns = re.findall(r'"FILENAME"\s+"([^"]+)"', bs_raw, re.IGNORECASE)
                                            matched_atts = [("0", f) for f in fns]

                                        for sz_str, fn_str in matched_atts:
                                            att_part = email.message.Message()
                                            att_part["Content-Type"] = "application/octet-stream"
                                            att_part["Content-Disposition"] = f'attachment; filename="{fn_str}"'
                                            att_part.set_payload(b"")
                                            try:
                                                att_part._estimated_size = int(sz_str)
                                            except Exception:
                                                att_part._estimated_size = 0
                                            msg.attach(att_part)

                                        chunk_items.append((ln_str, msg, folder, is_sent))
                            except Exception as e:
                                err_s = str(e).lower()
                                if "exceeded command or bandwidth limits" in err_s or "too many simultaneous" in err_s:
                                    rate_limit_detected[0] = True
                                    rate_limit_msg[0] = str(e)
                                    stop_event.set()
                                    return []

                    if is_gmail:
                        import time
                        time.sleep(0.5)

                    return chunk_items

                processed_count = 0

                all_saved_ids = []

                # If Gmail or single worker: reuse the existing authenticated `mail` connection directly!
                # This guarantees EXACTLY 1 connection is ever created, fully immune to concurrency leaks.
                if is_gmail or max_workers == 1:
                    curr_folder_state = {"folder": None}
                    for ch in chunks:
                        if stop_event.is_set() or rate_limit_detected[0]:
                            break
                        fetched_items = fetch_chunk_with_conn(mail, ch, curr_folder_state)
                        if fetched_items:
                            saved_ids = cls._save_imap_messages_sync(account_id, fetched_items, email_addr)
                            if saved_ids:
                                all_saved_ids.extend(saved_ids)
                        processed_count += len(ch)
                        curr_val = min(new_msgs_count, processed_count)
                        pct = (curr_val * 100) // new_msgs_count
                        asyncio.run_coroutine_threadsafe(
                            notify_progress(
                                account_id,
                                "syncing",
                                curr_val,
                                new_msgs_count,
                                f"正在平稳解析入库: {curr_val} / {new_msgs_count} 封 ({pct}%)"
                            ),
                            loop
                        )
                else:
                    # Multi-worker pool for non-Gmail enterprise mail servers
                    tls = threading.local()

                    def get_worker_mail():
                        if stop_event.is_set() or rate_limit_detected[0]:
                            return None
                        if not hasattr(tls, "mail") or tls.mail is None:
                            try:
                                m = imaplib.IMAP4_SSL(host, port, timeout=25) if use_ssl else imaplib.IMAP4(host, port, timeout=25)
                                m.login(email_addr, app_pwd)
                                tls.mail = m
                                tls.curr_folder_state = {"folder": None}
                                with pool_lock:
                                    worker_pool_conns.append(m)
                            except Exception as e:
                                err_text = str(e).lower()
                                if "exceeded command or bandwidth limits" in err_text or "too many simultaneous" in err_text:
                                    rate_limit_detected[0] = True
                                    rate_limit_msg[0] = str(e)
                                    stop_event.set()
                                tls.mail = None
                        return tls.mail

                    def pool_fetch_chunk(chunk_tuples):
                        m = get_worker_mail()
                        if not m:
                            return []
                        return fetch_chunk_with_conn(m, chunk_tuples, tls.curr_folder_state)

                    with ThreadPoolExecutor(max_workers=max_workers) as executor:
                        future_to_chunk = {executor.submit(pool_fetch_chunk, ch): len(ch) for ch in chunks}
                        for future in as_completed(future_to_chunk):
                            if stop_event.is_set() or rate_limit_detected[0]:
                                break
                            chunk_len = future_to_chunk[future]
                            try:
                                fetched_items = future.result()
                                if fetched_items:
                                    saved_ids = cls._save_imap_messages_sync(account_id, fetched_items, email_addr)
                                    if saved_ids:
                                        all_saved_ids.extend(saved_ids)
                            except Exception as e:
                                err_s = str(e).lower()
                                if "exceeded command or bandwidth limits" in err_s or "too many simultaneous" in err_s:
                                    rate_limit_detected[0] = True
                                    rate_limit_msg[0] = str(e)
                                    stop_event.set()
                                    break

                            processed_count += chunk_len
                            curr_val = min(new_msgs_count, processed_count)
                            pct = (curr_val * 100) // new_msgs_count
                            asyncio.run_coroutine_threadsafe(
                                notify_progress(
                                    account_id,
                                    "syncing",
                                    curr_val,
                                    new_msgs_count,
                                    f"正在平稳解析入库: {curr_val} / {new_msgs_count} 封 ({pct}%)"
                                ),
                                loop
                            )

                if rate_limit_detected[0]:
                    raise RuntimeError(rate_limit_msg[0] or "Account exceeded command or bandwidth limits")

                if stop_event.is_set():
                    return total_found, processed_count, False, 0, all_saved_ids

                return total_found, new_msgs_count, has_more_batch, total_pending_all, all_saved_ids

            finally:
                # Guaranteed cleanup of ALL opened sockets and connections
                safe_imap_logout(mail)
                with pool_lock:
                    for conn in worker_pool_conns:
                        safe_imap_logout(conn)
                    worker_pool_conns.clear()

        try:
            total_found, new_count, has_more_batch, total_pending_all, all_saved_ids = await loop.run_in_executor(None, worker_sync)
            
            stop_event = get_or_create_stop_event(account_id)
            if stop_event.is_set():
                await notify_progress(account_id, "completed", 0, 0, "同步任务已停止")
                return

            if total_found == 0:
                await notify_progress(account_id, "completed", 0, 0, "邮箱内无邮件记录")
                return

            # Update account total_synced
            async with get_db() as db:
                await db.execute("""
                    UPDATE accounts SET
                        total_synced = (SELECT COUNT(*) FROM emails WHERE account_id = ?)
                    WHERE id = ?
                """, (account_id, account_id))
                await db.commit()

            # Rebuild contacts accurately: incremental for deltas, full rebuild for initial/full sync
            if new_count > 0:
                from app.services.stats_service import StatsService
                if not full_sync and len(existing_ids) > 0 and all_saved_ids:
                    await StatsService.update_contacts_incremental(account_id, all_saved_ids)
                else:
                    await StatsService.rebuild_contacts(account_id)

                if has_more_batch:
                    remaining_count = max(0, total_pending_all - new_count)
                    completion_msg = f"分批同步完成：本批成功入库 {new_count} 封（剩余约 {remaining_count} 封待同步），系统已安全收工避让风控。可继续同步或由后台定时推进。"
                else:
                    completion_msg = f"增量同步完成：成功导入与深度挖掘 {new_count} 封新增邮件！"
            else:
                completion_msg = f"增量同步完成：已是最新状态，{total_found} 封邮件均已就绪（无新增信件）。"

            await notify_progress(account_id, "completed", total_found, total_found, completion_msg)

        except Exception as e:
            err_text = str(e)
            err_lower = err_text.lower()
            if "exceeded command or bandwidth limits" in err_lower:
                user_msg = "Google 账号触发临时频率与带宽限制保护（通常需等待 15-30 分钟自动恢复），系统已安全暂停同步以保护账号。"
            elif "too many simultaneous" in err_lower:
                user_msg = "Gmail 提示并发连接数超限（每个账号上限 15 个连接）。系统已安全释放本地连接；若该邮箱在手机自带邮件或电脑 Outlook/Foxmail 中使用，建议稍候 10-15 分钟待连接超时释放后重试。"
            else:
                user_msg = f"IMAP 同步异常: {err_text}"
            await notify_progress(account_id, "error", 0, 0, user_msg)

    @classmethod
    def _save_imap_messages_sync(cls, account_id: str, items: List[Tuple[str, Any, str, bool]], user_email: str = "") -> List[str]:
        if not items:
            return []

        saved_msg_ids = []
        user_email_clean = user_email.lower().strip() if user_email else account_id.replace("acc_", "").lower().strip()
        con = sqlite3.connect(DB_PATH, timeout=30.0)
        cur = con.cursor()
        cur.execute("PRAGMA busy_timeout = 30000;")

        try:
            for item in items:
                # Unpack tuple
                if len(item) == 4:
                    num_str, msg, folder_name, is_sent_folder = item
                elif len(item) == 3:
                    num_str, msg, folder_name = item
                    is_sent_folder = False
                else:
                    num_str, msg = item
                    folder_name = "INBOX"
                    is_sent_folder = False

                msg_id_header = msg.get("Message-ID", "")
                msg_id = msg_id_header.strip("<> ") if msg_id_header else f"imap_{account_id}_{num_str}"
                
                subject = cls._decode_str(msg.get("Subject", "无主题"))
                from_raw = cls._decode_str(msg.get("From", ""))
                from_name, from_email = cls._parse_email_address(from_raw)
                to_emails = cls._decode_str(msg.get("To", ""))
                cc_emails = cls._decode_str(msg.get("Cc", ""))
                date_str = msg.get("Date", "")

                is_sent = is_sent_folder or bool(from_email and user_email_clean and from_email.lower() == user_email_clean)
                labels = '["SENT"]' if is_sent else '["INBOX"]'

                internal_date = int(datetime.now().timestamp() * 1000)
                try:
                    parsed_dt = email.utils.parsedate_to_datetime(date_str)
                    if parsed_dt:
                        internal_date = int(parsed_dt.timestamp() * 1000)
                except Exception:
                    pass

                body_text = ""
                body_html = ""
                raw_attachments = []

                if msg.is_multipart():
                    for part in msg.walk():
                        content_type = part.get_content_type()
                        content_disposition = str(part.get("Content-Disposition", ""))
                        filename = part.get_filename()

                        if filename:
                            decoded_filename = cls._decode_str(filename)
                            payload_data = part.get_payload(decode=True) or b""
                            att_size = getattr(part, "_estimated_size", len(payload_data))
                            raw_attachments.append({
                                "filename": decoded_filename,
                                "mime_type": content_type,
                                "size": att_size,
                                "payload": payload_data if att_size <= ATTACHMENT_AUTO_DOWNLOAD_MAX_SIZE and payload_data else None
                            })
                        elif "attachment" not in content_disposition:
                            payload_data = part.get_payload(decode=True)
                            if payload_data:
                                charset = part.get_content_charset() or "utf-8"
                                decoded_content = payload_data.decode(charset, errors="replace")
                                if content_type == "text/plain" and not body_text:
                                    body_text = decoded_content
                                elif content_type == "text/html" and not body_html:
                                    body_html = decoded_content
                else:
                    content_type = msg.get_content_type()
                    payload_data = msg.get_payload(decode=True)
                    if payload_data:
                        charset = msg.get_content_charset() or "utf-8"
                        decoded_content = payload_data.decode(charset, errors="replace")
                        if content_type == "text/html":
                            body_html = decoded_content
                        else:
                            body_text = decoded_content

                # Defensive check: if body_text contains an unparsed raw MIME multipart block, unpack it
                if body_text and body_text.lstrip().startswith("--"):
                    clean_text, clean_html = cls._unpack_corrupted_multipart(body_text)
                    if clean_text or clean_html:
                        body_text = clean_text
                        if clean_html and not body_html:
                            body_html = clean_html

                if not body_text and body_html:
                    try:
                        soup = BeautifulSoup(body_html, "html.parser")
                        body_text = soup.get_text(separator="\n", strip=True)
                    except Exception:
                        body_text = body_html[:1000]

                # Prevent monstrous email payloads (e.g. 5.7MB base64 images in text/html) from blowing up DB & bandwidth
                MAX_BODY_SAVE_SIZE = 300 * 1024
                if len(body_text) > MAX_BODY_SAVE_SIZE:
                    body_text = body_text[:MAX_BODY_SAVE_SIZE] + "\n\n...[邮件正文过长，系统已安全截断保护存储与网络性能]..."
                if len(body_html) > MAX_BODY_SAVE_SIZE:
                    body_html = body_html[:MAX_BODY_SAVE_SIZE]

                snippet = (body_text[:120] if body_text else subject).replace("\n", " ")
                has_attachments = 1 if len(raw_attachments) > 0 else 0

                # 1. Insert Email
                cur.execute("""
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
                        body_html = excluded.body_html,
                        labels = excluded.labels
                """, (
                    msg_id, account_id, f"thread_{msg_id}", subject, from_name, from_email,
                    to_emails, cc_emails, internal_date, date_str, snippet,
                    body_text, body_html, labels, has_attachments, len(body_text) + len(body_html)
                ))
                saved_msg_ids.append(msg_id)

                # 2. Attachments
                for att in raw_attachments:
                    att_category = AssetExtractor.classify_attachment(att["filename"], att["mime_type"])
                    att_filename = att["filename"]
                    att_id = f"att_{hashlib.md5(f'{msg_id}_{att_filename}'.encode()).hexdigest()[:12]}"
                    dummy_hash = hashlib.sha256(f"{msg_id}_{att_filename}".encode()).hexdigest()

                    storage_path_str = None
                    # Only auto-save to disk if attachment is small (<= 150KB, e.g. invoices, logos, small docs)
                    # Large design files (>150KB) are lazily fetched on demand when user clicks preview/download
                    if att.get("payload") and att.get("size", 0) <= ATTACHMENT_AUTO_DOWNLOAD_MAX_SIZE:
                        try:
                            safe_name = re.sub(r'[\\/*?:"<>|]', '_', att_filename)
                            dest_file = ATTACHMENTS_DIR / f"{att_id}_{safe_name}"
                            with open(dest_file, "wb") as f:
                                f.write(att["payload"])
                            storage_path_str = str(dest_file)
                        except Exception:
                            pass

                    cur.execute("""
                        INSERT INTO attachments (
                            id, email_id, account_id, filename, file_size, mime_type, category, file_hash, storage_path
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            storage_path = COALESCE(excluded.storage_path, attachments.storage_path),
                            file_size = excluded.file_size
                    """, (
                        att_id, msg_id, account_id, att["filename"], att["size"],
                        att["mime_type"], att_category, dummy_hash, storage_path_str
                    ))

                # 3. Digital Assets
                platform_info = AssetExtractor.identify_platform(from_email, from_name, subject)
                if platform_info:
                    p_name, domain, category, conf = platform_info
                    asset_id = f"asset_{account_id}_{re.sub(r'[^a-zA-Z0-9]', '_', p_name).lower()}"
                    first_date = datetime.fromtimestamp(internal_date / 1000 if internal_date else 0, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

                    cur.execute("""
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

                # 4. Subscriptions
                sub_info = AssetExtractor.detect_subscription_bill(from_email, from_name, subject, snippet, body_text)
                if sub_info and sub_info.get("amount", 0) > 0:
                    sub_id = f"sub_{msg_id}"
                    invoice_date = datetime.fromtimestamp(internal_date / 1000 if internal_date else 0, tz=timezone.utc).strftime('%Y-%m-%d')
                    cur.execute("""
                        INSERT OR IGNORE INTO subscriptions (
                            id, account_id, service_name, currency, amount, cycle, invoice_date, source_email_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        sub_id, account_id, sub_info["service_name"], sub_info["currency"],
                        sub_info["amount"], sub_info["cycle"], invoice_date, msg_id
                    ))

            con.commit()
            return saved_msg_ids
        finally:
            con.close()

# Alias for backward compatibility
GmailImapService = GenericImapService
