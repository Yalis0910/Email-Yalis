import json
import time
from datetime import datetime
from fastapi import APIRouter, Query, HTTPException, Depends
from typing import Optional, Dict, Any
from app.database import get_db
from app.dependencies import get_current_user, check_account_access, get_authorized_account_ids

router = APIRouter(prefix="/api/emails", tags=["emails"])

@router.get("")
async def list_or_search_emails(
    account_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    folder: Optional[str] = Query(None),
    has_attachments: Optional[str] = Query(None),
    date_range: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    group_by_thread: Optional[Any] = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    clean_account_id = account_id if isinstance(account_id, str) and account_id.strip() else None
    check_account_access(clean_account_id, current_user)
    authorized = get_authorized_account_ids(current_user)

    p = page if isinstance(page, int) else 1
    lim = limit if isinstance(limit, int) else 25
    offset = (p - 1) * lim

    parsed_has_att: Optional[int] = None
    if has_attachments in ('1', 'true', 'True', 1):
        parsed_has_att = 1
    elif has_attachments in ('0', 'false', 'False', 0):
        parsed_has_att = 0

    is_grouped = False
    if group_by_thread in (True, 'true', 'True', '1', 1):
        is_grouped = True

    # Parse date range filter into timestamp bounds (in milliseconds)
    start_ts: Optional[int] = None
    end_ts: Optional[int] = None
    now_ms = int(time.time() * 1000)

    clean_range = str(date_range).strip().lower() if isinstance(date_range, str) else ""
    s_date = str(start_date).strip() if isinstance(start_date, str) else ""
    e_date = str(end_date).strip() if isinstance(end_date, str) else ""

    if clean_range == '7d':
        start_ts = now_ms - (7 * 86400 * 1000)
    elif clean_range == '30d':
        start_ts = now_ms - (30 * 86400 * 1000)
    elif clean_range == '90d':
        start_ts = now_ms - (90 * 86400 * 1000)
    elif clean_range in ('365d', '1y'):
        start_ts = now_ms - (365 * 86400 * 1000)
    elif clean_range == 'custom' or s_date or e_date:
        if s_date:
            try:
                dt_start = datetime.strptime(s_date, "%Y-%m-%d")
                start_ts = int(dt_start.timestamp() * 1000)
            except Exception:
                pass
        if e_date:
            try:
                dt_end = datetime.strptime(e_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999)
                end_ts = int(dt_end.timestamp() * 1000)
            except Exception:
                pass

    # If user has no authorized accounts and not superadmin
    if authorized is not None and not authorized and not clean_account_id:
        return {"items": [], "total": 0, "page": p, "limit": lim}

    async with get_db() as db:
        if isinstance(q, str) and q.strip():
            # Robust FTS5 with LIKE Fallback
            clean_q = '"' + q.strip().replace('"', '""') + '"'
            conditions = ["email_fts MATCH ?"]
            params = [clean_q]

            if isinstance(account_id, str) and account_id:
                conditions.append("e.account_id = ?")
                params.append(account_id)
            elif authorized is not None:
                placeholders = ",".join("?" for _ in authorized)
                conditions.append(f"e.account_id IN ({placeholders})")
                params.extend(list(authorized))

            if isinstance(folder, str) and folder.upper() in ('INBOX', 'SENT'):
                conditions.append("e.labels LIKE ?")
                params.append(f'%"{folder.upper()}"%')
            if parsed_has_att is not None:
                conditions.append("e.has_attachments = ?")
                params.append(parsed_has_att)
            if start_ts is not None:
                conditions.append("e.date_timestamp >= ?")
                params.append(start_ts)
            if end_ts is not None:
                conditions.append("e.date_timestamp <= ?")
                params.append(end_ts)

            where_clause = f"WHERE {' AND '.join(conditions)}"

            total = 0
            items = []
            fts_success = False

            try:
                if is_grouped:
                    count_sql = f"""
                        WITH matched_threads AS (
                            SELECT COALESCE(NULLIF(e.thread_id, ''), e.id) as t_id
                            FROM email_fts
                            JOIN emails e ON email_fts.id = e.id
                            {where_clause}
                            GROUP BY t_id
                        )
                        SELECT COUNT(*) FROM matched_threads
                    """
                else:
                    count_sql = f"""
                        SELECT COUNT(*)
                        FROM email_fts
                        JOIN emails e ON email_fts.id = e.id
                        {where_clause}
                    """
                async with db.execute(count_sql, params) as cur:
                    total = (await cur.fetchone())[0]

                if total > 0:
                    if is_grouped:
                        query_sql = f"""
                            WITH matched_emails AS (
                                SELECT e.id, COALESCE(NULLIF(e.thread_id, ''), e.id) as t_id, e.date_timestamp, e.has_attachments
                                FROM email_fts
                                JOIN emails e ON email_fts.id = e.id
                                {where_clause}
                            ),
                            ranked_threads AS (
                                SELECT 
                                    t_id,
                                    COUNT(*) as thread_count,
                                    MAX(date_timestamp) as latest_timestamp,
                                    MAX(has_attachments) as has_attachments
                                FROM matched_emails
                                GROUP BY t_id
                                ORDER BY latest_timestamp DESC
                                LIMIT ? OFFSET ?
                            )
                            SELECT 
                                rt.t_id as thread_id,
                                rt.thread_count,
                                rt.latest_timestamp as date_timestamp,
                                rt.has_attachments,
                                e.id,
                                e.subject,
                                e.from_name,
                                e.from_email,
                                e.to_emails,
                                e.date_str,
                                e.snippet,
                                e.labels,
                                e.account_id,
                                e.size_estimate
                            FROM ranked_threads rt
                            JOIN emails e ON (COALESCE(NULLIF(e.thread_id, ''), e.id) = rt.t_id AND e.date_timestamp = rt.latest_timestamp)
                            GROUP BY rt.t_id
                            ORDER BY rt.latest_timestamp DESC
                        """
                    else:
                        query_sql = f"""
                            SELECT e.id, e.account_id, e.thread_id, e.subject, e.from_name,
                                   e.from_email, e.to_emails, e.date_timestamp, e.date_str,
                                   e.snippet, e.labels, e.has_attachments, e.size_estimate
                            FROM email_fts
                            JOIN emails e ON email_fts.id = e.id
                            {where_clause}
                            ORDER BY e.date_timestamp DESC
                            LIMIT ? OFFSET ?
                        """
                    async with db.execute(query_sql, (*params, limit, offset)) as cur:
                        rows = await cur.fetchall()
                        items = [dict(r) for r in rows]
                    fts_success = True
            except Exception:
                fts_success = False
                total = 0
                items = []

            # If FTS returned 0 (e.g. CJK terms with unicode61 tokenizer) or errored out, seamlessly fallback to LIKE query
            if not fts_success or total == 0:
                like_conds = ["(e.subject LIKE ? OR e.from_email LIKE ? OR e.from_name LIKE ? OR e.snippet LIKE ? OR e.body_text LIKE ?)"]
                like_pat = f"%{q.strip()}%"
                like_params = [like_pat, like_pat, like_pat, like_pat, like_pat]
                if isinstance(account_id, str) and account_id:
                    like_conds.append("e.account_id = ?")
                    like_params.append(account_id)
                elif authorized is not None:
                    placeholders = ",".join("?" for _ in authorized)
                    like_conds.append(f"e.account_id IN ({placeholders})")
                    like_params.extend(list(authorized))

                if isinstance(folder, str) and folder.upper() in ('INBOX', 'SENT'):
                    like_conds.append("e.labels LIKE ?")
                    like_params.append(f'%"{folder.upper()}"%')
                if parsed_has_att is not None:
                    like_conds.append("e.has_attachments = ?")
                    like_params.append(parsed_has_att)
                if start_ts is not None:
                    like_conds.append("e.date_timestamp >= ?")
                    like_params.append(start_ts)
                if end_ts is not None:
                    like_conds.append("e.date_timestamp <= ?")
                    like_params.append(end_ts)

                where_like = f"WHERE {' AND '.join(like_conds)}"

                if is_grouped:
                    count_sql = f"""
                        WITH matched_threads AS (
                            SELECT COALESCE(NULLIF(e.thread_id, ''), e.id) as t_id
                            FROM emails e
                            {where_like}
                            GROUP BY t_id
                        )
                        SELECT COUNT(*) FROM matched_threads
                    """
                else:
                    count_sql = f"SELECT COUNT(*) FROM emails e {where_like}"

                async with db.execute(count_sql, like_params) as cur:
                    total = (await cur.fetchone())[0]

                if is_grouped:
                    query_sql = f"""
                        WITH matched_emails AS (
                            SELECT e.id, COALESCE(NULLIF(e.thread_id, ''), e.id) as t_id, e.date_timestamp, e.has_attachments
                            FROM emails e
                            {where_like}
                        ),
                        ranked_threads AS (
                            SELECT 
                                t_id,
                                COUNT(*) as thread_count,
                                MAX(date_timestamp) as latest_timestamp,
                                MAX(has_attachments) as has_attachments
                            FROM matched_emails
                            GROUP BY t_id
                            ORDER BY latest_timestamp DESC
                            LIMIT ? OFFSET ?
                        )
                        SELECT 
                            rt.t_id as thread_id,
                            rt.thread_count,
                            rt.latest_timestamp as date_timestamp,
                            rt.has_attachments,
                            e.id,
                            e.subject,
                            e.from_name,
                            e.from_email,
                            e.to_emails,
                            e.date_str,
                            e.snippet,
                            e.labels,
                            e.account_id,
                            e.size_estimate
                        FROM ranked_threads rt
                        JOIN emails e ON (COALESCE(NULLIF(e.thread_id, ''), e.id) = rt.t_id AND e.date_timestamp = rt.latest_timestamp)
                        GROUP BY rt.t_id
                        ORDER BY rt.latest_timestamp DESC
                    """
                else:
                    query_sql = f"""
                        SELECT e.id, e.account_id, e.thread_id, e.subject, e.from_name,
                               e.from_email, e.to_emails, e.date_timestamp, e.date_str,
                               e.snippet, e.labels, e.has_attachments, e.size_estimate
                        FROM emails e
                        {where_like}
                        ORDER BY e.date_timestamp DESC
                        LIMIT ? OFFSET ?
                    """
                async with db.execute(query_sql, (*like_params, limit, offset)) as cur:
                    rows = await cur.fetchall()
                    items = [dict(r) for r in rows]

        else:
            # Standard query (no search keyword)
            conditions = []
            params = []
            if isinstance(account_id, str) and account_id:
                conditions.append("account_id = ?")
                params.append(account_id)
            elif authorized is not None:
                placeholders = ",".join("?" for _ in authorized)
                conditions.append(f"account_id IN ({placeholders})")
                params.extend(list(authorized))

            if isinstance(folder, str) and folder.upper() in ('INBOX', 'SENT'):
                conditions.append("labels LIKE ?")
                params.append(f'%"{folder.upper()}"%')
            if parsed_has_att is not None:
                conditions.append("has_attachments = ?")
                params.append(parsed_has_att)
            if start_ts is not None:
                conditions.append("date_timestamp >= ?")
                params.append(start_ts)
            if end_ts is not None:
                conditions.append("date_timestamp <= ?")
                params.append(end_ts)

            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            if is_grouped:
                count_sql = f"""
                    WITH ranked_t AS (
                        SELECT COALESCE(NULLIF(thread_id, ''), id) as t_id
                        FROM emails
                        {where_clause}
                        GROUP BY t_id
                    )
                    SELECT COUNT(*) FROM ranked_t
                """
                query_sql = f"""
                    WITH ranked_threads AS (
                        SELECT 
                            COALESCE(NULLIF(thread_id, ''), id) as t_id,
                            COUNT(*) as thread_count,
                            MAX(date_timestamp) as latest_timestamp,
                            MAX(has_attachments) as has_attachments
                        FROM emails
                        {where_clause}
                        GROUP BY t_id
                        ORDER BY latest_timestamp DESC
                        LIMIT ? OFFSET ?
                    )
                    SELECT 
                        rt.t_id as thread_id,
                        rt.thread_count,
                        rt.latest_timestamp as date_timestamp,
                        rt.has_attachments,
                        e.id,
                        e.subject,
                        e.from_name,
                        e.from_email,
                        e.to_emails,
                        e.date_str,
                        e.snippet,
                        e.labels,
                        e.account_id,
                        e.size_estimate
                    FROM ranked_threads rt
                    JOIN emails e ON (COALESCE(NULLIF(e.thread_id, ''), e.id) = rt.t_id AND e.date_timestamp = rt.latest_timestamp)
                    GROUP BY rt.t_id
                    ORDER BY rt.latest_timestamp DESC
                """
            else:
                count_sql = f"SELECT COUNT(*) FROM emails {where_clause}"
                query_sql = f"""
                    SELECT id, account_id, thread_id, subject, from_name,
                           from_email, to_emails, date_timestamp, date_str,
                           snippet, labels, has_attachments, size_estimate
                    FROM emails
                    {where_clause}
                    ORDER BY date_timestamp DESC
                    LIMIT ? OFFSET ?
                """

            async with db.execute(count_sql, params) as cur:
                total = (await cur.fetchone())[0]

            async with db.execute(query_sql, (*params, limit, offset)) as cur:
                rows = await cur.fetchall()
                items = [dict(r) for r in rows]

    # Ensure consistent thread metadata on all items
    for item in items:
        if "thread_count" not in item:
            item["thread_count"] = 1
        if "thread_id" not in item or not item["thread_id"]:
            item["thread_id"] = item["id"]

    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit
    }

