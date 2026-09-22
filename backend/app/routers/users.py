import uuid
import json
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app.database import get_db
from app.services.auth_service import (
    AuthService,
    PAGE_PERMISSIONS,
    ACTION_PERMISSIONS,
    ALL_PERMISSION_KEYS
)
from app.dependencies import get_current_user, require_permission

router = APIRouter(prefix="/api/users", tags=["Users & RBAC"])

class LoginRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class UserCreateRequest(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = ""
    group_id: Optional[str] = None
    account_ids: Optional[List[str]] = []

class UserUpdateRequest(BaseModel):
    display_name: Optional[str] = ""
    group_id: Optional[str] = None
    is_active: Optional[bool] = True
    account_ids: Optional[List[str]] = []

class ResetPasswordRequest(BaseModel):
    new_password: str

class GroupCreateOrUpdateRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    page_permissions: List[str] = []
    action_permissions: List[str] = []
    account_ids: List[str] = []

@router.post("/login")
async def login(req: LoginRequest):
    user = await AuthService.authenticate_user(req.username, req.password)
    if not user:
        raise HTTPException(status_code=400, detail="用户名或密码错误，或账号已被停用")

    token = await AuthService.create_token(user["id"], user["username"])
    return {
        "status": "success",
        "token": token,
        "user": user
    }

@router.get("/me")
async def get_me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return current_user

@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    if len(req.new_password.strip()) < 4:
        raise HTTPException(status_code=400, detail="新密码长度不能少于 4 位字符")

    async with get_db() as db:
        async with db.execute(
            "SELECT password_hash, salt FROM users WHERE id = ?",
            (current_user["id"],)
        ) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="用户不存在")
            pwd_hash, salt = row[0], row[1]

        if not AuthService.verify_password(req.old_password, salt, pwd_hash):
            raise HTTPException(status_code=400, detail="原密码不正确")

        new_hash, new_salt = AuthService.hash_password(req.new_password)
        await db.execute(
            "UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (new_hash, new_salt, current_user["id"])
        )
        await db.commit()
        AuthService.invalidate_user_cache(current_user["id"])

    return {"status": "success", "message": "密码修改成功，请使用新密码"}

@router.get("/rbac/permissions-meta")
async def get_permissions_meta(current_user: Dict[str, Any] = Depends(get_current_user)):
    return {
        "page_permissions": PAGE_PERMISSIONS,
        "action_permissions": ACTION_PERMISSIONS
    }

# ==================== User Management Endpoints ====================

@router.get("/list")
async def list_users(current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))):
    async with get_db() as db:
        async with db.execute("""
            SELECT u.id, u.username, u.display_name, u.group_id, u.is_superadmin, u.is_active,
                   u.created_at, u.updated_at,
                   g.name as group_name
            FROM users u
            LEFT JOIN user_groups g ON u.group_id = g.id
            ORDER BY u.is_superadmin DESC, u.created_at ASC
        """) as cur:
            rows = await cur.fetchall()

        users_list = []
        for r in rows:
            u = dict(r)
            # Fetch personal extra mailboxes
            async with db.execute("SELECT account_id FROM user_account_permissions WHERE user_id = ?", (u["id"],)) as c_acc:
                u_accs = [row[0] for row in await c_acc.fetchall()]
            u["extra_account_ids"] = u_accs
            users_list.append(u)

        return users_list

@router.post("")
async def create_user(
    req: UserCreateRequest,
    current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))
):
    username = req.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if len(req.password.strip()) < 4:
        raise HTTPException(status_code=400, detail="初始密码长度不能少于 4 位字符")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    pwd_hash, salt = AuthService.hash_password(req.password)

    async with get_db() as db:
        # Check duplicate username
        async with db.execute("SELECT id FROM users WHERE username = ?", (username,)) as cur:
            if await cur.fetchone():
                raise HTTPException(status_code=400, detail=f"用户名 [{username}] 已被占用")

        await db.execute("""
            INSERT INTO users (id, username, password_hash, salt, display_name, group_id, is_superadmin, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
        """, (user_id, username, pwd_hash, salt, req.display_name or username, req.group_id))

        # Insert user personal accounts
        if req.account_ids:
            for acc_id in set(req.account_ids):
                await db.execute(
                    "INSERT OR IGNORE INTO user_account_permissions (user_id, account_id) VALUES (?, ?)",
                    (user_id, acc_id)
                )

        await db.commit()

    return {"status": "success", "message": f"用户 [{username}] 创建成功", "user_id": user_id}

@router.put("/{user_id}")
async def update_user(
    user_id: str,
    req: UserUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))
):
    async with get_db() as db:
        async with db.execute("SELECT id, username, is_superadmin FROM users WHERE id = ?", (user_id,)) as cur:
            target = await cur.fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="用户不存在")
            is_super = bool(target[2])

        # Cannot deactivate superadmin
        if is_super and req.is_active is False:
            raise HTTPException(status_code=400, detail="不可停用超级管理员账号")

        await db.execute("""
            UPDATE users
            SET display_name = ?, group_id = ?, is_active = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        """, (req.display_name, req.group_id, 1 if req.is_active else 0, user_id))

        # Update personal account assignments
        await db.execute("DELETE FROM user_account_permissions WHERE user_id = ?", (user_id,))
        if req.account_ids:
            for acc_id in set(req.account_ids):
                await db.execute(
                    "INSERT OR IGNORE INTO user_account_permissions (user_id, account_id) VALUES (?, ?)",
                    (user_id, acc_id)
                )

        await db.commit()
        AuthService.invalidate_user_cache(user_id)

    return {"status": "success", "message": "用户信息已更新"}

