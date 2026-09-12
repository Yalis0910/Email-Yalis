import asyncio
import json
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse
from typing import Dict, Any
from app.schemas import SyncTriggerRequest, AutoSyncSettingsResponse, AutoSyncSettingsUpdate
from app.services.gmail_sync import GmailSyncService, SYNC_PROGRESS, get_or_create_sync_queue, remove_sync_queue
from app.services.imap_sync import GenericImapService
from app.services.auto_sync_service import AutoSyncScheduler
from app.database import get_db
from app.dependencies import get_current_user, require_permission, get_authorized_account_ids, check_account_access

router = APIRouter(prefix="/api/sync", tags=["sync"])

@router.get("/auto-settings", response_model=AutoSyncSettingsResponse)
async def get_auto_sync_settings(current_user: Dict[str, Any] = Depends(get_current_user)):
    return await AutoSyncScheduler.get_settings()

@router.post("/auto-settings", response_model=AutoSyncSettingsResponse)
async def update_auto_sync_settings(
    data: AutoSyncSettingsUpdate,
    current_user: Dict[str, Any] = Depends(require_permission("action:system_ops"))
):
    return await AutoSyncScheduler.update_settings(
        enabled=data.auto_sync_enabled,
        interval_minutes=data.auto_sync_interval_minutes
    )

@router.post("/auto-trigger")
async def trigger_auto_sync_now(current_user: Dict[str, Any] = Depends(require_permission("action:sync_trigger"))):
    res = await AutoSyncScheduler.run_incremental_sync_all()
    return res

@router.post("/trigger")
async def trigger_sync(
    req: SyncTriggerRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(require_permission("action:sync_trigger"))
):
    check_account_access(req.account_id, current_user)
    async with get_db() as db:
        async with db.execute("SELECT id, email, sync_status, refresh_token FROM accounts WHERE id = ?", (req.account_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="未找到该账号")
            is_active_in_mem = req.account_id in SYNC_PROGRESS and SYNC_PROGRESS[req.account_id].get("status") == "syncing"
            if row["sync_status"] == "syncing" and is_active_in_mem and not req.force:
                return {"status": "already_syncing", "message": "该账号正在同步中，请稍候"}
            has_refresh = bool(row["refresh_token"])

    # Run in background
    if has_refresh:
        asyncio.create_task(GmailSyncService.sync_account_emails(
            account_id=req.account_id,
            full_sync=req.full_sync,
            max_results=req.max_results
        ))
    else:
        asyncio.create_task(GenericImapService.sync_imap_emails(
            account_id=req.account_id,
            max_results=req.max_results,
            full_sync=req.full_sync
        ))

    return {"status": "started", "message": "已成功启动邮件资产全量抓取与挖掘任务"}

@router.post("/trigger-all")
async def trigger_sync_all(
    force: bool = False,
    full_sync: bool = False,
    current_user: Dict[str, Any] = Depends(require_permission("action:sync_trigger"))
):
    authorized = get_authorized_account_ids(current_user)
    async with get_db() as db:
        if authorized is None:
            async with db.execute("SELECT id, email, sync_status, refresh_token FROM accounts") as cur:
                rows = await cur.fetchall()
        else:
            if not authorized:
                raise HTTPException(status_code=403, detail="当前账号未分配任何邮箱权限")
            placeholders = ",".join("?" for _ in authorized)
            async with db.execute(
                f"SELECT id, email, sync_status, refresh_token FROM accounts WHERE id IN ({placeholders})",
                list(authorized)
            ) as cur:
                rows = await cur.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="暂无已授权的邮箱账号")

    started = []
    skipped = []
    for row in rows:
        acc_id = row["id"]
        is_active_in_mem = acc_id in SYNC_PROGRESS and SYNC_PROGRESS[acc_id].get("status") == "syncing"
        if row["sync_status"] == "syncing" and is_active_in_mem and not force:
            skipped.append(row["email"])
            continue

        has_refresh = bool(row["refresh_token"])
        if has_refresh:
            asyncio.create_task(GmailSyncService.sync_account_emails(
                account_id=acc_id,
                full_sync=full_sync
            ))
        else:
            asyncio.create_task(GenericImapService.sync_imap_emails(
                account_id=acc_id,
                full_sync=full_sync
            ))
        started.append(row["email"])

    return {
        "status": "started",
        "started_count": len(started),
        "started_accounts": started,
        "skipped_accounts": skipped,
        "message": f"已成功启动 {len(started)} 个账号的邮件同步任务" if started else "所有账号均已在同步中"
    }

