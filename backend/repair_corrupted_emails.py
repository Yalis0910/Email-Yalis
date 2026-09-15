import sys
import os
import sqlite3
import time
import email
from email import policy
from pathlib import Path
from bs4 import BeautifulSoup

# Ensure backend root is in python path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

from app.config import DB_PATH

MAX_BODY_SAVE_SIZE = 300 * 1024

def unpack_multipart_body(raw_text: str):
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
    boundary = first_line[2:].strip()
    if not boundary:
        return raw_text, ""

    fake_mime = f'Content-Type: multipart/mixed; boundary="{boundary}"\r\n\r\n' + stripped
    try:
        msg = email.message_from_string(fake_mime, policy=policy.default)
    except Exception:
        msg = email.message_from_string(fake_mime)

    extracted_text = ""
    extracted_html = ""
    for part in msg.walk():
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

def repair_database():
    print(f"[*] Connecting to database at {DB_PATH}...", flush=True)
    conn = sqlite3.connect(DB_PATH, timeout=60.0)
    conn.isolation_level = None  # Explicit transaction control
    cur = conn.cursor()
    cur.execute("PRAGMA busy_timeout = 60000;")
    cur.execute("PRAGMA journal_mode = WAL;")

    # 1. Fetch only IDs of corrupted emails to keep memory footprint minimal (~1MB)
    print("[*] Scanning for corrupted email IDs...", flush=True)
    cur.execute("""
        SELECT id
        FROM emails
        WHERE body_text LIKE '--%' OR snippet LIKE '--%'
    """)
    email_ids = [row[0] for row in cur.fetchall()]
    total = len(email_ids)
    print(f"[*] Found {total} emails requiring repair.", flush=True)

    if total == 0:
        print("[+] Database is already clean. Nothing to repair!", flush=True)
        conn.close()
        return

    success_count = 0
    fail_count = 0
    start_time = time.time()
    batch_size = 100

    # 2. Process in small streaming chunks to minimize memory & lock contention
    for offset in range(0, total, batch_size):
        chunk_ids = email_ids[offset:offset + batch_size]
        placeholders = ",".join("?" for _ in chunk_ids)
        
        cur.execute(f"""
            SELECT id, subject, snippet, body_text, body_html
            FROM emails
            WHERE id IN ({placeholders})
        """, chunk_ids)
        rows = cur.fetchall()

        conn.execute("BEGIN IMMEDIATE;")
        try:
            for eid, subject, old_snip, btext, bhtml in rows:
                clean_text, clean_html = unpack_multipart_body(btext)

                if not clean_html and bhtml:
                    clean_html = bhtml

                if not clean_text and clean_html:
                    try:
                        soup = BeautifulSoup(clean_html, "html.parser")
                        clean_text = soup.get_text(separator="\n", strip=True)
                    except Exception:
                        clean_text = clean_html[:1000]

                if clean_text or clean_html:
                    if len(clean_text) > MAX_BODY_SAVE_SIZE:
                        clean_text = clean_text[:MAX_BODY_SAVE_SIZE] + "\n\n...[邮件正文过长，系统已安全截断保护存储与网络性能]..."
                    if len(clean_html) > MAX_BODY_SAVE_SIZE:
                        clean_html = clean_html[:MAX_BODY_SAVE_SIZE]

                    new_snippet = (clean_text[:120] if clean_text else (subject or "无主题")).replace("\n", " ")
                    new_size = len(clean_text) + len(clean_html)

                    cur.execute("""
                        UPDATE emails
                        SET body_text = ?,
                            body_html = ?,
                            snippet = ?,
                            size_estimate = ?
                        WHERE id = ?
                    """, (clean_text, clean_html, new_snippet, new_size, eid))

                    success_count += 1
                else:
                    fail_count += 1

            conn.execute("COMMIT;")
        except Exception as e:
            conn.execute("ROLLBACK;")
            print(f"[!] Error in batch at offset {offset}: {e}", flush=True)
            raise e

        processed = min(offset + batch_size, total)
        pct = (processed * 100) // total
        elapsed = time.time() - start_time
        rate = processed / elapsed if elapsed > 0 else 0
        remaining_s = (total - processed) / rate if rate > 0 else 0
        print(f"[{processed}/{total}] ({pct}%) Repaired: {success_count} ({rate:.1f} emails/s, ETA: {remaining_s:.0f}s)", flush=True)

    # 3. Fast bulk sync of email_fts full-text index
    print("\n[*] Synchronizing full-text search index (email_fts)...", flush=True)
    t_fts = time.time()
    try:
        conn.execute("BEGIN IMMEDIATE;")
        cur.execute("DELETE FROM email_fts;")
        cur.execute("""
            INSERT INTO email_fts(id, account_id, subject, snippet, body_text, from_email)
            SELECT id, account_id, subject, snippet, body_text, from_email FROM emails;
        """)
        conn.execute("COMMIT;")
        print(f"[+] Full-text search index synchronized in {time.time() - t_fts:.2f}s!", flush=True)
    except Exception as e:
        conn.execute("ROLLBACK;")
        print(f"[!] Warning: email_fts sync failed: {e}", flush=True)

    elapsed = time.time() - start_time
    print(f"\n[+] ALL DONE in {elapsed:.2f}s!")
    print(f"[+] Total inspected: {total}")
    print(f"[+] Successfully repaired: {success_count}")
    print(f"[+] Skipped/Failed: {fail_count}", flush=True)
    conn.close()

if __name__ == "__main__":
    repair_database()
