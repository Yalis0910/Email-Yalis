from fastapi import APIRouter, HTTPException, Query, Body, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from app.database import get_db
from app.services.ai_service import AIService, PRESETS
from app.dependencies import get_current_user, require_permission, check_account_access, get_authorized_account_ids

router = APIRouter(prefix="/api/ai", tags=["AI"])

class AISettingsUpdate(BaseModel):
    ai_provider: Optional[str] = "deepseek"
    ai_base_url: Optional[str] = ""
    ai_api_key: Optional[str] = ""
    ai_model: Optional[str] = "deepseek-chat"
    ai_temperature: Optional[str] = "0.6"

class AIPlatformItem(BaseModel):
    id: Optional[str] = None
    name: str
    base_url: str
    api_key: Optional[str] = ""
    enabled_models: List[str] = []
    context_window: Optional[int] = 524288
    is_active: Optional[bool] = True

class AIPlatformsUpdateRequest(BaseModel):
    platforms: List[AIPlatformItem]
    default_model: Optional[str] = None
    default_platform_id: Optional[str] = None
    default_context_window: Optional[int] = 524288

class AIFetchModelsRequest(BaseModel):
    base_url: str
    api_key: Optional[str] = ""
    platform_id: Optional[str] = None

class AITestRequest(BaseModel):
    ai_base_url: str
    ai_api_key: Optional[str] = ""
    ai_model: str

class AIReplyRequest(BaseModel):
    tone: Optional[str] = "professional"
    user_notes: Optional[str] = ""
    model: Optional[str] = None

class AICopilotChatRequest(BaseModel):
    query: str
    history: Optional[List[Dict[str, str]]] = []
    account_id: Optional[str] = None
    conversation_id: Optional[str] = None
    contact_id: Optional[str] = None
    model: Optional[str] = None
    platform_id: Optional[str] = None
    thinking_level: Optional[str] = "off"

class AIConversationCreateRequest(BaseModel):
    title: Optional[str] = "新对话"
    contact_id: Optional[str] = None

class AIConversationUpdateRequest(BaseModel):
    title: str

class AIScanAssetsRequest(BaseModel):
    account_id: Optional[str] = None

