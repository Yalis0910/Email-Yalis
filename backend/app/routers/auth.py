from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any, List

from app.database import get_db
from app.schemas import AccountOut
from app.services.imap_sync import GenericImapService, PROVIDER_DEFAULTS
from app.services.demo_data import seed_demo_data
from app.dependencies import get_current_user, require_permission, get_authorized_account_ids

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/connect_imap")
async def connect_imap(
    data: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(require_permission("action:accounts_manage"))
):
    email_addr = data.get("email", "").strip()
    app_password = (data.get("password") or data.get("app_password") or "").strip()
    provider = data.get("provider", "custom").strip().lower()
    
    # Defaults based on provider
    prov_def = PROVIDER_DEFAULTS.get(provider, {"host": "imap.gmail.com", "port": 993, "ssl": True})
    imap_host = (data.get("imap_host") or prov_def.get("host", "imap.gmail.com")).strip()
    imap_port = int(data.get("imap_port") or prov_def.get("port", 993))
    use_ssl = bool(data.get("use_ssl", prov_def.get("ssl", True)))

    if not email_addr or not app_password:
        raise HTTPException(status_code=400, detail="请填写完整邮箱地址与应用密码/授权码")

    if not imap_host:
        raise HTTPException(status_code=400, detail="请填写有效的 IMAP 服务器地址")

    try:
        acc = await GenericImapService.save_imap_account(
            email_addr=email_addr,
            password=app_password,
            provider=provider,
            imap_host=imap_host,
            imap_port=imap_port,
            use_ssl=use_ssl
        )
        # If user is not superadmin, also give user individual access to this newly created account
        if not current_user.get("is_superadmin") and acc and "id" in acc:
            async with get_db() as db:
                await db.execute(
                    "INSERT OR IGNORE INTO user_account_permissions (user_id, account_id) VALUES (?, ?)",
                    (current_user["id"], acc["id"])
                )
                await db.commit()

        return {"status": "success", "account": acc, "message": f"{email_addr} 邮箱验证成功并已接入！"}
    except Exception as e:
        err_msg = str(e)
        if "AUTHENTICATIONFAILED" in err_msg.upper() or "LOGIN FAILED" in err_msg.upper() or "AUTHENTICATE FAILED" in err_msg.upper():
            if provider == "gmail":
                detail_msg = "认证失败：请确保 Google 账号已开启「两步验证」，并使用的是 16 位「应用专用密码」，而非登录密码。"
            elif provider in ("qq", "163", "126"):
                detail_msg = f"认证失败：{provider.upper()} 邮箱通常需在网页版邮箱设置中开启「POP3/IMAP 服务」并生成专用「授权码」，而非账号登录密码。"
            elif provider == "outlook":
                detail_msg = "认证失败：Outlook 账号如开启了双重验证，需使用微软账户生成的应用密码，并确保已在设置中开启 IMAP 访问权限。"
            else:
                detail_msg = f"认证失败：邮箱服务器拒绝了该账号或密码，请检查是否需要生成专用的「客户端授权码/应用密码」。"
            raise HTTPException(status_code=400, detail=detail_msg)
        raise HTTPException(status_code=400, detail=f"连接失败: {err_msg}")


@router.get("/accounts", response_model=List[AccountOut])
async def list_accounts(current_user: Dict[str, Any] = Depends(get_current_user)):
    authorized = get_authorized_account_ids(current_user)
    async with get_db() as db:
        if authorized is None:
            # Superadmin: all accounts
            async with db.execute("SELECT * FROM accounts ORDER BY created_at DESC") as c:
                rows = await c.fetchall()
                return [dict(r) for r in rows]
        else:
            if not authorized:
                return []
            placeholders = ",".join("?" for _ in authorized)
            async with db.execute(
                f"SELECT * FROM accounts WHERE id IN ({placeholders}) ORDER BY created_at DESC",
                list(authorized)
            ) as c:
                rows = await c.fetchall()
                return [dict(r) for r in rows]

@router.delete("/accounts/{account_id}")
async def delete_account(
    account_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("action:accounts_manage"))
):
    import shutil
    from app.config import ATTACHMENTS_DIR
    from app.services.gmail_sync import SYNC_PROGRESS

    SYNC_PROGRESS.pop(account_id, None)

    async with get_db() as db:
        # Check account existence
        async with db.execute("SELECT id, email FROM accounts WHERE id = ?", (account_id,)) as cur:
            acc_row = await cur.fetchone()
            if not acc_row:
                raise HTTPException(status_code=404, detail="未找到该邮箱账号")
            acc_email = acc_row["email"]

        # Count emails for clear user feedback
        async with db.execute("SELECT COUNT(*) FROM emails WHERE account_id = ?", (account_id,)) as cur:
            email_count = (await cur.fetchone())[0]

        # Fast explicit cleanup in transaction
        await db.execute("DELETE FROM digital_assets WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM subscriptions WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM contact_ai_reports WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM contacts WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM email_ai_insights WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM attachments WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM user_account_permissions WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM group_account_permissions WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM emails WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        await db.commit()

    # Clean local attachment files if present
    try:
        acc_att_dir = ATTACHMENTS_DIR / account_id
        if acc_att_dir.exists():
            shutil.rmtree(acc_att_dir, ignore_errors=True)
    except Exception:
        pass

    return {
        "status": "success",
        "message": f"邮箱账号 {acc_email} 及其关联的 {email_count} 封邮件与资产数据已成功彻底移除！",
        "deleted_emails": email_count,
        "account_id": account_id
    }

@router.post("/seed_demo")
async def seed_demo(current_user: Dict[str, Any] = Depends(require_permission("action:system_ops"))):
    res = await seed_demo_data()
    return res