@router.get("/status/{account_id}")
async def get_sync_status(
    account_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    if account_id in SYNC_PROGRESS:
        return SYNC_PROGRESS[account_id]
    
    async with get_db() as db:
        async with db.execute("""
            SELECT id, sync_status, sync_progress_current, sync_progress_total, sync_message, last_synced_at
            FROM accounts WHERE id = ?
        """, (account_id,)) as cur:
            row = await cur.fetchone()
            if row:
                return {
                    "account_id": row["id"],
                    "status": row["sync_status"],
                    "current": row["sync_progress_current"],
                    "total": row["sync_progress_total"],
                    "message": row["sync_message"],
                    "last_synced_at": row["last_synced_at"]
                }
    return {"status": "idle", "current": 0, "total": 0, "message": ""}

@router.get("/stream/{account_id}")
async def stream_sync_progress(
    account_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    check_account_access(account_id, current_user)
    queue = get_or_create_sync_queue(account_id)

    async def event_generator():
        try:
            # Yield current state first if available
            if account_id in SYNC_PROGRESS:
                init_data = json.dumps(SYNC_PROGRESS[account_id])
                yield f"data: {init_data}\n\n"

            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=20.0)
                    yield f"data: {json.dumps(data)}\n\n"
                    if data.get("status") in ["completed", "error"]:
                        break
                except asyncio.TimeoutError:
                    # Send keep-alive comment
                    yield ": ping\n\n"
        finally:
            remove_sync_queue(account_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post("/stop/{account_id}")
async def stop_sync(
    account_id: str,
    current_user: Dict[str, Any] = Depends(require_permission("action:sync_trigger"))
):
    check_account_access(account_id, current_user)
    from app.services.gmail_sync import notify_progress
    if account_id in SYNC_PROGRESS:
        SYNC_PROGRESS.pop(account_id, None)

    async with get_db() as db:
        await db.execute("""
            UPDATE accounts
            SET sync_status = 'completed',
                sync_message = '已停止同步',
                sync_progress_current = 0,
                sync_progress_total = 0,
                total_synced = (SELECT COUNT(*) FROM emails WHERE account_id = accounts.id)
            WHERE id = ?
        """, (account_id,))
        await db.commit()

    await notify_progress(account_id, "completed", 0, 0, "已停止同步")
    return {"status": "success", "message": "已停止该账号的邮件同步"}

@router.post("/stop-all")
async def stop_sync_all(
    current_user: Dict[str, Any] = Depends(require_permission("action:sync_trigger"))
):
    from app.services.gmail_sync import notify_progress
    SYNC_PROGRESS.clear()
    async with get_db() as db:
        await db.execute("""
            UPDATE accounts
            SET sync_status = 'completed',
                sync_message = '已停止同步',
                sync_progress_current = 0,
                sync_progress_total = 0,
                total_synced = (SELECT COUNT(*) FROM emails WHERE account_id = accounts.id)
            WHERE sync_status = 'syncing'
        """)
        await db.commit()

        async with db.execute("SELECT id FROM accounts") as cur:
            rows = await cur.fetchall()
            for r in rows:
                await notify_progress(r["id"], "completed", 0, 0, "已停止同步")

    return {"status": "success", "message": "已停止全部同步任务"}

