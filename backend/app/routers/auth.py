import json
import base64
import asyncio
import urllib.request
from fastapi import APIRouter, HTTPException, Depends, Request, UploadFile, File, Response
from fastapi.responses import HTMLResponse
from typing import Optional, Dict, Any, List

from app.config import CREDENTIALS_FILE, DATA_DIR, AVATARS_DIR, OAUTH_REDIRECT_URI
from app.database import get_db
from app.schemas import AccountOut
from app.services.imap_sync import GenericImapService, PROVIDER_DEFAULTS
from app.services.gmail_auth import GmailAuthService
from app.services.demo_data import seed_demo_data
from app.dependencies import get_current_user, require_permission, get_authorized_account_ids

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.get("/google/status")
async def get_google_oauth_status(current_user: Dict[str, Any] = Depends(get_current_user)):
    info = GmailAuthService.get_credentials_info()
    return {
        "configured": bool(info and info.get("configured")),
        "client_id": info.get("client_id") if info else None,
        "project_id": info.get("project_id") if info else None,
        "client_type": info.get("client_type") if info else None,
        "redirect_uri": OAUTH_REDIRECT_URI
    }

@router.post("/google/credentials")
async def upload_google_credentials(
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("action:accounts_manage"))
):
    content_dict = None
    content_type = request.headers.get("content-type", "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        file_obj = form.get("file")
        if file_obj and hasattr(file_obj, "read"):
            try:
                raw_bytes = await file_obj.read()
                content_dict = json.loads(raw_bytes.decode("utf-8"))
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"无法解析上传的 JSON 文件: {str(e)}")
    else:
        try:
            content_dict = await request.json()
        except Exception:
            pass

    if not content_dict or not isinstance(content_dict, dict):
        raise HTTPException(status_code=400, detail="请上传有效的 Google 客户端凭据 JSON 文件或提交配置内容")

    # Validate client_secrets structure
    client_type = "web" if "web" in content_dict else ("installed" if "installed" in content_dict else None)
    if not client_type:
        raise HTTPException(
            status_code=400,
            detail="无效的 Google 客户端凭据文件：未找到 'web' 或 'installed' 配置节点，请确认是从 Google Cloud 凭据页面下载的客户端密钥 JSON 文件。"
        )

    info = content_dict[client_type]
    if not info.get("client_id") or not info.get("client_secret"):
        raise HTTPException(
            status_code=400,
            detail="凭据文件中缺少 client_id 或 client_secret，请检查文件是否完整。"
        )

    # Save to CREDENTIALS_FILE
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CREDENTIALS_FILE, "w", encoding="utf-8") as f:
        json.dump(content_dict, f, indent=2, ensure_ascii=False)

    return {
        "status": "success",
        "message": "Google OAuth 客户端凭据已成功导入并就绪！",
        "info": {
            "client_id": info.get("client_id"),
            "project_id": info.get("project_id"),
            "client_type": client_type,
            "configured": True
        }
    }

@router.delete("/google/credentials")
async def delete_google_credentials(
    current_user: Dict[str, Any] = Depends(require_permission("action:accounts_manage"))
):
    if CREDENTIALS_FILE.exists():
        try:
            CREDENTIALS_FILE.unlink()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"删除凭据文件失败: {str(e)}")
    return {"status": "success", "message": "已清除 Google OAuth 凭据配置"}

@router.get("/google/url")
async def get_google_auth_url(
    frontend_origin: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(require_permission("action:accounts_manage"))
):
    if not GmailAuthService.is_credentials_configured():
        raise HTTPException(status_code=400, detail="系统尚未配置 Google OAuth 客户端凭据 (credentials.json)，请先上传凭据文件")

    # Encode user_id and origin into state so callback can route and authorize
    state_payload = {
        "user_id": current_user["id"],
        "origin": frontend_origin or "http://localhost:5173"
    }
    state_str = base64.urlsafe_b64encode(json.dumps(state_payload).encode()).decode()

    try:
        flow = GmailAuthService.create_oauth_flow()
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',
            state=state_str
        )
        return {"auth_url": auth_url, "state": state_str}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成 Google 授权链接失败: {str(e)}")

