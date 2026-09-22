import csv
import io
from fastapi import APIRouter, Query, Response, Depends
from typing import Optional, Dict, Any
from app.database import get_db
from app.dependencies import get_current_user, check_account_access, get_authorized_account_ids

router = APIRouter(prefix="/api/assets", tags=["assets"])

@router.get("/digital")
async def get_digital_assets(
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
        conditions.append("account_id = ?")
        params.append(account_id)
    elif authorized is not None:
        placeholders = ",".join("?" for _ in authorized)
        conditions.append(f"account_id IN ({placeholders})")
        params.extend(list(authorized))

    if category:
        conditions.append("category = ?")
        params.append(category)
    if search:
        conditions.append("(platform_name LIKE ? OR domain LIKE ?)")
        search_pattern = f"%{search}%"
        params.extend([search_pattern, search_pattern])

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * limit

    async with get_db() as db:
        # Count total
        async with db.execute(f"SELECT COUNT(*) FROM digital_assets {where_clause}", params) as cur:
            total = (await cur.fetchone())[0]

        # Query items
        query = f"""
            SELECT id, account_id, platform_name, domain, category, registered_email,
                   first_detected_at, last_activity_at, source_email_id, confidence_score
            FROM digital_assets
            {where_clause}
            ORDER BY last_activity_at DESC
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

@router.get("/subscriptions")
async def get_subscriptions(
    account_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: Optional[int] = Query(None, ge=1),
    limit: Optional[int] = Query(None, ge=1, le=200),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)

    if authorized is not None and not authorized and not account_id:
        if page is not None or limit is not None:
            return {"items": [], "total": 0, "page": page or 1, "limit": limit or 30}
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

    if search:
        conditions.append("service_name LIKE ?")
        params.append(f"%{search}%")

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    async with get_db() as db:
        if page is not None or limit is not None:
            async with db.execute(f"SELECT COUNT(*) FROM subscriptions {where_clause}", params) as cur:
                total = (await cur.fetchone())[0]

            p = page or 1
            l = limit or 30
            offset = (p - 1) * l

            query = f"""
                SELECT id, account_id, service_name, currency, amount, cycle, invoice_date, source_email_id
                FROM subscriptions
                {where_clause}
                ORDER BY invoice_date DESC
                LIMIT ? OFFSET ?
            """
            async with db.execute(query, (*params, l, offset)) as cur:
                rows = await cur.fetchall()
                items = [dict(r) for r in rows]

            return {
                "items": items,
                "total": total,
                "page": p,
                "limit": l
            }
        else:
            query = f"""
                SELECT id, account_id, service_name, currency, amount, cycle, invoice_date, source_email_id
                FROM subscriptions
                {where_clause}
                ORDER BY invoice_date DESC
            """
            async with db.execute(query, params) as cur:
                rows = await cur.fetchall()
                return [dict(r) for r in rows]

@router.get("/categories")
async def get_digital_asset_categories(
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
            SELECT category, COUNT(*) as count
            FROM digital_assets
            {acc_filter}
            GROUP BY category
        """
        async with db.execute(query, params) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

@router.get("/export")
async def export_assets_csv(
    account_id: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)

    conditions = []
    params = []
    if account_id:
        conditions.append("account_id = ?")
        params.append(account_id)
    elif authorized is not None:
        if not authorized:
            conditions.append("1=0")
        else:
            placeholders = ",".join("?" for _ in authorized)
            conditions.append(f"account_id IN ({placeholders})")
            params.extend(list(authorized))

    acc_filter = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "平台/服务名称", "域名", "分类", "绑定邮箱", "首次检测时间", "最近活跃时间", "可信度"])

    async with get_db() as db:
        async with db.execute(f"SELECT * FROM digital_assets {acc_filter} ORDER BY last_activity_at DESC", params) as cur:
            async for r in cur:
                writer.writerow([
                    r["id"], r["platform_name"], r["domain"] or "", r["category"],
                    r["registered_email"] or "", r["first_detected_at"] or "",
                    r["last_activity_at"] or "", r["confidence_score"]
                ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data.encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=email_digital_assets.csv"}
    )
