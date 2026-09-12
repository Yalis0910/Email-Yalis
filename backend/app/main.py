from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import init_db
from app.routers import auth, sync, dashboard, assets, attachments, contacts, emails, ai, users

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize SQLite database schema and FTS5 triggers
    init_db()
    # Reset any dangling syncing status from unexpected shutdowns/crashes
    try:
        from app.database import get_db
        async with get_db() as db:
            await db.execute("""
                UPDATE accounts
                SET sync_status = 'completed',
                    sync_message = '同步完成',
                    sync_progress_current = 0,
                    sync_progress_total = 0,
                    total_synced = (SELECT COUNT(*) FROM emails WHERE account_id = accounts.id)
                WHERE sync_status = 'syncing'
            """)
            await db.commit()
    except Exception as e:
        print(f"[Email-Yalis] Startup reset dangling sync error: {e}")

    # Check if contacts need initialization (only if table is empty, run in background to avoid blocking server startup)
    try:
        import asyncio
        from app.database import get_db
        from app.services.stats_service import StatsService
        async with get_db() as db:
            async with db.execute("SELECT COUNT(*) FROM contacts") as cur:
                contact_count = (await cur.fetchone())[0]
        if contact_count == 0:
            print("[Email-Yalis] 联系人缓存为空，已在后台启动人脉图谱预热计算...")
            asyncio.create_task(StatsService.rebuild_contacts())
        else:
            print(f"[Email-Yalis] 联系人缓存已就绪 ({contact_count} 位联系人)")
    except Exception as e:
        print(f"[Email-Yalis] Check contacts error: {e}")

    # Start background auto-sync scheduler
    from app.services.auto_sync_service import AutoSyncScheduler
    AutoSyncScheduler.start()

    print("[Email-Yalis] 后端 API 服务初始化完成，已就绪接受连接。")
    yield
    # Shutdown
    AutoSyncScheduler.stop()

app = FastAPI(
    title="Email-Yalis API",
    description="Gmail 邮件资产可视化管理平台后端服务",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(users.router)
app.include_router(auth.router)
app.include_router(sync.router)
app.include_router(dashboard.router)
app.include_router(assets.router)
app.include_router(attachments.router)
app.include_router(contacts.router)
app.include_router(emails.router)
app.include_router(ai.router)

@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "Email-Yalis Mail Asset Engine",
        "version": "1.0.0"
    }
