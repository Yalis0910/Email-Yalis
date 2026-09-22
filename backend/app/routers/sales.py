from fastapi import APIRouter, HTTPException, Query, Body, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Union
from app.services.sales_service import SalesService
from app.dependencies import get_current_user, require_permission, check_account_access, get_authorized_account_ids

router = APIRouter(prefix="/api/sales", tags=["Sales CRM"])

class ContactTierUpdateRequest(BaseModel):
    tier: str # 'A', 'B', 'C', 'D'
    tier_reason: Optional[str] = None
    tier_locked: Optional[bool] = True
    deal_stage: Optional[str] = None # 'lead', 'inquiry', 'sample', 'quote', 'won', 'lost', 'stale'
    estimated_value: Optional[float] = None

class DealReviewRequest(BaseModel):
    deal_status: str # 'won' or 'lost'
    deal_amount: Optional[float] = 0.0
    currency: Optional[str] = "USD"
    user_notes: Optional[str] = ""
    model: Optional[str] = None

class PlaybookCreateRequest(BaseModel):
    scenario_type: str
    title: str
    trigger_pattern: Optional[Union[str, List[str]]] = ""
    trigger_patterns: Optional[Union[str, List[str]]] = None
    response_strategy: str = ""
    reply_template: Optional[str] = None
    template_text: Optional[str] = None
    source_contact_id: Optional[str] = None

class PlaybookUpdateRequest(BaseModel):
    scenario_type: Optional[str] = None
    title: Optional[str] = None
    trigger_pattern: Optional[Union[str, List[str]]] = None
    trigger_patterns: Optional[Union[str, List[str]]] = None
    response_strategy: Optional[str] = None
    reply_template: Optional[str] = None
    template_text: Optional[str] = None

class FollowUpDraftRequest(BaseModel):
    prompt_hint: Optional[str] = ""
    model: Optional[str] = None

class BatchTierRequest(BaseModel):
    account_id: Optional[str] = None
    limit: Optional[int] = 50
    mode: Optional[str] = "all_funnel"  # 'all_funnel' | 'top_active' | 'unrated'

@router.get("/contacts/tier-stats")
async def get_tier_stats(
    account_id: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Returns current counts of contacts in A, B, C, D tiers and unrated counts"""
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)
    return await SalesService.get_tier_stats(
        account_id=account_id,
        allowed_account_ids=list(authorized) if authorized is not None else None
    )

@router.get("/radar")
async def get_sales_radar(
    account_id: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Returns follow-up radar alerts for overdue high-potential leads"""
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)
    return await SalesService.get_follow_up_radar(
        account_id=account_id,
        allowed_account_ids=list(authorized) if authorized is not None else None
    )

@router.post("/contacts/{contact_id}/tier")
async def update_contact_tier(
    contact_id: str,
    data: ContactTierUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Manually updates and locks/unlocks contact tier and deal stage"""
    from app.database import get_db
    tier = data.tier.upper()
    if tier not in ["A", "B", "C", "D"]:
        raise HTTPException(status_code=400, detail="等级必须为 A, B, C 或 D")

    async with get_db() as db:
        c_cur = await db.execute("SELECT id, account_id FROM contacts WHERE id = ?", (contact_id,))
        contact = await c_cur.fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="未找到联系人")

        check_account_access(contact["account_id"], current_user)

    updated = await SalesService.update_contact_tier(
        contact_id=contact_id,
        tier=tier,
        tier_reason=data.tier_reason,
        tier_locked=data.tier_locked,
        deal_stage=data.deal_stage,
        estimated_value=data.estimated_value
    )
    return {"status": "ok", "contact": updated}

@router.post("/contacts/{contact_id}/evaluate-tier")
async def evaluate_contact_tier(
    contact_id: str,
    force_refresh: bool = Query(False),
    model: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Triggers AI evaluation of contact tier based on historical emails"""
    from app.database import get_db
    async with get_db() as db:
        c_cur = await db.execute("SELECT id, account_id FROM contacts WHERE id = ?", (contact_id,))
        contact = await c_cur.fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="未找到联系人")
        check_account_access(contact["account_id"], current_user)

    res = await SalesService.evaluate_contact_tier(contact_id, force_refresh=force_refresh, model=model)
    return res

@router.post("/contacts/{contact_id}/review-deal")
async def review_contact_deal(
    contact_id: str,
    data: DealReviewRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Conducts deep win/loss analysis on contact email journey and extracts playbook tactics"""
    from app.database import get_db
    if data.deal_status not in ["won", "lost"]:
        raise HTTPException(status_code=400, detail="交易状态必须为 won 或 lost")

    async with get_db() as db:
        c_cur = await db.execute("SELECT id, account_id FROM contacts WHERE id = ?", (contact_id,))
        contact = await c_cur.fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="未找到联系人")
        check_account_access(contact["account_id"], current_user)

    res = await SalesService.review_contact_deal(
        contact_id=contact_id,
        deal_status=data.deal_status,
        deal_amount=data.deal_amount or 0.0,
        currency=data.currency or "USD",
        user_notes=data.user_notes or "",
        model=data.model
    )
    return res

@router.get("/contacts/{contact_id}/reviews")
async def get_contact_reviews(
    contact_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Gets history deal review archives for a contact"""
    return await SalesService.get_contact_deal_reviews(contact_id)

@router.post("/contacts/{contact_id}/generate-follow-up")
async def generate_follow_up_stream(
    contact_id: str,
    data: FollowUpDraftRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Streams a high-conversion reactivation/follow-up email draft"""
    generator = SalesService.stream_follow_up_draft(
        contact_id=contact_id,
        prompt_hint=data.prompt_hint or "",
        model=data.model
    )
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post("/batch-tier")
async def batch_tier_stream(
    data: BatchTierRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Streams batch contact classification progress"""
    check_account_access(data.account_id, current_user)
    authorized = get_authorized_account_ids(current_user)
    generator = SalesService.batch_evaluate_contacts(
        account_id=data.account_id,
        limit=data.limit or 50,
        mode=data.mode or "all_funnel",
        allowed_account_ids=list(authorized) if authorized is not None else None
    )
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.get("/playbook")
async def list_sales_playbooks(
    scenario_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Lists sales playbooks and response templates"""
    return await SalesService.list_playbooks(scenario_type=scenario_type, search=search)

@router.post("/playbook")
async def create_sales_playbook(
    data: PlaybookCreateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Creates a custom sales playbook entry"""
    return await SalesService.create_playbook(data.dict())

@router.put("/playbook/{playbook_id}")
async def update_sales_playbook(
    playbook_id: str,
    data: PlaybookUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Updates an existing sales playbook entry"""
    res = await SalesService.update_playbook(playbook_id, data.dict(exclude_unset=True))
    if not res:
        raise HTTPException(status_code=404, detail="未找到指定话术条目")
    return res

@router.delete("/playbook/{playbook_id}")
async def delete_sales_playbook(
    playbook_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Deletes a sales playbook entry with protection for system presets"""
    try:
        ok = await SalesService.delete_playbook(playbook_id)
        if not ok:
            raise HTTPException(status_code=404, detail="未找到指定话术条目")
        return {"status": "ok"}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

@router.post("/playbook/reset-presets")
async def reset_sales_playbook_presets(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Restores default system playbooks if missing"""
    await SalesService.reset_default_playbooks()
    return {"status": "ok", "message": "系统内置实战话术已重新校准恢复"}
