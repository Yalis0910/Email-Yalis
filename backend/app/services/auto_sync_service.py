import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from app.database import get_db

logger = logging.getLogger("auto_sync")

class AutoSyncScheduler:
    _task: Optional[asyncio.Task] = None
    _running: bool = False
    _wake_event: asyncio.Event = asyncio.Event()
    _last_run: Optional[str] = None

    @classmethod
    async def get_settings(cls) -> Dict[str, Any]:
        async with get_db() as db:
            cur = await db.execute("SELECT key, value FROM system_settings WHERE key LIKE 'auto_sync_%'")
            rows = await cur.fetchall()
            settings = {r["key"]: r["value"] for r in rows}

        enabled = settings.get("auto_sync_enabled", "false").lower() in ("true", "1")
        try:
            interval = int(settings.get("auto_sync_interval_minutes", "30"))
        except ValueError:
            interval = 30

        last_run = settings.get("auto_sync_last_run", "") or cls._last_run

        return {
            "auto_sync_enabled": enabled,
            "auto_sync_interval_minutes": interval,
            "auto_sync_last_run": last_run,
            "is_running": cls._running
        }

    @classmethod
    async def update_settings(cls, enabled: bool, interval_minutes: int) -> Dict[str, Any]:
        interval_val = max(1, interval_minutes)
        enabled_str = "true" if enabled else "false"

        async with get_db() as db:
            await db.execute("""
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('auto_sync_enabled', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """, (enabled_str,))
            await db.execute("""
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('auto_sync_interval_minutes', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """, (str(interval_val),))
            await db.commit()

        # Wake up the scheduler loop immediately to apply new settings
        cls._wake_event.set()

        return await cls.get_settings()

    @classmethod
    def start(cls):
        if cls._task is None or cls._task.done():
            cls._running = True
            cls._task = asyncio.create_task(cls._scheduler_loop())
            logger.info("AutoSyncScheduler background worker started.")

    @classmethod
    def stop(cls):
        cls._running = False
        if cls._task and not cls._task.done():
            cls._task.cancel()
            cls._task = None
            logger.info("AutoSyncScheduler background worker stopped.")

    @classmethod
    async def run_incremental_sync_all(cls) -> Dict[str, Any]:
        """
        Quietly runs incremental synchronization on all accounts.
        """
        from app.services.gmail_sync import GmailSyncService, SYNC_PROGRESS
        from app.services.imap_sync import GenericImapService

        async with get_db() as db:
            cur = await db.execute("SELECT id, email, sync_status, refresh_token, account_type FROM accounts")
            rows = await cur.fetchall()

        if not rows:
            return {"status": "no_accounts", "synced": []}

        synced_accounts = []
        for row in rows:
            acc_id = row["id"]
            # Skip if actively syncing already
            if acc_id in SYNC_PROGRESS and SYNC_PROGRESS[acc_id].get("status") == "syncing":
                continue
            if row["sync_status"] == "syncing":
                continue

            has_refresh = bool(row["refresh_token"])
            try:
                if has_refresh:
                    # Gmail OAuth
                    await GmailSyncService.sync_account_emails(account_id=acc_id, full_sync=False)
                else:
                    # Generic IMAP
                    await GenericImapService.sync_imap_emails(account_id=acc_id, full_sync=False)
                synced_accounts.append(row["email"])
            except Exception as e:
                logger.error(f"AutoSync failed for account {row['email']}: {e}")

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cls._last_run = now_str

        async with get_db() as db:
            await db.execute("""
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('auto_sync_last_run', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """, (now_str,))
            await db.commit()

        return {
            "status": "completed",
            "synced_accounts": synced_accounts,
            "timestamp": now_str
        }

    @classmethod
    async def _scheduler_loop(cls):
        """
        Background loop: checks settings every 30 seconds, runs sync if elapsed >= interval.
        """
        # Brief initial warm-up delay before first check
        await asyncio.sleep(10)

        while cls._running:
            cls._wake_event.clear()
            try:
                settings = await cls.get_settings()
                if settings["auto_sync_enabled"]:
                    interval_min = settings["auto_sync_interval_minutes"]
                    last_run_str = settings["auto_sync_last_run"]
                    should_run = False

                    if not last_run_str:
                        should_run = True
                    else:
                        try:
                            last_run_dt = datetime.strptime(last_run_str, "%Y-%m-%d %H:%M:%S")
                            if datetime.now() - last_run_dt >= timedelta(minutes=interval_min):
                                should_run = True
                        except Exception:
                            should_run = True

                    if should_run:
                        logger.info(f"AutoSyncScheduler: Triggering scheduled incremental sync (interval: {interval_min}m)...")
                        await cls.run_incremental_sync_all()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"AutoSyncScheduler loop exception: {e}")

            # Wait for 30s or until wake_event is signaled (e.g., user updated settings)
            try:
                await asyncio.wait_for(cls._wake_event.wait(), timeout=30.0)
            except asyncio.TimeoutError:
                pass
            except asyncio.CancelledError:
                break