@router.get("/callback")
async def google_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None
):
    # Decode state if possible
    user_id = None
    frontend_origin = "http://localhost:5173"
    if state:
        try:
            state_data = json.loads(base64.urlsafe_b64decode(state.encode()).decode())
            user_id = state_data.get("user_id")
            frontend_origin = state_data.get("origin") or frontend_origin
        except Exception:
            pass

    if error:
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Google 授权失败</title>
        <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0d0e; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
        .card {{ background: #18191b; border: 1px solid #ff4d4f; border-radius: 12px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }}
        h2 {{ color: #ff4d4f; margin-top: 0; }} p {{ color: #a1a1aa; font-size: 14px; line-height: 1.6; word-break: break-all; }}
        button {{ margin-top: 16px; padding: 8px 20px; border-radius: 6px; border: none; background: #27272a; color: #fff; cursor: pointer; }}
        </style></head>
        <body>
        <div class="card">
            <h2>授权未完成</h2>
            <p>Google 返回授权提示: <code>{error}</code></p>
            <button onclick="window.close()">关闭此窗口</button>
        </div>
        </body></html>
        """
        return HTMLResponse(content=html, status_code=400)

    if not code:
        raise HTTPException(status_code=400, detail="缺少授权 Code")

    try:
        acc = await GmailAuthService.exchange_code_and_save_account(code, user_id=user_id)
        email = acc.get("email", "")
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Google 授权成功</title>
        <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0d0e; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
        .card {{ background: #18191b; border: 1px solid #10b981; border-radius: 12px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }}
        h2 {{ color: #10b981; margin-top: 0; }} p {{ color: #a1a1aa; font-size: 14px; line-height: 1.6; }}
        .email {{ font-weight: bold; color: #fff; background: #27272a; padding: 6px 14px; border-radius: 6px; display: inline-block; margin: 10px 0; font-family: monospace; }}
        </style></head>
        <body>
        <div class="card">
            <h2>✅ Google 官方授权接入成功！</h2>
            <p>已成功通过 Google REST API 接入邮箱：</p>
            <div class="email">{email}</div>
            <p>正在同步账户状态，窗口即将自动关闭并刷新页面...</p>
        </div>
        <script>
        const payload = {{ type: 'GOOGLE_OAUTH_SUCCESS', account: {json.dumps(acc)}, email: '{email}' }};
        if (window.opener) {{
            window.opener.postMessage(payload, '*');
            setTimeout(() => {{ window.close(); }}, 1200);
        }} else {{
            setTimeout(() => {{ window.location.href = '{frontend_origin}/#settings'; }}, 1500);
        }}
        </script>
        </body></html>
        """
        return HTMLResponse(content=html)
    except Exception as e:
        err_str = str(e)
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>授权交换失败</title>
        <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0d0e; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
        .card {{ background: #18191b; border: 1px solid #ff4d4f; border-radius: 12px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }}
        h2 {{ color: #ff4d4f; margin-top: 0; }} p {{ color: #a1a1aa; font-size: 14px; line-height: 1.6; word-break: break-all; }}
        button {{ margin-top: 16px; padding: 8px 20px; border-radius: 6px; border: none; background: #27272a; color: #fff; cursor: pointer; }}
        </style></head>
        <body>
        <div class="card">
            <h2>授权凭据交换异常</h2>
            <p>{err_str}</p>
            <button onclick="window.close()">关闭此窗口</button>
        </div>
        </body></html>
        """
        return HTMLResponse(content=html, status_code=500)

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


def _format_acc(row_dict: dict) -> dict:
    if row_dict.get("avatar_url"):
        row_dict["avatar_url"] = f"/api/auth/accounts/{row_dict['id']}/avatar"
    return row_dict


@router.get("/accounts", response_model=List[AccountOut])
async def list_accounts(current_user: Dict[str, Any] = Depends(get_current_user)):
    authorized = get_authorized_account_ids(current_user)
    async with get_db() as db:
        if authorized is None:
            # Superadmin: all accounts
            async with db.execute("SELECT * FROM accounts ORDER BY created_at DESC") as c:
                rows = await c.fetchall()
                return [_format_acc(dict(r)) for r in rows]
        else:
            if not authorized:
                return []
            placeholders = ",".join("?" for _ in authorized)
            async with db.execute(
                f"SELECT * FROM accounts WHERE id IN ({placeholders}) ORDER BY created_at DESC",
                list(authorized)
            ) as c:
                rows = await c.fetchall()
                return [_format_acc(dict(r)) for r in rows]


@router.get("/accounts/{account_id}/avatar")
async def get_account_avatar(account_id: str):
    """
    Get account avatar with local caching and proxying to prevent cross-origin/GFW issues.
    Falls back to dynamically generated SVG avatar if image cannot be loaded.
    """
    # 1. Check local cache (.png, .jpg, .webp)
    for ext, media_type in [(".png", "image/png"), (".jpg", "image/jpeg"), (".webp", "image/webp")]:
        file_path = AVATARS_DIR / f"{account_id}{ext}"
        if file_path.exists() and file_path.stat().st_size > 0:
            return Response(
                content=file_path.read_bytes(),
                media_type=media_type,
                headers={"Cache-Control": "public, max-age=86400"}
            )

    # 2. Query account info from DB
    avatar_url = None
    display_name = ""
    email = ""
    async with get_db() as db:
        async with db.execute("SELECT email, display_name, avatar_url FROM accounts WHERE id = ?", (account_id,)) as cur:
            row = await cur.fetchone()
            if row:
                email = row["email"] or ""
                display_name = row["display_name"] or ""
                avatar_url = row["avatar_url"]

    # 3. If avatar_url is remote, try to download and cache it
    if avatar_url and avatar_url.startswith("http"):
        try:
            req = urllib.request.Request(
                avatar_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            )
            loop = asyncio.get_event_loop()
            def _fetch():
                with urllib.request.urlopen(req, timeout=5) as resp:
                    return resp.read()
            data = await loop.run_in_executor(None, _fetch)
            if data:
                media_type = "image/png" if data.startswith(b'\x89PNG') else "image/jpeg"
                ext = ".png" if media_type == "image/png" else ".jpg"
                save_path = AVATARS_DIR / f"{account_id}{ext}"
                save_path.write_bytes(data)
                return Response(
                    content=data,
                    media_type=media_type,
                    headers={"Cache-Control": "public, max-age=86400"}
                )
        except Exception:
            pass

    # 4. Fallback: generate a clean SVG avatar with the account initial
    initial = (display_name or email or "?")[:1].upper()
    palette = [
        ("#4F46E5", "#818CF8"),
        ("#0D9488", "#2DD4BF"),
        ("#D97706", "#FBBF24"),
        ("#E11D48", "#FB7185"),
        ("#7C3AED", "#A78BFA"),
        ("#2563EB", "#60A5FA"),
        ("#059669", "#34D399"),
    ]
    color_idx = sum(ord(c) for c in email) % len(palette) if email else 0
    c1, c2 = palette[color_idx]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
        f'<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">'
        f'<stop offset="0%" stop-color="{c1}"/><stop offset="100%" stop-color="{c2}"/>'
        f'</linearGradient></defs>'
        f'<rect width="96" height="96" rx="48" fill="url(#g)"/>'
        f'<text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" '
        f'font-size="40" font-weight="600" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">{initial}</text>'
        f'</svg>'
    )
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600"})

@router.post("/accounts/{account_id}/clear_emails")
async def clear_account_emails(
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

        # Fast explicit cleanup of email data while PRESERVING account and permissions
        await db.execute("DELETE FROM digital_assets WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM subscriptions WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM contact_ai_reports WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM contacts WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM email_ai_insights WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM attachments WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM emails WHERE account_id = ?", (account_id,))
        await db.execute("DELETE FROM email_fts WHERE account_id = ?", (account_id,))

        # Reset account statistics and progress
        await db.execute("""
            UPDATE accounts SET
                total_synced = 0,
                sync_progress_current = 0,
                sync_progress_total = 0,
                sync_status = 'idle',
                sync_message = '邮件与资产已清空，等待重新同步',
                history_id = NULL
            WHERE id = ?
        """, (account_id,))
        await db.commit()

    # Clean local attachment files if present
    try:
        acc_att_dir = ATTACHMENTS_DIR / account_id
        if acc_att_dir.exists():
            shutil.rmtree(acc_att_dir, ignore_errors=True)
    except Exception:
        pass

    # Rebuild contact cache asynchronously in background
    try:
        from app.services.stats_service import StatsService
        await StatsService.rebuild_contacts()
    except Exception:
        pass

    return {
        "status": "success",
        "message": f"账号 {acc_email} 的 {email_count} 封邮件与本地资产缓存已成功清空！账号配置已保留。",
        "cleared_emails": email_count,
        "account_id": account_id
    }

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
        await db.execute("DELETE FROM email_fts WHERE account_id = ?", (account_id,))
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
