import json
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
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)

    offset = (page - 1) * limit
    parsed_has_att: Optional[int] = None
    if has_attachments in ('1', 'true', 'True', 1):
        parsed_has_att = 1
    elif has_attachments in ('0', 'false', 'False', 0):
        parsed_has_att = 0

    # If user has no authorized accounts and not superadmin
    if authorized is not None and not authorized and not account_id:
        return {"items": [], "total": 0, "page": page, "limit": limit}

    async with get_db() as db:
        if q and q.strip():
            # Robust FTS5 with LIKE Fallback
            clean_q = '"' + q.strip().replace('"', '""') + '"'
            conditions = ["email_fts MATCH ?"]
            params = [clean_q]

            if account_id:
                conditions.append("e.account_id = ?")
                params.append(account_id)
            elif authorized is not None:
                placeholders = ",".join("?" for _ in authorized)
                conditions.append(f"e.account_id IN ({placeholders})")
                params.extend(list(authorized))

            if folder and folder.upper() in ('INBOX', 'SENT'):
                conditions.append("e.labels LIKE ?")
                params.append(f'%"{folder.upper()}"%')
            if parsed_has_att is not None:
                conditions.append("e.has_attachments = ?")
                params.append(parsed_has_att)

            where_clause = f"WHERE {' AND '.join(conditions)}"

            try:
                count_sql = f"""
                    SELECT COUNT(*)
                    FROM email_fts
                    JOIN emails e ON email_fts.id = e.id
                    {where_clause}
                """
                async with db.execute(count_sql, params) as cur:
                    total = (await cur.fetchone())[0]

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

            except Exception:
                # If FTS syntax error or failure, gracefully fallback to LIKE query
                like_conds = ["(e.subject LIKE ? OR e.from_email LIKE ? OR e.from_name LIKE ? OR e.snippet LIKE ?)"]
                like_pat = f"%{q.strip()}%"
                like_params = [like_pat, like_pat, like_pat, like_pat]
                if account_id:
                    like_conds.append("e.account_id = ?")
                    like_params.append(account_id)
                elif authorized is not None:
                    placeholders = ",".join("?" for _ in authorized)
                    like_conds.append(f"e.account_id IN ({placeholders})")
                    like_params.extend(list(authorized))

                if folder and folder.upper() in ('INBOX', 'SENT'):
                    like_conds.append("e.labels LIKE ?")
                    like_params.append(f'%"{folder.upper()}"%')
                if parsed_has_att is not None:
                    like_conds.append("e.has_attachments = ?")
                    like_params.append(parsed_has_att)

                where_like = f"WHERE {' AND '.join(like_conds)}"

                count_sql = f"SELECT COUNT(*) FROM emails e {where_like}"
                async with db.execute(count_sql, like_params) as cur:
                    total = (await cur.fetchone())[0]

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
            if account_id:
                conditions.append("account_id = ?")
                params.append(account_id)
            elif authorized is not None:
                placeholders = ",".join("?" for _ in authorized)
                conditions.append(f"account_id IN ({placeholders})")
                params.extend(list(authorized))

            if folder and folder.upper() in ('INBOX', 'SENT'):
                conditions.append("labels LIKE ?")
                params.append(f'%"{folder.upper()}"%')
            if parsed_has_att is not None:
                conditions.append("has_attachments = ?")
                params.append(parsed_has_att)

            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

            count_sql = f"SELECT COUNT(*) FROM emails {where_clause}"
            async with db.execute(count_sql, params) as cur:
                total = (await cur.fetchone())[0]

            query_sql = f"""
                SELECT id, account_id, thread_id, subject, from_name,
                       from_email, to_emails, date_timestamp, date_str,
                       snippet, labels, has_attachments, size_estimate
                FROM emails
                {where_clause}
                ORDER BY date_timestamp DESC
                LIMIT ? OFFSET ?
            """
            async with db.execute(query_sql, (*params, limit, offset)) as cur:
                rows = await cur.fetchall()
                items = [dict(r) for r in rows]

    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit
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