@router.post("/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    req: ResetPasswordRequest,
    current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))
):
    if len(req.new_password.strip()) < 4:
        raise HTTPException(status_code=400, detail="新密码不能少于 4 位字符")

    new_hash, new_salt = AuthService.hash_password(req.new_password)
    async with get_db() as db:
        async with db.execute("SELECT id FROM users WHERE id = ?", (user_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="用户不存在")

        await db.execute("""
            UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        """, (new_hash, new_salt, user_id))
        await db.commit()
        AuthService.invalidate_user_cache(user_id)

    return {"status": "success", "message": "用户密码已重置"}

@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))
):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="不可删除当前正在登录的账号")

    async with get_db() as db:
        async with db.execute("SELECT is_superadmin FROM users WHERE id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="用户不存在")
            if bool(row[0]):
                raise HTTPException(status_code=400, detail="超级管理员账号受系统保护，不可删除")

        await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()
        AuthService.invalidate_user_cache(user_id)

    return {"status": "success", "message": "用户已成功删除"}

# ==================== User Group RBAC Endpoints ====================

@router.get("/groups/list")
async def list_groups(current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))):
    async with get_db() as db:
        async with db.execute("""
            SELECT g.id, g.name, g.description, g.page_permissions_json, g.action_permissions_json,
                   g.created_at, g.updated_at,
                   COUNT(u.id) as member_count
            FROM user_groups g
            LEFT JOIN users u ON u.group_id = g.id
            GROUP BY g.id
            ORDER BY g.created_at ASC
        """) as cur:
            rows = await cur.fetchall()

        groups = []
        for r in rows:
            g = dict(r)
            try:
                g["page_permissions"] = json.loads(g.get("page_permissions_json") or "[]")
            except Exception:
                g["page_permissions"] = []
            try:
                g["action_permissions"] = json.loads(g.get("action_permissions_json") or "[]")
            except Exception:
                g["action_permissions"] = []

            # Get group accounts
            async with db.execute(
                "SELECT account_id FROM group_account_permissions WHERE group_id = ?",
                (g["id"],)
            ) as c_acc:
                g["account_ids"] = [row[0] for row in await c_acc.fetchall()]

            groups.append(g)

        return groups

@router.post("/groups")
async def create_group(
    req: GroupCreateOrUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))
):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="管理组名称不能为空")

    group_id = f"grp_{uuid.uuid4().hex[:10]}"
    pages_json = json.dumps(req.page_permissions)
    actions_json = json.dumps(req.action_permissions)

    async with get_db() as db:
        async with db.execute("SELECT id FROM user_groups WHERE name = ?", (name,)) as cur:
            if await cur.fetchone():
                raise HTTPException(status_code=400, detail=f"管理组名称 [{name}] 已存在")

        await db.execute("""
            INSERT INTO user_groups (id, name, description, page_permissions_json, action_permissions_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
        """, (group_id, name, req.description, pages_json, actions_json))

        # Associate mailboxes
        for acc_id in set(req.account_ids):
            await db.execute(
                "INSERT OR IGNORE INTO group_account_permissions (group_id, account_id) VALUES (?, ?)",
                (group_id, acc_id)
            )

        await db.commit()
        AuthService.invalidate_user_cache()

    return {"status": "success", "message": f"管理组 [{name}] 创建成功", "group_id": group_id}

@router.put("/groups/{group_id}")
async def update_group(
    group_id: str,
    req: GroupCreateOrUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))
):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="管理组名称不能为空")

    pages_json = json.dumps(req.page_permissions)
    actions_json = json.dumps(req.action_permissions)

    async with get_db() as db:
        async with db.execute("SELECT id FROM user_groups WHERE id = ?", (group_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="管理组不存在")

        # Check name collision
        async with db.execute("SELECT id FROM user_groups WHERE name = ? AND id != ?", (name, group_id)) as cur:
            if await cur.fetchone():
                raise HTTPException(status_code=400, detail=f"管理组名称 [{name}] 与其他组重名")

        await db.execute("""
            UPDATE user_groups
            SET name = ?, description = ?, page_permissions_json = ?, action_permissions_json = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        """, (name, req.description, pages_json, actions_json, group_id))

        # Re-sync group account permissions
        await db.execute("DELETE FROM group_account_permissions WHERE group_id = ?", (group_id,))
        for acc_id in set(req.account_ids):
            await db.execute(
                "INSERT OR IGNORE INTO group_account_permissions (group_id, account_id) VALUES (?, ?)",
                (group_id, acc_id)
            )

        await db.commit()
        AuthService.invalidate_user_cache()

    return {"status": "success", "message": "管理组配置已更新"}

@router.delete("/groups/{group_id}")
async def delete_group(
    group_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("action:rbac_manage"))
):
    if group_id in ("group_superadmin", "group_normal_admin", "group_business_admin"):
        raise HTTPException(status_code=400, detail="系统内置默认管理组不可删除，您可按需调整其权限与授权邮箱")

    async with get_db() as db:
        async with db.execute("SELECT id FROM user_groups WHERE id = ?", (group_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="管理组不存在")

        await db.execute("DELETE FROM user_groups WHERE id = ?", (group_id,))
        await db.commit()
        AuthService.invalidate_user_cache()

    return {"status": "success", "message": "管理组已删除，组内成员已变更为未分配组"}
