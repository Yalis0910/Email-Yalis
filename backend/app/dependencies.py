from fastapi import Request, HTTPException, Depends, Header, Query
from typing import Optional, Dict, Any, Set
from app.services.auth_service import AuthService

async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    token_query: Optional[str] = Query(None, alias="token")
) -> Dict[str, Any]:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    elif token_query:
        token = token_query.strip()

    if not token:
        raise HTTPException(
            status_code=401,
            detail="请先登录系统",
            headers={"WWW-Authenticate": "Bearer"}
        )

    payload = await AuthService.verify_token(token)
    if not payload or "uid" not in payload:
        raise HTTPException(
            status_code=401,
            detail="登录凭证已过期或无效，请重新登录",
            headers={"WWW-Authenticate": "Bearer"}
        )

    user = await AuthService.get_user_profile(payload["uid"])
    if not user:
        raise HTTPException(
            status_code=401,
            detail="用户不存在或已被停用",
            headers={"WWW-Authenticate": "Bearer"}
        )

    return user

async def get_optional_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    token_query: Optional[str] = Query(None, alias="token")
) -> Optional[Dict[str, Any]]:
    try:
        return await get_current_user(request, authorization, token_query)
    except HTTPException:
        return None

def require_permission(perm_key: str):
    async def _checker(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if current_user.get("is_superadmin"):
            return current_user
        perms = current_user.get("all_permissions") or []
        if perm_key not in perms:
            raise HTTPException(
                status_code=403,
                detail=f"无权操作：缺少对应权限 [{perm_key}]"
            )
        return current_user
    return _checker

def get_authorized_account_ids(current_user: Dict[str, Any]) -> Optional[Set[str]]:
    """Returns None if superadmin (meaning all accounts), otherwise returns Set of account IDs"""
    if current_user.get("is_superadmin"):
        return None
    return set(current_user.get("authorized_accounts") or [])

def check_account_access(account_id: Optional[str], current_user: Dict[str, Any]):
    """Raises 403 if user specifies an account_id they are not authorized to view/operate"""
    if not account_id:
        return
    allowed = get_authorized_account_ids(current_user)
    if allowed is not None and account_id not in allowed:
        raise HTTPException(status_code=403, detail=f"无权访问或操作该邮箱账号 [{account_id}] 的数据")
