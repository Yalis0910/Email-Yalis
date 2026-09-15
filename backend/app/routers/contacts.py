from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import Optional, List, Dict, Any
from app.database import get_db
from app.services.stats_service import StatsService
from app.services.ai_service import AIService
from app.dependencies import get_current_user, check_account_access, get_authorized_account_ids

router = APIRouter(prefix="/api/contacts", tags=["contacts"])

@router.get("")
async def list_contacts(
    account_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("weight", pattern="^(weight|recent)$"),
    tier: Optional[str] = Query(None), # 'A', 'B', 'C', 'D', 'overdue'
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
        conditions.append("account_id = ?")
        params.append(account_id)
    elif authorized is not None:
        placeholders = ",".join("?" for _ in authorized)
        conditions.append(f"account_id IN ({placeholders})")
        params.extend(list(authorized))

    if tier:
        clean_tier = tier.strip()
        if clean_tier == "overdue":
            conditions.append("((tier = 'A' AND (julianday('now', 'localtime') - julianday(replace(last_interaction, 'T', ' '))) >= 3) OR (tier = 'B' AND (julianday('now', 'localtime') - julianday(replace(last_interaction, 'T', ' '))) >= 7))")
        elif clean_tier in ["A", "B", "C", "D"]:
            conditions.append("tier = ?")
            params.append(clean_tier)

    if search:
        conditions.append("(name LIKE ? OR email LIKE ? OR domain LIKE ?)")
        pat = f"%{search.strip()}%"
        params.extend([pat, pat, pat])

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * limit

    order_clause = "ORDER BY last_interaction DESC" if sort_by == "recent" else "ORDER BY weight DESC, (inbound_count + outbound_count) DESC"

    async with get_db() as db:
        count_sql = f"SELECT COUNT(*) FROM contacts {where_clause}"
        async with db.execute(count_sql, params) as cur:
            total = (await cur.fetchone())[0]

        query = f"""
            SELECT id, account_id, email, name, domain, inbound_count, outbound_count,
                   first_interaction, last_interaction, weight, tier, tier_reason,
                   tier_locked, deal_stage, estimated_value, last_follow_up_at
            FROM contacts
            {where_clause}
            {order_clause}
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

@router.get("/graph")
async def get_contacts_graph(
    account_id: Optional[str] = Query(None),
    limit: int = Query(35, ge=10, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)
    graph_data = await StatsService.get_contacts_graph(
        account_id=account_id,
        limit=limit,
        allowed_account_ids=list(authorized) if authorized is not None else None
    )
    return graph_data

@router.get("/{contact_id}/timeline")
async def get_contact_timeline(
    contact_id: str,
    order: str = Query("desc", pattern="^(asc|desc)$"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    async with get_db() as db:
        # 1. Fetch contact info
        async with db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,)) as cur:
            contact_row = await cur.fetchone()
            if not contact_row:
                raise HTTPException(status_code=404, detail="未找到该联系人")
            contact = dict(contact_row)

        check_account_access(contact["account_id"], current_user)

        target_email = contact["email"]
        account_id = contact["account_id"]

        # Fetch user account email for direction detection
        user_email = ""
        if account_id:
            async with db.execute("SELECT email FROM accounts WHERE id = ?", (account_id,)) as cur:
                acc = await cur.fetchone()
                if acc:
                    user_email = acc["email"].lower()

        # Build email query matching target_email in from_email or to_emails or cc_emails
        email_conds = [
            "lower(from_email) = lower(?)",
            "to_emails LIKE ?",
            "cc_emails LIKE ?"
        ]
        like_pat = f"%{target_email}%"
        email_params = [target_email, like_pat, like_pat]

        where_sql = f"WHERE ({' OR '.join(email_conds)})"
        if account_id:
            where_sql += " AND account_id = ?"
            email_params.append(account_id)

        order_sql = "ORDER BY date_timestamp DESC" if order == "desc" else "ORDER BY date_timestamp ASC"

        # Performance optimization: omit body_html (often multi-megabytes of HTML/base64)
        # and truncate body_text for inline preview to ensure sub-100ms response times.
        query = f"""
            SELECT id, account_id, thread_id, subject, from_name, from_email,
                   to_emails, cc_emails, date_timestamp, date_str, snippet,
                   substr(body_text, 1, 2000) as body_text, labels, has_attachments, size_estimate,
                   strftime('%Y-%m-%d %H:%M', date_timestamp / 1000, 'unixepoch', 'localtime') as formatted_date
            FROM emails
            {where_sql}
            {order_sql}
        """

        async with db.execute(query, email_params) as cur:
            email_rows = await cur.fetchall()
            emails = [dict(r) for r in email_rows]

        # Attachments map for these emails: only query for emails that actually have attachments
        email_ids_with_att = [e["id"] for e in emails if e.get("has_attachments")]
        attachments_by_email = {}
        if email_ids_with_att:
            batch_size = 500
            for i in range(0, len(email_ids_with_att), batch_size):
                batch = email_ids_with_att[i:i + batch_size]
                placeholders = ",".join(["?"] * len(batch))
                att_sql = f"""
                    SELECT id, email_id, filename, file_size, mime_type, category
                    FROM attachments
                    WHERE email_id IN ({placeholders})
                """
                async with db.execute(att_sql, batch) as cur:
                    for att in await cur.fetchall():
                        att_dict = dict(att)
                        attachments_by_email.setdefault(att_dict["email_id"], []).append(att_dict)

        # Structure timeline nodes
        timeline = []
        inbound_total = 0
        outbound_total = 0
        attachment_total = 0

        for m in emails:
            m_id = m["id"]
            m_labels = m.get("labels") or ""
            m_from = (m.get("from_email") or "").lower()

            is_outbound = ("SENT" in m_labels) or (bool(user_email) and m_from == user_email)
            direction = "outbound" if is_outbound else "inbound"

            if is_outbound:
                outbound_total += 1
            else:
                inbound_total += 1

            att_list = attachments_by_email.get(m_id, [])
            attachment_total += len(att_list)

            timeline.append({
                "id": m_id,
                "subject": m.get("subject") or "（无主题）",
                "from_name": m.get("from_name") or "",
                "from_email": m.get("from_email") or "",
                "to_emails": m.get("to_emails") or "",
                "snippet": m.get("snippet") or "",
                "body_text": m.get("body_text") or "",
                "body_html": "",
                "date_timestamp": m.get("date_timestamp"),
                "date_str": m.get("date_str") or "",
                "formatted_date": m.get("formatted_date") or (m.get("date_str") or "")[:16],
                "direction": direction,
                "labels": m_labels,
                "has_attachments": m.get("has_attachments") or 0,
                "attachments": att_list
            })

        return {
            "contact": contact,
            "stats": {
                "total_exchanges": len(emails),
                "inbound_count": inbound_total,
                "outbound_count": outbound_total,
                "attachment_count": attachment_total,
                "first_interaction": contact.get("first_interaction"),
                "last_interaction": contact.get("last_interaction")
            },
            "timeline": timeline
        }


@router.get("/ai-reports/list")
async def list_summarized_contacts(
    account_id: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("weight", pattern="^(weight|recent)$"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Lists all contacts with generated AI reports"""
    check_account_access(account_id, current_user)
    items = await AIService.list_summarized_contacts(account_id, sort_by=sort_by or "weight")
    # Filter by user's authorized accounts
    authorized = get_authorized_account_ids(current_user)
    if authorized is not None:
        items = [it for it in items if it.get("account_id") in authorized]
    return {"items": items, "total": len(items)}


@router.get("/{contact_id}/ai-report")
async def get_contact_ai_report(
    contact_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Fetches cached AI report for a contact"""
    async with get_db() as db:
        async with db.execute("SELECT account_id FROM contacts WHERE id = ?", (contact_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="未找到该联系人")
            check_account_access(row[0], current_user)

    report = await AIService.get_contact_ai_report(contact_id)
    return {"has_report": bool(report), "report": report}


@router.post("/{contact_id}/ai-report/generate")
async def generate_contact_ai_report(
    contact_id: str,
    force_refresh: bool = Query(False),
    model: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Streams contact relationship portrait and dialogue journey summary via SSE"""
    async with get_db() as db:
        async with db.execute("SELECT account_id FROM contacts WHERE id = ?", (contact_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="未找到该联系人")
            check_account_access(row[0], current_user)

    generator = AIService.stream_contact_ai_summary(contact_id, force_refresh=force_refresh, model=model)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.delete("/{contact_id}/ai-report")
async def delete_contact_ai_report(
    contact_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Deletes cached AI report for a contact"""
    async with get_db() as db:
        async with db.execute("SELECT account_id FROM contacts WHERE id = ?", (contact_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="未找到该联系人")
            check_account_access(row[0], current_user)

    await AIService.delete_contact_ai_report(contact_id)
    return {"status": "ok", "message": "报告已删除"}
    await AIService.delete_contact_ai_report(contact_id)
    return {"status": "ok", "message": "报告已删除"}