@router.get("/threads/{thread_id}")
async def get_thread_detail(
    thread_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    async with get_db() as db:
        # Fetch all emails belonging to this thread
        async with db.execute(
            """
            SELECT * FROM emails 
            WHERE thread_id = ? OR id = ?
            ORDER BY date_timestamp ASC
            """,
            (thread_id, thread_id)
        ) as cur:
            rows = await cur.fetchall()
            if not rows:
                raise HTTPException(status_code=404, detail="未找到该会话邮件")
            messages = [dict(r) for r in rows]

        # RBAC check: verify access to account_id of messages
        for msg in messages:
            check_account_access(msg["account_id"], current_user)

        # Batch fetch attachments for all messages in this thread
        email_ids = [m["id"] for m in messages]
        if email_ids:
            placeholders = ",".join("?" for _ in email_ids)
            async with db.execute(
                f"SELECT * FROM attachments WHERE email_id IN ({placeholders}) ORDER BY created_at ASC",
                email_ids
            ) as cur:
                att_rows = await cur.fetchall()
                att_by_email: Dict[str, list] = {}
                for r in att_rows:
                    att_dict = dict(r)
                    att_by_email.setdefault(att_dict["email_id"], []).append(att_dict)
        else:
            att_by_email = {}

        for msg in messages:
            msg["attachments"] = att_by_email.get(msg["id"], [])

        # Extract unique participants
        participants = []
        seen_emails = set()
        for msg in messages:
            fn = msg.get("from_name") or ""
            fe = msg.get("from_email") or ""
            if fe and fe.lower() not in seen_emails:
                seen_emails.add(fe.lower())
                participants.append({"name": fn or fe, "email": fe})

        latest_msg = messages[-1]
        return {
            "thread_id": thread_id,
            "subject": latest_msg.get("subject") or "无主题",
            "total_messages": len(messages),
            "participants": participants,
            "latest_date_str": latest_msg.get("date_str") or "",
            "latest_timestamp": latest_msg.get("date_timestamp") or 0,
            "messages": messages
        }

@router.get("/{email_id}")
async def get_email_detail(
    email_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    async with get_db() as db:
        async with db.execute("SELECT * FROM emails WHERE id = ?", (email_id,)) as cur:
            email_row = await cur.fetchone()
            if not email_row:
                raise HTTPException(status_code=404, detail="未找到该邮件")
            data = dict(email_row)

        check_account_access(data["account_id"], current_user)

        # Get attachments
        async with db.execute("SELECT * FROM attachments WHERE email_id = ?", (email_id,)) as cur:
            att_rows = await cur.fetchall()
            data["attachments"] = [dict(r) for r in att_rows]

    return data