@router.get("/settings")
async def get_ai_settings(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Returns AI configuration with masked API key and presets"""
    config = await AIService.get_config()
    raw_key = config.get("ai_api_key", "")
    masked_key = ""
    if raw_key:
        if len(raw_key) > 8:
            masked_key = f"{raw_key[:4]}****{raw_key[-4:]}"
        else:
            masked_key = "****"

    return {
        "settings": {
            "ai_provider": config.get("ai_provider", "deepseek"),
            "ai_base_url": config.get("ai_base_url", "https://api.deepseek.com/v1"),
            "ai_api_key_masked": masked_key,
            "has_api_key": bool(raw_key),
            "ai_model": config.get("ai_model", "deepseek-chat"),
            "ai_temperature": config.get("ai_temperature", "0.6")
        },
        "presets": PRESETS
    }

@router.post("/settings")
async def update_ai_settings(
    data: AISettingsUpdate,
    current_user: Dict[str, Any] = Depends(require_permission("action:ai_config"))
):
    """Updates AI configuration"""
    update_data = {}
    if data.ai_provider is not None:
        update_data["ai_provider"] = data.ai_provider
    if data.ai_base_url is not None:
        update_data["ai_base_url"] = data.ai_base_url
    # If client passed an actual key (not masked like ****), update it
    if data.ai_api_key is not None and not data.ai_api_key.startswith("****"):
        update_data["ai_api_key"] = data.ai_api_key
    if data.ai_model is not None:
        update_data["ai_model"] = data.ai_model
    if data.ai_temperature is not None:
        update_data["ai_temperature"] = data.ai_temperature

    saved = await AIService.save_config(update_data)
    return {"message": "AI 设置保存成功", "status": "ok"}

@router.post("/test")
async def test_ai_connection(
    data: ATestRequest if False else AITestRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Tests model connectivity with given or current credentials"""
    api_key = data.ai_api_key
    # If masked or empty, fall back to current saved key
    if not api_key or api_key.startswith("****"):
        current_config = await AIService.get_config()
        api_key = current_config.get("ai_api_key", "")

    res = await AIService.test_connection(
        base_url=data.ai_base_url,
        api_key=api_key,
        model=data.ai_model
    )
    return res

@router.get("/platforms")
async def get_ai_platforms(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Returns all configured AI platforms with masked API keys and default model"""
    cfg = await AIService.get_platforms_config()
    platforms = cfg.get("platforms", [])
    clean_platforms = []
    for p in platforms:
        raw_key = p.get("api_key", "")
        masked_key = ""
        if raw_key:
            if len(raw_key) > 8:
                masked_key = f"{raw_key[:4]}****{raw_key[-4:]}"
            else:
                masked_key = "****"
        clean_platforms.append({
            "id": p.get("id"),
            "name": p.get("name"),
            "base_url": p.get("base_url"),
            "api_key_masked": masked_key,
            "has_api_key": bool(raw_key),
            "enabled_models": p.get("enabled_models", []),
            "context_window": p.get("context_window", 524288),
            "is_active": p.get("is_active", True)
        })
    return {
        "platforms": clean_platforms,
        "default_model": cfg.get("default_model", ""),
        "default_platform_id": cfg.get("default_platform_id", ""),
        "default_context_window": cfg.get("default_context_window", 524288)
    }

@router.post("/platforms")
async def update_ai_platforms(
    data: AIPlatformsUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_permission("action:ai_config"))
):
    """Saves multi-platform AI configuration"""
    platforms_data = [p.dict() for p in data.platforms]
    saved = await AIService.save_platforms_config(
        platforms=platforms_data,
        default_model=data.default_model,
        default_platform_id=data.default_platform_id,
        default_context_window=data.default_context_window or 524288
    )
    return {"message": "AI 平台配置保存成功", "status": "ok", "config": saved}

@router.post("/platforms/fetch-models")
async def fetch_platform_models(
    data: AIFetchModelsRequest,
    current_user: Dict[str, Any] = Depends(require_permission("action:ai_config"))
):
    """Fetches model list from /models endpoint"""
    api_key = data.api_key
    base_url = data.base_url

    # If key is masked or empty and platform_id is passed, look up saved key
    if (not api_key or "****" in api_key) and data.platform_id:
        cfg = await AIService.get_platforms_config()
        for p in cfg.get("platforms", []):
            if p.get("id") == data.platform_id:
                api_key = p.get("api_key", "")
                if not base_url:
                    base_url = p.get("base_url", "")
                break

    if not base_url:
        raise HTTPException(status_code=400, detail="Base URL 不能为空")

    res = await AIService.fetch_platform_models(base_url=base_url, api_key=api_key or "")
    return res

@router.get("/models/enabled")
async def get_enabled_models():
    """Returns all active models grouped by platform for chat selector"""
    return await AIService.get_enabled_models()

async def verify_email_access(email_id: str, current_user: Dict[str, Any]) -> str:
    async with get_db() as db:
        async with db.execute("SELECT account_id FROM emails WHERE id = ?", (email_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="未找到该邮件")
            account_id = row["account_id"]
    check_account_access(account_id, current_user)
    return account_id

@router.get("/emails/{email_id}/insights")
async def get_email_insights(
    email_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Fetches cached summary & action items for an email"""
    await verify_email_access(email_id, current_user)
    insight = await AIService.get_email_insight(email_id)
    return {"has_insight": bool(insight), "insight": insight}

@router.post("/emails/{email_id}/summarize")
async def summarize_email_stream(
    email_id: str,
    force_refresh: bool = False,
    model: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Streams single email summary and action items via SSE"""
    await verify_email_access(email_id, current_user)
    generator = AIService.stream_email_summary(email_id, force_refresh=force_refresh, model=model)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post("/emails/{email_id}/reply")
async def generate_email_reply_stream(
    email_id: str,
    data: AIReplyRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Streams email reply draft via SSE"""
    await verify_email_access(email_id, current_user)
    generator = AIService.stream_email_reply(
        email_id=email_id,
        tone=data.tone or "professional",
        user_notes=data.user_notes or "",
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

@router.post("/copilot/chat")
async def copilot_chat_stream(
    data: AICopilotChatRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Streams Copilot multi-round chat with hybrid context retrieval and citations"""
    if not data.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    check_account_access(data.account_id, current_user)
    authorized = get_authorized_account_ids(current_user)

    generator = AIService.stream_copilot_chat(
        query=data.query,
        history=data.history or [],
        account_id=data.account_id,
        conversation_id=data.conversation_id,
        contact_id=data.contact_id,
        model=data.model,
        platform_id=data.platform_id,
        thinking_level=data.thinking_level or "off",
        user_id=current_user["id"],
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

@router.get("/conversations")
async def list_ai_conversations(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Returns list of AI conversation sessions for current user"""
    return await AIService.list_conversations(user_id=current_user["id"])

@router.post("/conversations")
async def create_ai_conversation(
    data: Optional[AIConversationCreateRequest] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Creates a new AI conversation session for current user"""
    title = (data.title if data and data.title else "新对话").strip() or "新对话"
    contact_id = data.contact_id if data else None
    return await AIService.create_conversation(title, user_id=current_user["id"], contact_id=contact_id)

@router.get("/conversations/{conversation_id}")
async def get_ai_conversation(
    conversation_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Gets details and messages of an AI conversation session"""
    conv = await AIService.get_conversation(conversation_id, user_id=current_user["id"])
    if not conv:
        raise HTTPException(status_code=404, detail="未找到该会话记录或无权访问")
    return conv

@router.put("/conversations/{conversation_id}")
async def update_ai_conversation(
    conversation_id: str,
    data: AIConversationUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Updates title of an AI conversation session"""
    ok = await AIService.update_conversation_title(conversation_id, data.title, user_id=current_user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="未找到该会话记录")
    return {"status": "ok"}

@router.delete("/conversations/{conversation_id}")
async def delete_ai_conversation(
    conversation_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Deletes an AI conversation session and its messages"""
    ok = await AIService.delete_conversation(conversation_id, user_id=current_user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="未找到该会话记录")
    return {"status": "ok", "message": "会话已删除"}

@router.post("/conversations/{conversation_id}/compress")
async def compress_ai_conversation(
    conversation_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Compresses earlier messages in an AI conversation into structured memory"""
    res = await AIService.compress_conversation(conversation_id, user_id=current_user["id"])
    return res

@router.get("/conversations/{conversation_id}/context-stats")
async def get_ai_conversation_context_stats(
    conversation_id: str,
    model: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Calculates context tokens breakdown for a conversation"""
    stats = await AIService.get_conversation_context_stats(conversation_id, model=model, user_id=current_user["id"])
    return stats

@router.post("/assets/scan")
async def scan_assets_with_ai(
    data: AIScanAssetsRequest,
    current_user: Dict[str, Any] = Depends(require_permission("action:system_ops"))
):
    """Triggers deep scan of unclassified emails to extract SaaS & subscriptions"""
    check_account_access(data.account_id, current_user)
    res = await AIService.scan_unclassified_assets(account_id=data.account_id)
    return res
