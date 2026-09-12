from fastapi import APIRouter, Query, Depends
from typing import Optional, Dict, Any
from app.services.stats_service import StatsService
from app.dependencies import get_current_user, check_account_access, get_authorized_account_ids

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("/overview")
async def get_overview(
    account_id: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    authorized = get_authorized_account_ids(current_user)
    data = await StatsService.get_overview(
        account_id=account_id,
        allowed_account_ids=list(authorized) if authorized is not None else None
    )
    return data
