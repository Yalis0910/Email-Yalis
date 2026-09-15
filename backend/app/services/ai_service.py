import asyncio
import json
import time
import re
import httpx
from typing import Dict, Any, List, Optional, AsyncGenerator, Tuple
from app.database import get_db
from app.services.ai_retrieval import search_context_for_query
from app.services.ai_tools import COPILOT_TOOLS, execute_copilot_tool

DEFAULT_AI_SETTINGS = {
    "ai_provider": "deepseek",
    "ai_base_url": "https://api.deepseek.com/v1",
    "ai_api_key": "",
    "ai_model": "deepseek-chat",
    "ai_temperature": "0.6",
    "ai_context_window": "524288"
}

def estimate_tokens(text: str) -> int:
    """
    Estimates tokens for mixed Chinese and English text.
    Chinese: ~1 token per 1.2 characters.
    English / Symbols: ~1 token per 3.8 characters.
    """
    if not text:
        return 0
    cjk_count = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]', text))
    non_cjk_count = len(text) - cjk_count
    return max(1, int(cjk_count / 1.2 + non_cjk_count / 3.8))


PRESETS = {
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat"
    },
    "custom": {
        "name": "自定义 OpenAI 兼容接口",
        "base_url": "",
        "default_model": ""
    }
}

class AIService:
    @classmethod
    async def get_config(cls) -> Dict[str, str]:
        """Loads settings from SQLite system_settings table"""
        config = dict(DEFAULT_AI_SETTINGS)
        async with get_db() as db:
            cursor = await db.execute("SELECT key, value FROM system_settings WHERE key LIKE 'ai_%'")
            rows = await cursor.fetchall()
            for row in rows:
                config[row["key"]] = row["value"]
        return config

    @classmethod
    async def save_config(cls, settings: Dict[str, Any]) -> Dict[str, str]:
        """Saves settings to SQLite system_settings table"""
        allowed_keys = ["ai_provider", "ai_base_url", "ai_api_key", "ai_model", "ai_temperature"]
        async with get_db() as db:
            for k in allowed_keys:
                if k in settings:
                    v = str(settings[k]).strip()
                    await db.execute("""
                        INSERT INTO system_settings(key, value, updated_at)
                        VALUES(?, ?, datetime('now', 'localtime'))
                        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                    """, (k, v))
            await db.commit()
        return await cls.get_config()

    @classmethod
    async def get_platforms_config(cls) -> Dict[str, Any]:
        """
        Loads multi-platform configuration from SQLite system_settings.
        Automatically migrates legacy single-platform config if not present.
        """
        async with get_db() as db:
            cursor = await db.execute("SELECT key, value FROM system_settings WHERE key IN ('ai_platforms', 'ai_default_model', 'ai_default_platform_id', 'ai_default_context_window')")
            rows = await cursor.fetchall()
            settings_map = {row["key"]: row["value"] for row in rows}

        platforms_json = settings_map.get("ai_platforms")
        default_model = settings_map.get("ai_default_model")
        default_platform_id = settings_map.get("ai_default_platform_id")
        raw_ctx = settings_map.get("ai_default_context_window")
        default_context_window = int(raw_ctx) if raw_ctx and raw_ctx.isdigit() else 524288

        if platforms_json:
            try:
                platforms = json.loads(platforms_json)
                if isinstance(platforms, list):
                    for p in platforms:
                        if not p.get("context_window"):
                            p["context_window"] = default_context_window
                    return {
                        "platforms": platforms,
                        "default_model": default_model or (platforms[0]["enabled_models"][0] if platforms and platforms[0].get("enabled_models") else "deepseek-chat"),
                        "default_platform_id": default_platform_id or (platforms[0]["id"] if platforms else ""),
                        "default_context_window": default_context_window
                    }
            except Exception:
                pass

        # Legacy migration
        legacy_cfg = await cls.get_config()
        legacy_provider = legacy_cfg.get("ai_provider", "deepseek")
        legacy_base_url = legacy_cfg.get("ai_base_url") or "https://api.deepseek.com/v1"
        legacy_key = legacy_cfg.get("ai_api_key", "")
        legacy_model = legacy_cfg.get("ai_model") or "deepseek-chat"

        platform_id = "plt_default"
        platform_name = "DeepSeek" if legacy_provider == "deepseek" else "OpenAI 兼容接口"
        initial_platforms = [
            {
                "id": platform_id,
                "name": platform_name,
                "base_url": legacy_base_url,
                "api_key": legacy_key,
                "enabled_models": [legacy_model] if legacy_model else ["deepseek-chat"],
                "context_window": 524288,
                "is_active": True
            }
        ]
        default_model = legacy_model or "deepseek-chat"
        default_platform_id = platform_id

        # Persist migration
        async with get_db() as db:
            await db.execute("""
                INSERT INTO system_settings(key, value, updated_at)
                VALUES('ai_platforms', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """, (json.dumps(initial_platforms, ensure_ascii=False),))
            await db.execute("""
                INSERT INTO system_settings(key, value, updated_at)
                VALUES('ai_default_model', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """, (default_model,))
            await db.execute("""
                INSERT INTO system_settings(key, value, updated_at)
                VALUES('ai_default_platform_id', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """, (default_platform_id,))
            await db.execute("""
                INSERT INTO system_settings(key, value, updated_at)
                VALUES('ai_default_context_window', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """, (str(default_context_window),))
            await db.commit()

        return {
            "platforms": initial_platforms,
            "default_model": default_model,
            "default_platform_id": default_platform_id,
            "default_context_window": default_context_window
        }

    @classmethod
    async def save_platforms_config(
        cls, 
        platforms: List[Dict[str, Any]], 
        default_model: Optional[str] = None,
        default_platform_id: Optional[str] = None,
        default_context_window: Optional[int] = 524288
    ) -> Dict[str, Any]:
        """
        Saves platforms and preserves unmasked keys when client sends masked keys (****).
        """
        curr = await cls.get_platforms_config()
        old_platforms_map = {p["id"]: p for p in curr.get("platforms", [])}
        ctx_win = int(default_context_window or 524288)

        clean_platforms = []
        for p in platforms:
            p_id = p.get("id") or f"plt_{int(time.time()*1000)}"
            old_p = old_platforms_map.get(p_id, {})
            
            raw_key = (p.get("api_key") or "").strip()
            # If masked or empty and old key exists, retain old key
            if (not raw_key or "****" in raw_key) and old_p.get("api_key"):
                raw_key = old_p["api_key"]

            p_ctx = p.get("context_window")
            clean_platforms.append({
                "id": p_id,
                "name": (p.get("name") or "未命名平台").strip(),
                "base_url": (p.get("base_url") or "").strip(),
                "api_key": raw_key,
                "enabled_models": [str(m).strip() for m in p.get("enabled_models", []) if str(m).strip()],
                "context_window": int(p_ctx) if p_ctx else ctx_win,
                "is_active": p.get("is_active", True)
            })

        final_default_model = default_model
        final_default_platform_id = default_platform_id

        if not final_default_platform_id and clean_platforms:
            final_default_platform_id = clean_platforms[0]["id"]
        
        if not final_default_model and clean_platforms:
            for cp in clean_platforms:
                if cp["id"] == final_default_platform_id and cp.get("enabled_models"):
                    final_default_model = cp["enabled_models"][0]
                    break
            if not final_default_model and clean_platforms[0].get("enabled_models"):
                final_default_model = clean_platforms[0]["enabled_models"][0]

        async with get_db() as db:
            await db.execute("""
                INSERT INTO system_settings(key, value, updated_at)
                VALUES('ai_platforms', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """, (json.dumps(clean_platforms, ensure_ascii=False),))
            await db.execute("""
                INSERT INTO system_settings(key, value, updated_at)
                VALUES('ai_default_context_window', ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """, (str(ctx_win),))
            if final_default_model:
                await db.execute("""
                    INSERT INTO system_settings(key, value, updated_at)
                    VALUES('ai_default_model', ?, datetime('now', 'localtime'))
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                """, (final_default_model,))
            if final_default_platform_id:
                await db.execute("""
                    INSERT INTO system_settings(key, value, updated_at)
                    VALUES('ai_default_platform_id', ?, datetime('now', 'localtime'))
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                """, (final_default_platform_id,))

            # Sync legacy keys with default platform
            default_p = next((p for p in clean_platforms if p["id"] == final_default_platform_id), clean_platforms[0] if clean_platforms else None)
            if default_p:
                await db.execute("""
                    INSERT INTO system_settings(key, value, updated_at)
                    VALUES('ai_base_url', ?, datetime('now', 'localtime'))
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                """, (default_p.get("base_url", ""),))
                if default_p.get("api_key"):
                    await db.execute("""
                        INSERT INTO system_settings(key, value, updated_at)
                        VALUES('ai_api_key', ?, datetime('now', 'localtime'))
                        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                    """, (default_p.get("api_key", ""),))
                if final_default_model:
                    await db.execute("""
                        INSERT INTO system_settings(key, value, updated_at)
                        VALUES('ai_model', ?, datetime('now', 'localtime'))
                        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                    """, (final_default_model,))

            await db.commit()

        return await cls.get_platforms_config()

    @classmethod
    async def fetch_platform_models(cls, base_url: str, api_key: str) -> Dict[str, Any]:
        """Fetches available model list from OpenAI-compatible /models endpoint"""
        target_url = base_url.strip().rstrip("/")
        if target_url.endswith("/chat/completions"):
            target_url = target_url[:-len("/chat/completions")]
        
        candidates = []
        if target_url.endswith("/v1"):
            candidates.append(f"{target_url}/models")
            candidates.append(f"{target_url[:-3]}/models")
        else:
            candidates.append(f"{target_url}/v1/models")
            candidates.append(f"{target_url}/models")

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        last_err = None
        async with httpx.AsyncClient(timeout=15.0) as client:
            for url in candidates:
                try:
                    resp = await client.get(url, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        model_ids = []
                        if isinstance(data, dict) and "data" in data and isinstance(data["data"], list):
                            for item in data["data"]:
                                if isinstance(item, dict) and "id" in item:
                                    model_ids.append(str(item["id"]))
                                elif isinstance(item, str):
                                    model_ids.append(item)
                        elif isinstance(data, dict) and "models" in data and isinstance(data["models"], list):
                            for item in data["models"]:
                                if isinstance(item, dict):
                                    m_id = item.get("name") or item.get("model") or item.get("id")
                                    if m_id:
                                        model_ids.append(str(m_id))
                                elif isinstance(item, str):
                                    model_ids.append(item)
                        elif isinstance(data, list):
                            for item in data:
                                if isinstance(item, dict) and "id" in item:
                                    model_ids.append(str(item["id"]))
                                elif isinstance(item, str):
                                    model_ids.append(item)

                        unique_ids = list(dict.fromkeys(model_ids))
                        if unique_ids:
                            return {
                                "success": True,
                                "models": unique_ids,
                                "endpoint_used": url
                            }
                    else:
                        last_err = f"HTTP {resp.status_code}: {resp.text[:150]}"
                except Exception as e:
                    last_err = str(e)
                    continue

        return {
            "success": False,
            "error": f"获取模型列表失败: {last_err or '未找到可用的 /models 端点'}"
        }

    @classmethod
    async def get_enabled_models(cls) -> Dict[str, Any]:
        """
        Returns all enabled models grouped by platform, plus the default model.
        """
        cfg = await cls.get_platforms_config()
        platforms = cfg.get("platforms", [])
        default_model = cfg.get("default_model") or ""
        default_platform_id = cfg.get("default_platform_id") or ""

        groups = []
        for p in platforms:
            if not p.get("is_active", True):
                continue
            models = p.get("enabled_models", [])
            if models:
                groups.append({
                    "platform_id": p.get("id"),
                    "platform_name": p.get("name") or "默认平台",
                    "models": models,
                    "context_window": p.get("context_window") or cfg.get("default_context_window") or 524288,
                    "is_default_platform": p.get("id") == default_platform_id
                })

        all_models = []
        for g in groups:
            for m in g.get("models", []):
                if m not in all_models:
                    all_models.append(m)

        return {
            "groups": groups,
            "grouped": groups,
            "models": all_models,
            "default_model": default_model,
            "default_platform_id": default_platform_id,
            "default_context_window": cfg.get("default_context_window") or 524288
        }

    @classmethod
    async def get_model_context_limit(cls, model: Optional[str] = None, platform_id: Optional[str] = None) -> int:
        cfg = await cls.get_platforms_config()
        default_limit = cfg.get("default_context_window", 524288)
        platforms = cfg.get("platforms", [])
        if platform_id:
            for p in platforms:
                if p.get("id") == platform_id:
                    return int(p.get("context_window") or default_limit)
        if model:
            for p in platforms:
                if model in p.get("enabled_models", []):
                    return int(p.get("context_window") or default_limit)
        if platforms:
            return int(platforms[0].get("context_window") or default_limit)
        return default_limit

    @classmethod
    async def resolve_model_and_credentials(
        cls, 
        model: Optional[str] = None, 
        platform_id: Optional[str] = None
    ) -> Tuple[str, str, str]:
        """
        Resolves (base_url, api_key, model_name) for any AI invocation.
        """
        platforms_cfg = await cls.get_platforms_config()
        platforms = platforms_cfg.get("platforms", [])
        default_model = platforms_cfg.get("default_model") or "deepseek-chat"
        default_platform_id = platforms_cfg.get("default_platform_id")

        matched_platform = None
        target_model = model

        # 1. If platform_id is explicitly specified
        if platform_id:
            for p in platforms:
                if p.get("id") == platform_id:
                    matched_platform = p
                    break

        # 2. If model is given, search platforms that have this model enabled
        if not matched_platform and target_model:
            for p in platforms:
                if target_model in p.get("enabled_models", []):
                    matched_platform = p
                    break

        # 3. Use default platform or first platform
        if not matched_platform:
            for p in platforms:
                if p.get("id") == default_platform_id and p.get("is_active", True):
                    matched_platform = p
                    break
            if not matched_platform and platforms:
                matched_platform = platforms[0]

        # 4. Determine final model
        if not target_model:
            if matched_platform and matched_platform.get("enabled_models"):
                if default_model in matched_platform.get("enabled_models", []):
                    target_model = default_model
                else:
                    target_model = matched_platform["enabled_models"][0]
            else:
                target_model = default_model

        if matched_platform:
            base_url = matched_platform.get("base_url", "").strip()
            api_key = matched_platform.get("api_key", "").strip()
            return base_url, api_key, target_model or "deepseek-chat"

        # Fallback
        config = await cls.get_config()
        return (
            config.get("ai_base_url", "https://api.deepseek.com/v1"),
            config.get("ai_api_key", ""),
            target_model or config.get("ai_model", "deepseek-chat")
        )

    @classmethod
    async def test_connection(cls, base_url: str, api_key: str, model: str) -> Dict[str, Any]:
        """Tests connectivity to LLM endpoint"""
        target_url = base_url.rstrip("/")
        if not target_url.endswith("/chat/completions"):
            if target_url.endswith("/v1"):
                target_url = f"{target_url}/chat/completions"
            else:
                target_url = f"{target_url}/chat/completions"

        headers = {
            "Content-Type": "application/json"
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload = {
            "model": model or "deepseek-chat",
            "messages": [
                {"role": "user", "content": "Hi"}
            ],
            "max_tokens": 10,
            "temperature": 0.1
        }

        start_time = time.time()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(target_url, headers=headers, json=payload)
                latency_ms = int((time.time() - start_time) * 1000)
                if resp.status_code == 200:
                    data = resp.json()
                    reply = ""
                    if "choices" in data and len(data["choices"]) > 0:
                        reply = data["choices"][0]["message"].get("content", "")
                    return {
                        "success": True,
                        "latency_ms": latency_ms,
                        "reply": reply or "连接成功",
                        "model": model
                    }
                else:
                    err_detail = ""
                    try:
                        err_json = resp.json()
                        if isinstance(err_json, dict):
                            if "error" in err_json:
                                if isinstance(err_json["error"], dict):
                                    err_detail = err_json["error"].get("message") or str(err_json["error"])
                                else:
                                    err_detail = str(err_json["error"])
                            elif "message" in err_json:
                                err_detail = str(err_json["message"])
                    except Exception:
                        pass
                    if not err_detail:
                        err_detail = resp.text[:200]
                    return {
                        "success": False,
                        "latency_ms": latency_ms,
                        "error": f"服务商返回错误 (HTTP {resp.status_code}): {err_detail}"
                    }
        except httpx.ConnectError:
            return {"success": False, "error": f"无法连接到服务地址: {target_url}，请检查网络或服务是否已启动"}
        except httpx.TimeoutException:
            return {"success": False, "error": "连接超时（超过 10 秒），请检查网络或代理设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    @classmethod
    async def _stream_llm(
        cls, 
        messages: List[Dict[str, str]], 
        temperature: float = 0.6,
        max_tokens: int = 2000,
        model: Optional[str] = None,
        platform_id: Optional[str] = None,
        thinking_level: Optional[str] = "off"
    ) -> AsyncGenerator[str, None]:
        """Internal generator connecting to OpenAI-compatible streaming API with dual-channel thinking parser"""
        base_url, api_key, resolved_model = await cls.resolve_model_and_credentials(model=model, platform_id=platform_id)
        config = await cls.get_config()

        is_local = "localhost" in base_url or "127.0.0.1" in base_url
        if not api_key and not is_local:
            err_msg = "请先在「系统设置」中配置大模型 API Key（支持 DeepSeek、OpenAI、SiliconFlow 或 本地 Ollama）"
            yield f"data: {json.dumps({'type': 'error', 'error': err_msg}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        target_url = base_url.rstrip("/")
        if not target_url.endswith("/chat/completions"):
            target_url = f"{target_url}/chat/completions"

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        model_lower = (resolved_model or "").lower()
        payload = {
            "model": resolved_model,
            "messages": messages,
            "stream": True,
            "temperature": float(config.get("ai_temperature", temperature)),
            "max_tokens": max_tokens
        }

        # Adapt thinking / reasoning parameters based on model type and thinking_level
        if thinking_level and thinking_level in ["low", "medium", "high", "max"]:
            eff = "high" if thinking_level == "max" else thinking_level
            if "o1" in model_lower or "o3" in model_lower:
                payload["reasoning_effort"] = eff
                # OpenAI o1/o3 uses max_completion_tokens
                payload["max_completion_tokens"] = payload.pop("max_tokens", max_tokens)
                payload.pop("temperature", None)
            elif "claude-3-7" in model_lower:
                budget = 1024 if thinking_level == "low" else (4096 if thinking_level == "medium" else (32768 if thinking_level == "max" else 16384))
                payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
                payload["max_tokens"] = max(payload.get("max_tokens", 2000), budget + 1000)
            else:
                # Standard OpenAI/Gemini/DeepSeek/Qwen reasoning parameter
                payload["reasoning_effort"] = eff
                if thinking_level == "max":
                    payload["max_tokens"] = max(payload.get("max_tokens", 2000), 4096)

        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                async with client.stream("POST", target_url, headers=headers, json=payload) as response:
                    if response.status_code != 200:
                        err_body = await response.aread()
                        err_text = err_body.decode("utf-8", errors="ignore")[:300]
                        yield f"data: {json.dumps({'type': 'error', 'error': f'模型服务返回错误 HTTP {response.status_code}: {err_text}'}, ensure_ascii=False)}\n\n"
                        yield "data: [DONE]\n\n"
                        return

                    in_think_tag = False
                    in_tool_call_tag = False
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line or not line.startswith("data:"):
                            continue
                        data_content = line[5:].strip()
                        if data_content == "[DONE]":
                            yield "data: [DONE]\n\n"
                            break
                        try:
                            chunk = json.loads(data_content)
                            choice = chunk.get("choices", [{}])[0]
                            delta = choice.get("delta", {})

                            # Channel 1: delta.reasoning_content (DeepSeek-R1, SiliconFlow, Gemini/OpenAI proxies)
                            reasoning_piece = (
                                delta.get("reasoning_content") 
                                or delta.get("reasoning") 
                                or delta.get("thought") 
                                or delta.get("thought_content") 
                                or ""
                            )
                            if reasoning_piece:
                                yield f"data: {json.dumps({'type': 'thinking', 'delta': reasoning_piece}, ensure_ascii=False)}\n\n"

                            # Channel 2: delta.content (may contain <think>...</think> or raw <tool_call>...</tool_call>)
                            content_piece = delta.get("content", "")
                            if content_piece:
                                # Suppress/filter out any raw <tool_call> XML emitted by model during synthesis
                                if "<tool_call" in content_piece:
                                    in_tool_call_tag = True
                                    tc_parts = content_piece.split("<tool_call", 1)
                                    if tc_parts[0]:
                                        yield f"data: {json.dumps({'type': 'chunk', 'delta': tc_parts[0]}, ensure_ascii=False)}\n\n"
                                    content_piece = tc_parts[1]

                                if in_tool_call_tag:
                                    if "</tool_call>" in content_piece:
                                        in_tool_call_tag = False
                                        tc_parts = content_piece.split("</tool_call>", 1)
                                        if len(tc_parts) > 1 and tc_parts[1]:
                                            content_piece = tc_parts[1]
                                        else:
                                            continue
                                    else:
                                        continue

                                if "<think>" in content_piece or "<thought>" in content_piece:
                                    in_think_tag = True
                                    tag = "<think>" if "<think>" in content_piece else "<thought>"
                                    parts = content_piece.split(tag, 1)
                                    if parts[0]:
                                        yield f"data: {json.dumps({'type': 'chunk', 'delta': parts[0]}, ensure_ascii=False)}\n\n"
                                    content_piece = parts[1]

                                if in_think_tag:
                                    closing_tag = "</think>" if "</think>" in content_piece else ("</thought>" if "</thought>" in content_piece else None)
                                    if closing_tag:
                                        in_think_tag = False
                                        think_parts = content_piece.split(closing_tag, 1)
                                        if think_parts[0]:
                                            yield f"data: {json.dumps({'type': 'thinking', 'delta': think_parts[0]}, ensure_ascii=False)}\n\n"
                                        if len(think_parts) > 1 and think_parts[1]:
                                            yield f"data: {json.dumps({'type': 'chunk', 'delta': think_parts[1]}, ensure_ascii=False)}\n\n"
                                    else:
                                        yield f"data: {json.dumps({'type': 'thinking', 'delta': content_piece}, ensure_ascii=False)}\n\n"
                                else:
                                    yield f"data: {json.dumps({'type': 'chunk', 'delta': content_piece}, ensure_ascii=False)}\n\n"
                        except Exception:
                            continue
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': f'连接大模型失败: {str(e)}'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    @classmethod
    async def get_email_insight(cls, email_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves cached insight from SQLite"""
        async with get_db() as db:
            cursor = await db.execute("""
                SELECT email_id, summary, action_items, key_entities, reply_draft, model_name, created_at, updated_at
                FROM email_ai_insights WHERE email_id = ?
            """, (email_id,))
            row = await cursor.fetchone()
            if row:
                return {
                    "email_id": row["email_id"],
                    "summary": row["summary"],
                    "action_items": json.loads(row["action_items"]) if row["action_items"] else [],
                    "key_entities": json.loads(row["key_entities"]) if row["key_entities"] else {},
                    "reply_draft": row["reply_draft"] or "",
                    "model_name": row["model_name"] or "",
                    "created_at": row["created_at"]
                }
        return None

    @classmethod
    async def stream_email_summary(cls, email_id: str, force_refresh: bool = False, model: Optional[str] = None) -> AsyncGenerator[str, None]:
        """
        Generates markdown summary and action items for single email.
        Saves result to email_ai_insights upon completion.
        """
        async with get_db() as db:
            cursor = await db.execute("""
                SELECT id, account_id, subject, from_name, from_email, to_emails, date_str, snippet, body_text
                FROM emails WHERE id = ?
            """, (email_id,))
            email = await cursor.fetchone()

        if not email:
            yield f"data: {json.dumps({'type': 'error', 'error': '未找到对应邮件'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Check existing insight cache
        if not force_refresh:
            cached = await cls.get_email_insight(email_id)
            if cached and cached.get("summary"):
                # Emit cached immediately
                yield f"data: {json.dumps({'type': 'cached', 'summary': cached['summary'], 'action_items': cached['action_items']}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

        # Clean body text
        body = (email["body_text"] or email["snippet"] or "").strip()
        if len(body) > 4000:
            body = body[:4000] + "\n...(正文过长已截断)..."

        prompt = f"""你是一个高效的个人邮件与资产智能助手。请针对以下邮件内容进行深度提炼，输出清晰、结构化的 Markdown 内容：

【邮件信息】
发件人: {email['from_name'] or '未知'} <{email['from_email']}>
主题: {email['subject'] or '(无主题)'}
日期: {email['date_str']}
正文内容:
{body}

【请按以下规范格式输出，务必严谨、直接，不要寒暄客套】：
### 📌 核心速读
- (用 2~3 个精炼要点总结此邮件的核心事件、目的或结论)

### 📋 待办与行动项
- [ ] (列出收件人需要跟进的事项、确认点或待办，若无需要跟进的事项请写“- 暂无需后续行动”)

### 💡 关键信息提取
- **涉及金额/资费**：(提取涉及的金额、货币，无则写“无”)
- **关键时间节点**：(会议/截止时间/续费日，无则写“无”)
- **重要链接/凭据**：(发票单号/工单号/验证码等，无则写“无”)
"""

        messages = [
            {"role": "system", "content": "你是由 Email-Yalis 驱动的邮件智能效率助手。"},
            {"role": "user", "content": prompt}
        ]

        full_output = []
        async for sse_chunk in cls._stream_llm(messages, temperature=0.3, max_tokens=1200, model=model):
            yield sse_chunk
            if "data: " in sse_chunk and "[DONE]" not in sse_chunk:
                try:
                    payload = json.loads(sse_chunk.replace("data: ", "").strip())
                    if payload.get("type") == "chunk":
                        full_output.append(payload.get("delta", ""))
                except Exception:
                    pass

        # Persist summary to SQLite upon full stream finish
        accumulated_summary = "".join(full_output).strip()
        if accumulated_summary:
            base_url, api_key, model_name = await cls.resolve_model_and_credentials(model=model)

            # Heuristic action items extraction
            action_items = []
            for line in accumulated_summary.split("\n"):
                clean = line.strip()
                if clean.startswith("- [ ]") or clean.startswith("* [ ]"):
                    item_text = clean[5:].strip()
                    if item_text and "暂无需后续行动" not in item_text:
                        action_items.append({"title": item_text, "done": False})

            async with get_db() as db:
                await db.execute("""
                    INSERT INTO email_ai_insights (email_id, account_id, summary, action_items, model_name, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
                    ON CONFLICT(email_id) DO UPDATE SET
                        summary = excluded.summary,
                        action_items = excluded.action_items,
                        model_name = excluded.model_name,
                        updated_at = excluded.updated_at
                """, (email_id, email["account_id"], accumulated_summary, json.dumps(action_items, ensure_ascii=False), model_name))
                await db.commit()

    @classmethod
    async def stream_email_reply(
        cls, 
        email_id: str, 
        tone: str = "professional", 
        user_notes: str = "",
        model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        Drafts reply to an email based on tone and optional user directions.
        """
        async with get_db() as db:
            cursor = await db.execute("""
                SELECT id, account_id, subject, from_name, from_email, date_str, snippet, body_text
                FROM emails WHERE id = ?
            """, (email_id,))
            email = await cursor.fetchone()

        if not email:
            yield f"data: {json.dumps({'type': 'error', 'error': '未找到对应邮件'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        tone_instructions = {
            "professional": "专业得体、商务礼貌、条理严谨清晰",
            "friendly": "热情真诚、轻松友善、有亲和力",
            "concise": "极简干练、直奔主题、言简意赅，控制在 3 句话以内",
            "decline": "委婉谢绝、真诚表达感谢但礼貌拒绝该提议或合作",
            "clarify": "严谨追问、针对关键细节礼貌请求对方进一步确认或提供材料"
        }.get(tone, "专业得体、商务礼貌")

        # Look up contact profile and tier
        contact_tier_info = ""
        contact_email_addr = (email["from_email"] or "").strip().lower()
        matched_playbooks = []
        async with get_db() as db:
            if contact_email_addr:
                c_cur = await db.execute("SELECT name, tier, deal_stage, estimated_value FROM contacts WHERE lower(email) = ? LIMIT 1", (contact_email_addr,))
                c_row = await c_cur.fetchone()
                if c_row:
                    tier_str = c_row["tier"] or "普通"
                    stage_str = c_row["deal_stage"] or "沟通中"
                    contact_tier_info = f"- 目标客户画像: 【{tier_str} 级客户】| 当前商机阶段: 【{stage_str}】"

            # Match sales playbooks against email body & subject
            search_text = (f"{email['subject'] or ''} {body}").lower()
            pb_cur = await db.execute("SELECT title, scenario_type, trigger_pattern, response_strategy, reply_template FROM sales_playbook")
            all_pbs = await pb_cur.fetchall()
            for pb in all_pbs:
                patterns = [p.strip().lower() for p in (pb["trigger_pattern"] or "").split(",") if p.strip()]
                if any(p in search_text for p in patterns):
                    matched_playbooks.append(pb)
                    if len(matched_playbooks) >= 2:
                        break

        playbook_instruction = ""
        if matched_playbooks:
            pb_snippets = []
            for p in matched_playbooks:
                pb_snippets.append(f"• 【{p['title']}】\n  应对策略要点: {p['response_strategy']}\n  话术参考范式: {p['reply_template'][:300]}...")
            playbook_instruction = f"\n【销售对策库推荐应对策略（针对信中客户异议或关切点）】：\n" + "\n\n".join(pb_snippets) + "\n"

        prompt = f"""请针对以下来信，起草一封得体的高质量回复邮件。

【来信上下文】
发件人: {email['from_name'] or '对方'} <{email['from_email']}>
来信主题: {email['subject']}
来信日期: {email['date_str']}
{contact_tier_info}
来信内容:
{body}
{playbook_instruction}
【回复要求】
1. 回复语气风格：{tone_instructions}。
2. 用户的特殊指示与意图：{user_notes if user_notes.strip() else '根据来信内容做出最恰当的常规回复'}。
3. 战术运用：如检测到客户提出了价格/交期/付款方式等疑虑，请严格采纳上述对策库中的专业应对策略进行解答或化解。
4. 格式规范：包含称谓、正文、祝颂语及署名占位符，排版清晰美观。直接输出回复草稿全文，不要前缀额外说明。
"""

        messages = [
            {"role": "system", "content": "你是一位优秀的商务外贸与大客户关系邮件写作专家，擅长高效推进商机与化解客户疑虑。"},
            {"role": "user", "content": prompt}
        ]

        async for chunk in cls._stream_llm(messages, temperature=0.7, max_tokens=1000, model=model):
            yield chunk

    @classmethod
    async def list_conversations(cls, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        async with get_db() as db:
            # Clean up ghost/empty conversations that have 0 messages
            await db.execute("""
                DELETE FROM ai_conversations
                WHERE id NOT IN (SELECT DISTINCT conversation_id FROM ai_messages)
            """)
            await db.commit()

            cond = "WHERE c.user_id = ?" if user_id else ""
            params = (user_id,) if user_id else ()
            cursor = await db.execute(f"""
                SELECT c.id, c.title, c.user_id, c.contact_id, c.context_summary, c.compressed_at, c.created_at, c.updated_at, 
                       COUNT(m.id) as message_count,
                       ct.name as contact_name, ct.email as contact_email,
                       ct.inbound_count, ct.outbound_count
                FROM ai_conversations c
                JOIN ai_messages m ON c.id = m.conversation_id
                LEFT JOIN contacts ct ON c.contact_id = ct.id
                {cond}
                GROUP BY c.id
                HAVING COUNT(m.id) > 0
                ORDER BY c.updated_at DESC
            """, params)
            rows = await cursor.fetchall()
            return [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "contact_id": r["contact_id"],
                    "contact_name": r["contact_name"],
                    "contact_email": r["contact_email"],
                    "context_summary": r["context_summary"] or "",
                    "compressed_at": r["compressed_at"] or None,
                    "is_compressed": bool(r["context_summary"]),
                    "contact_exchanges": ((r["inbound_count"] or 0) + (r["outbound_count"] or 0)) if r["contact_id"] else 0,
                    "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                    "message_count": r["message_count"]
                }
                for r in rows
            ]

    @classmethod
    async def create_conversation(cls, title: str = "新对话", user_id: str = "admin", contact_id: Optional[str] = None) -> Dict[str, Any]:
        import uuid
        conv_id = f"conv_{uuid.uuid4().hex[:12]}"
        async with get_db() as db:
            await db.execute("""
                INSERT INTO ai_conversations (id, title, user_id, contact_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
            """, (conv_id, title, user_id, contact_id))
            await db.commit()

            contact_info = None
            if contact_id:
                ct_cur = await db.execute("SELECT id, name, email, inbound_count, outbound_count FROM contacts WHERE id = ?", (contact_id,))
                ct_row = await ct_cur.fetchone()
                if ct_row:
                    contact_info = {
                        "id": ct_row["id"],
                        "name": ct_row["name"],
                        "email": ct_row["email"],
                        "contact_exchanges": (ct_row["inbound_count"] or 0) + (ct_row["outbound_count"] or 0)
                    }

        return {
            "id": conv_id,
            "title": title,
            "contact_id": contact_id,
            "contact_name": contact_info["name"] if contact_info else None,
            "contact_email": contact_info["email"] if contact_info else None,
            "contact_exchanges": contact_info["contact_exchanges"] if contact_info else 0,
            "context_summary": "",
            "compressed_at": None,
            "is_compressed": False,
            "message_count": 0
        }

    @classmethod
    async def get_conversation(cls, conversation_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        async with get_db() as db:
            cond = "WHERE c.id = ? AND c.user_id = ?" if user_id else "WHERE c.id = ?"
            params = (conversation_id, user_id) if user_id else (conversation_id,)
            c_cursor = await db.execute(f"""
                SELECT c.id, c.title, c.user_id, c.contact_id, c.context_summary, c.compressed_at, c.created_at, c.updated_at,
                       ct.name as contact_name, ct.email as contact_email,
                       ct.inbound_count, ct.outbound_count
                FROM ai_conversations c
                LEFT JOIN contacts ct ON c.contact_id = ct.id
                {cond}
            """, params)
            conv = await c_cursor.fetchone()
            if not conv:
                return None
            m_cursor = await db.execute("""
                SELECT id, role, content, thinking_content, thinking_duration, references_json, created_at
                FROM ai_messages
                WHERE conversation_id = ?
                ORDER BY created_at ASC
            """, (conversation_id,))
            messages = await m_cursor.fetchall()
            return {
                "id": conv["id"],
                "title": conv["title"],
                "contact_id": conv["contact_id"],
                "contact_name": conv["contact_name"],
                "contact_email": conv["contact_email"],
                "context_summary": conv["context_summary"] or "",
                "compressed_at": conv["compressed_at"] or None,
                "is_compressed": bool(conv["context_summary"]),
                "contact_exchanges": ((conv["inbound_count"] or 0) + (conv["outbound_count"] or 0)) if conv["contact_id"] else 0,
                "created_at": conv["created_at"],
                "updated_at": conv["updated_at"],
                "messages": [
                    {
                        "id": m["id"],
                        "role": m["role"],
                        "content": m["content"],
                        "thinking_content": m["thinking_content"] or "",
                        "thinking_duration": m["thinking_duration"] or 0,
                        "references": json.loads(m["references_json"]) if m["references_json"] else [],
                        "created_at": m["created_at"]
                    }
                    for m in messages
                ]
            }

    @classmethod
    async def update_conversation_title(cls, conversation_id: str, title: str, user_id: Optional[str] = None) -> bool:
        async with get_db() as db:
            cond = "WHERE id = ? AND user_id = ?" if user_id else "WHERE id = ?"
            params = (title, conversation_id, user_id) if user_id else (title, conversation_id)
            await db.execute(f"UPDATE ai_conversations SET title = ?, updated_at = datetime('now', 'localtime') {cond}", params)
            await db.commit()
        return True

    @classmethod
    async def delete_conversation(cls, conversation_id: str, user_id: Optional[str] = None) -> bool:
        async with get_db() as db:
            if user_id:
                c_cur = await db.execute("SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?", (conversation_id, user_id))
                if not await c_cur.fetchone():
                    return False
            await db.execute("DELETE FROM ai_messages WHERE conversation_id = ?", (conversation_id,))
            await db.execute("DELETE FROM ai_conversations WHERE id = ?", (conversation_id,))
            await db.commit()
        return True

    @classmethod
    async def get_conversation_context_stats(
        cls, 
        conversation_id: Optional[str] = None, 
        model: Optional[str] = None, 
        platform_id: Optional[str] = None, 
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Calculates detailed token breakdown for a conversation:
        - system_tokens: system prompt + contact context
        - tools_tokens: COPILOT_TOOLS schema
        - messages_tokens: dialogue history messages
        - summary_tokens: compressed context summary
        - total_tokens: sum
        - limit_tokens: context window limit (default 524288)
        - percent: total / limit
        """
        limit_tokens = await cls.get_model_context_limit(model=model, platform_id=platform_id)
        
        # Tools schema tokens
        tools_json = json.dumps(COPILOT_TOOLS, ensure_ascii=False)
        tools_tokens = estimate_tokens(tools_json)

        # Base system prompt
        base_system_prompt = """你是由 Email-Yalis 驱动的专业邮件与人脉数字资产分析专家。
你具备调用本地工具直接查询 SQLite 数据库与外部检索的能力，拥有以下只读查询与检索工具：
- search_emails
- inspect_attachment
- get_contact_info
- query_subscriptions
- query_digital_assets
- search_web
"""
        system_tokens = estimate_tokens(base_system_prompt) + 150

        summary_tokens = 0
        messages_tokens = 0
        context_summary = ""
        compressed_at = None
        is_compressed = False

        if conversation_id:
            conv = await cls.get_conversation(conversation_id, user_id=user_id)
            if conv:
                context_summary = conv.get("context_summary") or ""
                compressed_at = conv.get("compressed_at")
                is_compressed = bool(context_summary)

                if conv.get("contact_id"):
                    system_tokens += 1200  # contact background & timeline estimate

                if context_summary:
                    summary_tokens = estimate_tokens(context_summary)

                for m in conv.get("messages", []):
                    c = m.get("content") or ""
                    tc = m.get("thinking_content") or ""
                    messages_tokens += estimate_tokens(c) + 4
                    if tc:
                        messages_tokens += int(estimate_tokens(tc) * 0.2)

        total_tokens = system_tokens + tools_tokens + messages_tokens + summary_tokens
        percent = round((total_tokens / limit_tokens) * 100, 1) if limit_tokens > 0 else 0.0

        return {
            "system_tokens": system_tokens,
            "tools_tokens": tools_tokens,
            "messages_tokens": messages_tokens,
            "summary_tokens": summary_tokens,
            "total_tokens": total_tokens,
            "limit_tokens": limit_tokens,
            "percent": min(100.0, percent),
            "is_compressed": is_compressed,
            "compressed_at": compressed_at,
            "context_summary": context_summary
        }

    @classmethod
    async def compress_conversation(cls, conversation_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Compresses earlier conversation messages into a concise structured memory summary.
        Keeps original messages in database for history view, updates conversation context_summary.
        """
        conv = await cls.get_conversation(conversation_id, user_id=user_id)
        if not conv:
            return {"success": False, "error": "未找到指定会话"}

        messages = conv.get("messages", [])
        if len(messages) < 3:
            stats = await cls.get_conversation_context_stats(conversation_id, user_id=user_id)
            return {
                "success": False, 
                "error": "当前对话轮次较少（少于 3 条），暂无需压缩", 
                "stats": stats
            }

        preserve_count = 2 if len(messages) <= 6 else 4
        to_compress = messages[:-preserve_count]

        existing_summary = conv.get("context_summary") or ""

        dialogue_lines = []
        if existing_summary:
            dialogue_lines.append(f"【前期已有背景记忆】：\n{existing_summary}\n")

        for m in to_compress:
            r_label = "用户" if m["role"] == "user" else "AI助手"
            c_text = (m.get("content") or "").strip()
            if c_text:
                dialogue_lines.append(f"{r_label}: {c_text}")

        dialogue_text = "\n\n".join(dialogue_lines)

        compress_prompt = f"""你是一名专业的长对话上下文提炼专家。请将以下用户与 AI 的历史对话多轮记录进行高度精炼的结构化记忆摘要。

【提炼准则】：
1. 提炼核心讨论主题、达成的共识与最终结论；
2. 精确保留关键实体与事实（包括发件人、收件人邮箱、讨论的具体邮件主题与日期、涉及的数字资产/SaaS名称、具体金额等）；
3. 保留尚未完成的待办事项、后续行动计划与用户的个性化指令/偏好；
4. 语言极致精炼，去除寒暄客套与冗长铺垫；
5. 输出以「【前文对话核心记忆摘要】」为首行标题，使用清晰的 Markdown 要点排版。

【待提炼的历史对话内容】：
{dialogue_text}
"""

        base_url, api_key, model_name = await cls.resolve_model_and_credentials()
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        target_url = base_url.rstrip("/")
        if not target_url.endswith("/chat/completions"):
            target_url = f"{target_url}/chat/completions"

        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": "你是一个严谨高效的对话上下文压缩与记忆提取助手。"},
                {"role": "user", "content": compress_prompt}
            ],
            "temperature": 0.3,
            "max_tokens": 1500
        }

        summary_text = ""
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(target_url, headers=headers, json=payload)
                if resp.status_code == 200:
                    resp_json = resp.json()
                    summary_text = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                if not summary_text:
                    summary_text = "【前文对话核心记忆摘要】\n已提炼早期多轮对话要点与事实。"
        except Exception:
            summary_text = "【前文对话核心记忆摘要】\n前期围绕相关邮件资产与联系人展开了研讨，已归档早期多轮对话。"

        async with get_db() as db:
            await db.execute("""
                UPDATE ai_conversations 
                SET context_summary = ?, compressed_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
                WHERE id = ?
            """, (summary_text, conversation_id))
            await db.commit()

        stats = await cls.get_conversation_context_stats(conversation_id, user_id=user_id)
        return {
            "success": True,
            "conversation_id": conversation_id,
            "summary": summary_text,
            "compressed_message_count": len(to_compress),
            "stats": stats
        }

    @classmethod
    async def stream_copilot_chat(
        cls, 
        query: str, 
        history: List[Dict[str, str]], 
        account_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
        contact_id: Optional[str] = None,
        model: Optional[str] = None,
        platform_id: Optional[str] = None,
        thinking_level: Optional[str] = "off",
        user_id: Optional[str] = "admin",
        allowed_account_ids: Optional[List[str]] = None
    ) -> AsyncGenerator[str, None]:
        """
        Global Copilot chat: performs hybrid retrieval, persists messages, returns citations, streams LLM synthesis with thinking support.
        Supports dedicated contact-bound conversations with deep contextual background injection.
        """
        import uuid
        active_conv_id = conversation_id
        effective_contact_id = contact_id
        contact_context_prompt = ""
        contact_initial_refs = []

        async with get_db() as db:
            if not active_conv_id:
                active_conv_id = f"conv_{uuid.uuid4().hex[:12]}"
                if effective_contact_id:
                    ct_c = await db.execute("SELECT name, email FROM contacts WHERE id = ?", (effective_contact_id,))
                    ct_r = await ct_c.fetchone()
                    target_name = (ct_r["name"] or ct_r["email"].split("@")[0]) if ct_r else "联系人"
                    title = f"👤 往来研讨：{target_name}"
                else:
                    title = query[:24].strip() or "新对话"
                await db.execute("""
                    INSERT INTO ai_conversations (id, title, user_id, contact_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
                """, (active_conv_id, title, user_id or "admin", effective_contact_id))
                await db.commit()
            else:
                c_cur = await db.execute("SELECT id, title, user_id, contact_id FROM ai_conversations WHERE id = ?", (active_conv_id,))
                c_row = await c_cur.fetchone()
                if not c_row:
                    if effective_contact_id:
                        ct_c = await db.execute("SELECT name, email FROM contacts WHERE id = ?", (effective_contact_id,))
                        ct_r = await ct_c.fetchone()
                        target_name = (ct_r["name"] or ct_r["email"].split("@")[0]) if ct_r else "联系人"
                        title = f"👤 往来研讨：{target_name}"
                    else:
                        title = query[:24].strip() or "新对话"
                    await db.execute("""
                        INSERT INTO ai_conversations (id, title, user_id, contact_id, created_at, updated_at)
                        VALUES (?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
                    """, (active_conv_id, title, user_id or "admin", effective_contact_id))
                else:
                    if not effective_contact_id and c_row["contact_id"]:
                        effective_contact_id = c_row["contact_id"]
                    elif effective_contact_id and not c_row["contact_id"]:
                        await db.execute("UPDATE ai_conversations SET contact_id = ? WHERE id = ?", (effective_contact_id, active_conv_id))

                    if c_row["title"] == "新对话":
                        if effective_contact_id:
                            ct_c = await db.execute("SELECT name, email FROM contacts WHERE id = ?", (effective_contact_id,))
                            ct_r = await ct_c.fetchone()
                            target_name = (ct_r["name"] or ct_r["email"].split("@")[0]) if ct_r else "联系人"
                            title = f"👤 往来研讨：{target_name}"
                        else:
                            title = query[:24].strip() or "新对话"
                        await db.execute("UPDATE ai_conversations SET title = ? WHERE id = ?", (title, active_conv_id))
                await db.commit()

            # Save user message
            user_msg_id = f"msg_{uuid.uuid4().hex[:12]}"
            await db.execute("""
                INSERT INTO ai_messages (id, conversation_id, role, content, created_at)
                VALUES (?, ?, 'user', ?, datetime('now', 'localtime'))
            """, (user_msg_id, active_conv_id, query))
            await db.commit()

            # If effective_contact_id is present, retrieve rich contact background & timeline
            if effective_contact_id:
                ct_cur = await db.execute("""
                    SELECT id, account_id, email, name, domain, inbound_count, outbound_count,
                           first_interaction, last_interaction, weight
                    FROM contacts WHERE id = ?
                """, (effective_contact_id,))
                ct_row = await ct_cur.fetchone()
                if ct_row:
                    ct_dict = dict(ct_row)
                    c_email = ct_dict["email"]
                    c_name = ct_dict["name"] or c_email.split("@")[0]
                    c_domain = ct_dict["domain"] or ""
                    c_inbound = ct_dict["inbound_count"] or 0
                    c_outbound = ct_dict["outbound_count"] or 0
                    c_total = c_inbound + c_outbound

                    # Fetch cached AI report if available
                    rep_cur = await db.execute("""
                        SELECT report_markdown FROM contact_ai_reports
                        WHERE contact_id = ? OR contact_email = ?
                        LIMIT 1
                    """, (ct_dict["id"], c_email))
                    rep_row = await rep_cur.fetchone()
                    rep_text = rep_row["report_markdown"] if rep_row and rep_row["report_markdown"] else ""

                    # Fetch recent timeline emails
                    email_cur = await db.execute("""
                        SELECT id, subject, from_name, from_email, to_emails, date_str, snippet, labels
                        FROM emails
                        WHERE (lower(from_email) = lower(?) OR to_emails LIKE ? OR cc_emails LIKE ?)
                        ORDER BY date_timestamp DESC
                        LIMIT 30
                    """, (c_email, f"%{c_email}%", f"%{c_email}%"))
                    email_rows = await email_cur.fetchall()

                    # Query attachments for these timeline emails
                    timeline_email_ids = [em["id"] for em in email_rows]
                    timeline_att_map = {}
                    if timeline_email_ids:
                        t_placeholders = ",".join("?" * len(timeline_email_ids))
                        t_cur = await db.execute(f"""
                            SELECT id, email_id, filename, file_size 
                            FROM attachments 
                            WHERE email_id IN ({t_placeholders})
                        """, timeline_email_ids)
                        for a in await t_cur.fetchall():
                            timeline_att_map.setdefault(a["email_id"], []).append(f"{a['filename']}(ID:{a['id']})")

                    emails_summary_list = []
                    for idx, em in enumerate(email_rows, 1):
                        subj = em["subject"] or "（无主题）"
                        d_str = (em["date_str"] or "")[:16]
                        em_id = em["id"]
                        is_out = ("SENT" in (em["labels"] or "")) or (em["from_email"] and em["from_email"].lower() != c_email.lower())
                        direction_str = "我方发出" if is_out else "对方来信"
                        snip = (em["snippet"] or "")[:120].replace("\n", " ")
                        att_info = ""
                        if em_id in timeline_att_map:
                            att_info = f" | 附件: [{', '.join(timeline_att_map[em_id])}]"
                        emails_summary_list.append(f"{idx}. [{d_str}] [{direction_str}] 主题: 《{subj}》 | 摘要: {snip}{att_info} | 引用标记: [REF:{em_id}|{subj}|{d_str}]")
                        contact_initial_refs.append({
                            "id": em_id,
                            "subject": subj,
                            "date": d_str,
                            "from": em["from_email"] or em["from_name"] or "",
                            "snippet": snip
                        })

                    emails_text = "\n".join(emails_summary_list) if emails_summary_list else "（暂无具体往来邮件记录）"

                    contact_context_prompt = f"""
==================================================
【当前专注探讨联系人背景与全量往来脉络（已注入系统背景）】
- 目标联系人：{c_name} <{c_email}> (所属组织/域名: {c_domain})
- 往来统计：累计往来 {c_total} 封（对方来信 {c_inbound} 封，我方发出 {c_outbound} 封）
- 首次往来：{ct_dict.get("first_interaction") or "未知"}，最近互动：{ct_dict.get("last_interaction") or "未知"}
"""
                    if rep_text:
                        contact_context_prompt += f"\n【此前生成的 AI 人脉画像与深度报告】：\n{rep_text[:2000]}\n"

                    contact_context_prompt += f"""
【与该联系人的核心往来邮件时间线（最新30封，包含附件标识，可直接引用与解析）：
{emails_text}
==================================================
"""

        # Emit conversation metadata
        yield f"data: {json.dumps({'type': 'conversation', 'conversation_id': active_conv_id, 'contact_id': effective_contact_id}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'status', 'stage': 'analyzing', 'message': '正在分析问题意图并检索上下文...'}, ensure_ascii=False)}\n\n"

        if contact_initial_refs:
            yield f"data: {json.dumps({'type': 'references', 'references': contact_initial_refs}, ensure_ascii=False)}\n\n"

        base_url, api_key, resolved_model = await cls.resolve_model_and_credentials(model=model, platform_id=platform_id)
        is_local = "localhost" in base_url or "127.0.0.1" in base_url

        if not api_key and not is_local:
            err_msg = "请先在「系统设置」中配置大模型 API Key（支持 DeepSeek、OpenAI、SiliconFlow 或 本地 Ollama）"
            yield f"data: {json.dumps({'type': 'error', 'error': err_msg}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        target_url = base_url.rstrip("/")
        if not target_url.endswith("/chat/completions"):
            target_url = f"{target_url}/chat/completions"

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        # System prompt for Agent
        agent_system_prompt = """你是由 Email-Yalis 驱动的专业邮件与人脉数字资产分析专家。
你具备调用本地工具直接查询 SQLite 数据库、深度解析附件及通过互联网外部检索的能力，拥有以下工具：
- `search_emails`：根据关键词、发件人、收件人或联系人邮箱精准检索邮件（支持双向收发信穿透）。返回的每封邮件包含关联附件列表（含附件ID与文件名）。
- `inspect_attachment`：深入解析具体附件的完整内容（支持 PDF 合同/发票/报价单、Excel 电子表格、CSV/纯文本数据以及图像规格）。当用户询问附件详情（如订单金额、单价、款项明细、数据行等）时必须调用此工具。
- `get_contact_info`：根据邮箱或姓名查询联系人档案画像、往来统计与历史生成的 AI 报告。
- `query_subscriptions`：查询 SaaS 订阅账单与周期性财务开销。
- `query_digital_assets`：查询已登记的数字资产与第三方平台账号。
- `search_web`：通过互联网进行外部公开信息检索。当用户询问外部事实、公司/服务商背景介绍、最新资讯、汇率换算、技术文档或需要对发件人域名/外部平台进行网络调研时调用此工具。

【工作准则】：
1. 遇到需要查询具体人脉、往来邮件、附件内容、收发记录、账单开销或账号的问题，必须优先主动调用相应工具查询真实数据库，切勿凭空猜测。
2. 【多轮对话与指代消解】：当用户提问包含指代性代词（如“这名客户”、“该订单”、“他的邮箱”、“对方”、“为什么丢单”）时，必须结合前文对话中已提到的客户姓名（如 Kelly Marzo）、邮箱或订单号，将其作为参数传入工具进行定向精准检索，切勿脱离上下文断章取义。
3. 【业务背景与检索规范】：
   - 本地邮件库以英文外贸往来业务为主（常见如 MaxEmblem 徽章/硬币/布贴/勋章定制，核心业务词包括 order, invoice, payment, sample, PO, quotation, shipment, tracking 等）。
   - 当用户使用中文询问涉及“订单、客户、成交、发票、合同、报价、物流”等业务时，调用 `search_emails` 的 `keywords` 必须优先结合常见的英文核心词（例如 "order", "invoice", "payment", "sample" 等）或指定联系人邮箱/姓名，切勿只搜索中文词导致检索为空。
   - 【核心词精简】：`keywords` 请使用 1~2 个精简核心词（如 "order" 或 "invoice"），切勿拼接冗长长难句（如 "order confirmed deal closed"），以确保检索命中率。
4. 若用户提问涉及附件细节（如发票金额、报价条目、工单明细等），可先通过 `search_emails` 或联系人往来邮件识别附件 ID，再调用 `inspect_attachment` 解析附件内容后再回答。
5. 遇到涉及外部公司背景、未知 SaaS 平台介绍、最新汇率、行业资讯或用户明确要求联网检索的问题，主动调用 `search_web` 获取准确客观的外部信息。
6. 若回答依据了具体检索出的邮件或附件所属邮件，必须在陈述句末尾带上引用标记 `[REF:email_id|邮件主题|日期]`，系统前端会自动将其渲染为可点击的邮件卡片。
7. 排版清晰，善于使用 Markdown 列表、加粗以及表格进行对比展示。
"""
        if contact_context_prompt:
            agent_system_prompt += f"\n{contact_context_prompt}\n【特别指令】：当前会话是专门针对上述联系人的专属探讨。请依据提供的往来时间线与画像深入解答用户问题。若引述具体邮件，必须标注引用卡片标记 `[REF:email_id|主题|日期]`。"

        # Load existing summary and check for context compression
        existing_summary = ""
        compressed_at = None
        async with get_db() as db:
            c_check = await db.execute("SELECT context_summary, compressed_at FROM ai_conversations WHERE id = ?", (active_conv_id,))
            c_row = await c_check.fetchone()
            if c_row:
                existing_summary = c_row["context_summary"] or ""
                compressed_at = c_row["compressed_at"]

        limit_tokens = await cls.get_model_context_limit(model=model, platform_id=platform_id)
        tools_tokens = estimate_tokens(json.dumps(COPILOT_TOOLS, ensure_ascii=False))
        sys_tokens = estimate_tokens(agent_system_prompt)
        hist_tokens = sum(estimate_tokens(h.get("content", "")) + 4 for h in (history or []))
        q_tokens = estimate_tokens(query) + 4
        sum_tokens = estimate_tokens(existing_summary) if existing_summary else 0
        est_total = sys_tokens + tools_tokens + hist_tokens + q_tokens + sum_tokens

        # Check if exceeding 50% limit and enough messages to compress
        if est_total >= (limit_tokens * 0.5) and len(history or []) >= 4:
            yield f"data: {json.dumps({'type': 'compressing', 'message': '检测到当前上下文占用已超 50%，正在执行智能语义压缩提炼...'}, ensure_ascii=False)}\n\n"
            comp_res = await cls.compress_conversation(active_conv_id, user_id=user_id)
            if comp_res.get("success"):
                existing_summary = comp_res.get("summary") or ""
                compressed_at = comp_res.get("stats", {}).get("compressed_at")
                yield f"data: {json.dumps({'type': 'compressed', 'summary': existing_summary, 'stats': comp_res.get('stats')}, ensure_ascii=False)}\n\n"

        if existing_summary:
            agent_system_prompt += f"\n\n==================================================\n【前文对话核心记忆（已智能压缩提炼）】：\n{existing_summary}\n【说明】：以上为早期历史对话提炼的结构化记忆事实，请与下方最新对话结合，连贯回应用户。\n=================================================="
            active_history = (history or [])[-4:]
        else:
            active_history = (history or [])[-24:]

        messages = [{"role": "system", "content": agent_system_prompt}]
        for h in active_history:
            role = h.get("role", "user")
            content = h.get("content", "")
            if role in ["user", "assistant"] and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": query})

        # Emit initial context stats
        init_stats = await cls.get_conversation_context_stats(active_conv_id, model=resolved_model, platform_id=platform_id, user_id=user_id)
        yield f"data: {json.dumps({'type': 'context_stats', 'stats': init_stats}, ensure_ascii=False)}\n\n"

        all_references = list(contact_initial_refs)
        accumulated_reply = []
        accumulated_thinking = []
        thinking_start_time = None
        thinking_end_time = None

        # Attempt 1: Agent Function Calling (Supports up to 2 rounds of tool chaining)
        try:
            MAX_TOOL_ROUNDS = 2
            any_tool_called = False

            async with httpx.AsyncClient(timeout=35.0) as client:
                for round_idx in range(MAX_TOOL_ROUNDS):
                    payload = {
                        "model": resolved_model,
                        "messages": messages,
                        "tools": COPILOT_TOOLS,
                        "tool_choice": "auto",
                        "temperature": 0.2
                    }
                    if thinking_level and thinking_level in ["low", "medium", "high", "max"]:
                        if "o1" not in (resolved_model or "").lower() and "claude-3-7" not in (resolved_model or "").lower():
                            payload["reasoning_effort"] = "high" if thinking_level == "max" else thinking_level

                    resp = await client.post(target_url, headers=headers, json=payload)
                    if resp.status_code != 200:
                        raise Exception(f"HTTP {resp.status_code}: {resp.text[:200]}")

                    resp_json = resp.json()
                    choice_msg = resp_json.get("choices", [{}])[0].get("message", {})
                    tool_calls = choice_msg.get("tool_calls") or []

                    if not tool_calls:
                        if not any_tool_called:
                            # Model did not call any tools at all (e.g. casual conversational query)
                            direct_reasoning = (
                                choice_msg.get("reasoning_content") 
                                or choice_msg.get("reasoning") 
                                or choice_msg.get("thought") 
                                or choice_msg.get("thought_content") 
                                or ""
                            )
                            if direct_reasoning:
                                accumulated_thinking.append(direct_reasoning)
                                yield f"data: {json.dumps({'type': 'thinking', 'delta': direct_reasoning}, ensure_ascii=False)}\n\n"

                            direct_content = choice_msg.get("content", "")
                            if direct_content and direct_content.strip():
                                accumulated_reply.append(direct_content)
                                chunk_size = 12
                                for i in range(0, len(direct_content), chunk_size):
                                    chunk_slice = direct_content[i:i+chunk_size]
                                    yield f"data: {json.dumps({'type': 'chunk', 'delta': chunk_slice}, ensure_ascii=False)}\n\n"
                                    await asyncio.sleep(0.015)
                                yield "data: [DONE]\n\n"
                                return
                            else:
                                async for chunk in cls._stream_llm(messages, temperature=0.5, max_tokens=2200, model=resolved_model, platform_id=platform_id, thinking_level=thinking_level):
                                    yield chunk
                                    if "data: " in chunk and "[DONE]" not in chunk:
                                        try:
                                            p = json.loads(chunk.replace("data: ", "").strip())
                                            if p.get("type") == "thinking":
                                                if thinking_start_time is None:
                                                    thinking_start_time = time.time()
                                                accumulated_thinking.append(p.get("delta", ""))
                                            elif p.get("type") == "chunk":
                                                if thinking_start_time and thinking_end_time is None:
                                                    thinking_end_time = time.time()
                                                accumulated_reply.append(p.get("delta", ""))
                                        except Exception:
                                            pass
                        # If tools were already executed in a previous round, break to stream final synthesis
                        break

                    # Tool calls received in this round
                    any_tool_called = True
                    tool_responses = {}
                    for tc in tool_calls:
                        tc_id = tc.get("id") or f"call_{uuid.uuid4().hex[:8]}"
                        fn_name = tc.get("function", {}).get("name", "")
                        raw_args = tc.get("function", {}).get("arguments", "{}")
                        try:
                            fn_args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
                        except Exception:
                            fn_args = {}

                        # 1. Emit tool_start
                        tool_display_name = TOOL_NAMES.get(fn_name, fn_name) if 'TOOL_NAMES' in globals() else fn_name
                        yield f"data: {json.dumps({'type': 'status', 'stage': 'tool_executing', 'message': f'正在调用工具检索数据（{fn_name}）...'}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'tool_start', 'id': tc_id, 'tool_name': fn_name, 'args': fn_args}, ensure_ascii=False)}\n\n"

                        # 2. Execute local tool
                        tool_result, refs, summary = await execute_copilot_tool(fn_name, fn_args, account_id)
                        tool_responses[tc_id] = tool_result
                        for r in refs:
                            if r["id"] not in [x["id"] for x in all_references]:
                                all_references.append(r)

                        # 3. Emit tool_result
                        yield f"data: {json.dumps({'type': 'tool_result', 'id': tc_id, 'tool_name': fn_name, 'summary': summary, 'references': refs}, ensure_ascii=False)}\n\n"

                    # Emit references event if any references found
                    if all_references:
                        yield f"data: {json.dumps({'type': 'references', 'references': all_references}, ensure_ascii=False)}\n\n"

                    # Append assistant message and tool responses for next turn or final synthesis
                    messages.append({
                        "role": "assistant",
                        "content": choice_msg.get("content") or "",
                        "tool_calls": tool_calls
                    })
                    for tc in tool_calls:
                        tc_id = tc.get("id") or ""
                        fn_name = tc.get("function", {}).get("name", "")
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "name": fn_name,
                            "content": json.dumps(tool_responses.get(tc_id, {}), ensure_ascii=False)
                        })

                # If tools were executed, stream final synthesis turn with thinking support
                if any_tool_called:
                    ref_count = len(all_references)
                    ref_hint = f"（已引用 {ref_count} 项数据）" if ref_count > 0 else ""
                    yield f"data: {json.dumps({'type': 'status', 'stage': 'synthesizing', 'message': f'数据检索完成{ref_hint}，大模型正在深度思考并组织回答...'}, ensure_ascii=False)}\n\n"
                    
                    synthesis_messages = list(messages)
                    synthesis_messages.append({
                        "role": "user",
                        "content": "【系统指令】：所有本地工具数据检索阶段已全部执行完毕。请直接根据上方已获取到的数据事实（若未检索到直接匹配的记录，请如实告知未找到，并结合本邮件库以英文外贸业务为主的背景，建议用户提供具体英文核心词如 order, invoice, payment 或指定客户邮箱），用自然流畅的中文直接向用户输出清晰专业的最终回答。切勿再输出任何 <tool_call>、<function> 标签或工具调用代码块。"
                    })
                    async for chunk in cls._stream_llm(synthesis_messages, temperature=0.5, max_tokens=2200, model=resolved_model, platform_id=platform_id, thinking_level=thinking_level):
                        yield chunk
                        if "data: " in chunk and "[DONE]" not in chunk:
                            try:
                                p = json.loads(chunk.replace("data: ", "").strip())
                                if p.get("type") == "thinking":
                                    if thinking_start_time is None:
                                        thinking_start_time = time.time()
                                    accumulated_thinking.append(p.get("delta", ""))
                                elif p.get("type") == "chunk":
                                    if thinking_start_time and thinking_end_time is None:
                                        thinking_end_time = time.time()
                                    accumulated_reply.append(p.get("delta", ""))
                            except Exception:
                                pass
        except Exception as e:
            # Fallback to pre-retrieval RAG mode if tools calling is unsupported or failed
            context_str, references = await search_context_for_query(query, account_id, history=active_history)
            all_references = list(references)
            for cr in contact_initial_refs:
                if not any(x.get("id") == cr.get("id") for x in all_references):
                    all_references.append(cr)
            yield f"data: {json.dumps({'type': 'references', 'references': all_references}, ensure_ascii=False)}\n\n"

            rag_system_prompt = f"""你是由 Email-Yalis 本地邮件资产系统驱动的高级邮件资产分析助手。
用户正在向你提问关于他的本地邮件库、SaaS 资产、订阅账单与联系人的问题。

你的核心工作准则：
1. 【多轮对话连续性与历史记忆】：用户的提问通常基于前文对话展开（例如“这名客户”、“该订单”、“他的邮箱”、“为什么”）。请务必紧密结合上下文对话历史进行理解与回答。前文已确认的事实与实体依然成立有效，切勿因为当前单轮增量检索未重复包含该实体而盲目怀疑或否定前文真实发生的结论。
2. 【忠于事实】：当陈述具体业务细节、邮件内容、订单号或金额时，优先依据下方提供的【本地系统检索到的真实数据】以及前文对话已确认的事实，切勿凭空捏造未出现的数据。
3. 【引用标注】：若陈述依据了具体检索出的邮件，必须在陈述句末尾带上引用标记 `[REF:email_id|邮件主题|日期]`，系统前端会自动将其渲染为可点击的邮件卡片。
4. 【排版清晰】：善于使用 Markdown 列表、加粗以及表格组织对比数据。如果用户询问费用，请汇总出总额与明细。
5. 【无记录时诚实反馈】：如果检索数据与上下文历史中均无相关信息，请如实告知未找到，并建议用户使用具体的中英文关键词进行定向搜索。
"""
            if contact_context_prompt:
                rag_system_prompt += f"\n{contact_context_prompt}\n"

            rag_system_prompt += f"""
----------------
【本地系统检索到的真实数据】：
{context_str if context_str.strip() else "（未检索到直接匹配的本地邮件或资产台账记录）"}
----------------
"""
            if existing_summary:
                rag_system_prompt += f"\n【前文对话核心记忆（已智能压缩提炼）】：\n{existing_summary}\n"
            fallback_messages = [{"role": "system", "content": rag_system_prompt}]
            for h in active_history:
                role = h.get("role", "user")
                content = h.get("content", "")
                if role in ["user", "assistant"] and content:
                    fallback_messages.append({"role": role, "content": content})
            fallback_messages.append({"role": "user", "content": query})

            ref_count = len(all_references)
            ref_hint = f"（匹配到 {ref_count} 封关联邮件）" if ref_count > 0 else ""
            yield f"data: {json.dumps({'type': 'status', 'stage': 'synthesizing', 'message': f'本地数据检索完成{ref_hint}，正在深度分析并组织回答...'}, ensure_ascii=False)}\n\n"

            async for chunk in cls._stream_llm(fallback_messages, temperature=0.5, max_tokens=2200, model=resolved_model, platform_id=platform_id, thinking_level=thinking_level):
                yield chunk
                if "data: " in chunk and "[DONE]" not in chunk:
                    try:
                        p = json.loads(chunk.replace("data: ", "").strip())
                        if p.get("type") == "thinking":
                            if thinking_start_time is None:
                                thinking_start_time = time.time()
                            accumulated_thinking.append(p.get("delta", ""))
                        elif p.get("type") == "chunk":
                            if thinking_start_time and thinking_end_time is None:
                                thinking_end_time = time.time()
                            accumulated_reply.append(p.get("delta", ""))
                    except Exception:
                        pass

        # Save assistant message
        full_reply_text = "".join(accumulated_reply).strip()
        full_reply_text = re.sub(r'<tool_call>[\s\S]*?<\/tool_call>', '', full_reply_text).strip()
        full_reply_text = re.sub(r'<tool_call>[\s\S]*', '', full_reply_text).strip()
        full_thinking_text = "".join(accumulated_thinking).strip() or None
        thinking_duration = 0
        if thinking_start_time:
            end_t = thinking_end_time or time.time()
            thinking_duration = max(1, int(end_t - thinking_start_time))

        if (full_reply_text or full_thinking_text) and active_conv_id:
            async with get_db() as db:
                asst_msg_id = f"msg_{uuid.uuid4().hex[:12]}"
                await db.execute("""
                    INSERT INTO ai_messages (id, conversation_id, role, content, thinking_content, thinking_duration, references_json, created_at)
                    VALUES (?, ?, 'assistant', ?, ?, ?, ?, datetime('now', 'localtime'))
                """, (asst_msg_id, active_conv_id, full_reply_text, full_thinking_text, thinking_duration, json.dumps(all_references, ensure_ascii=False)))
                await db.execute("""
                    UPDATE ai_conversations SET updated_at = datetime('now', 'localtime') WHERE id = ?
                """, (active_conv_id,))
                await db.commit()

        # Emit final updated context stats
        try:
            final_stats = await cls.get_conversation_context_stats(active_conv_id, model=resolved_model, platform_id=platform_id, user_id=user_id)
            yield f"data: {json.dumps({'type': 'context_stats', 'stats': final_stats}, ensure_ascii=False)}\n\n"
        except Exception:
            pass

    @classmethod
    async def scan_unclassified_assets(cls, account_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Scans emails for SaaS registrations or bills missed by rules using LLM.
        """
        async with get_db() as db:
            acc_filter = "AND account_id = ?" if account_id else ""
            params = [account_id] if account_id else []
            # Find candidate emails containing billing or welcome words that aren't yet in subscriptions or digital_assets
            cursor = await db.execute(f"""
                SELECT id, account_id, subject, from_name, from_email, date_str, snippet, body_text
                FROM emails
                WHERE (
                    subject LIKE '%receipt%' OR subject LIKE '%invoice%' OR subject LIKE '%subscription%'
                    OR subject LIKE '%welcome%' OR subject LIKE '%账单%' OR subject LIKE '%发票%'
                    OR subject LIKE '%扣费%' OR subject LIKE '%激活%' OR subject LIKE '%注册成功%'
                )
                AND id NOT IN (SELECT DISTINCT source_email_id FROM digital_assets WHERE source_email_id IS NOT NULL)
                AND id NOT IN (SELECT DISTINCT source_email_id FROM subscriptions WHERE source_email_id IS NOT NULL)
                {acc_filter}
                ORDER BY date_timestamp DESC LIMIT 15
            """, params)
            candidates = await cursor.fetchall()

        if not candidates:
            return {"scanned_count": 0, "new_assets": [], "new_subscriptions": []}

        # Format candidates for LLM extraction
        sample_list = []
        for c in candidates:
            sample_list.append({
                "email_id": c["id"],
                "subject": c["subject"],
                "from": f"{c['from_name']} <{c['from_email']}>",
                "date": c["date_str"],
                "snippet": (c["snippet"] or c["body_text"] or "")[:200]
            })

        prompt = f"""请分析以下从用户邮箱中筛选出的可能包含 SaaS 注册或消费账单的邮件，识别其中真正的【数字资产/SaaS平台】或【订阅扣费记录】。

候选邮件列表：
{json.dumps(sample_list, ensure_ascii=False, indent=2)}

请严格返回如下 JSON 格式（不要有任何 markdown 标记外的闲聊）：
```json
{{
  "assets": [
    {{
      "email_id": "...",
      "platform_name": "SaaS平台名称 (如 Figma, Cursor, OpenAI)",
      "category": "dev_ops/productivity/finance/ai_tools/entertainment/social/other",
      "domain": "平台域名"
    }}
  ],
  "subscriptions": [
    {{
      "email_id": "...",
      "service_name": "服务名称",
      "currency": "USD/CNY/EUR/GBP",
      "amount": 10.0,
      "cycle": "monthly/yearly/one_time",
      "invoice_date": "YYYY-MM-DD"
    }}
  ]
}}
```
如果某封邮件不属于 SaaS 注册或真实账单，请不要包含在返回列表中。"""

        messages = [
            {"role": "system", "content": "你是一个精准的数据提取与清洗专家，严格输出合法的 JSON 格式。"},
            {"role": "user", "content": prompt}
        ]

        # Use non-streaming call
        base_url, api_key, model = await cls.resolve_model_and_credentials()
        target_url = f"{base_url}/chat/completions" if not base_url.endswith("/chat/completions") else base_url
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        new_assets = []
        new_subscriptions = []

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(target_url, headers=headers, json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.1
                })
                if resp.status_code == 200:
                    raw_content = resp.json()["choices"][0]["message"]["content"]
                    # Extract JSON block
                    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_content)
                    json_str = match.group(1) if match else raw_content.strip()
                    parsed = json.loads(json_str)
                    new_assets = parsed.get("assets", [])
                    new_subscriptions = parsed.get("subscriptions", [])

                    # Store newly identified assets into SQLite
                    async with get_db() as db:
                        for a in new_assets:
                            e_id = a.get("email_id")
                            # get account_id of email
                            c_mail = next((c for c in candidates if c["id"] == e_id), None)
                            if c_mail and a.get("platform_name"):
                                import uuid
                                asset_id = f"ai_asset_{uuid.uuid4().hex[:12]}"
                                await db.execute("""
                                    INSERT INTO digital_assets(id, account_id, platform_name, domain, category, registered_email, first_detected_at, source_email_id, confidence_score)
                                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0.95)
                                """, (asset_id, c_mail["account_id"], a["platform_name"], a.get("domain", ""), a.get("category", "other"), c_mail["from_email"], c_mail["date_str"], e_id))

                        for s in new_subscriptions:
                            e_id = s.get("email_id")
                            c_mail = next((c for c in candidates if c["id"] == e_id), None)
                            if c_mail and s.get("service_name") and float(s.get("amount", 0)) > 0:
                                import uuid
                                sub_id = f"ai_sub_{uuid.uuid4().hex[:12]}"
                                await db.execute("""
                                    INSERT INTO subscriptions(id, account_id, service_name, currency, amount, cycle, invoice_date, source_email_id)
                                    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                                """, (sub_id, c_mail["account_id"], s["service_name"], s.get("currency", "USD"), float(s["amount"]), s.get("cycle", "monthly"), s.get("invoice_date", c_mail["date_str"]), e_id))
                        await db.commit()
        except Exception as e:
            return {"scanned_count": len(candidates), "error": str(e), "new_assets": [], "new_subscriptions": []}

        return {
            "scanned_count": len(candidates),
            "new_assets": new_assets,
            "new_subscriptions": new_subscriptions
        }

    @classmethod
    async def get_contact_ai_report(cls, contact_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves cached contact AI report from SQLite"""
        async with get_db() as db:
            cursor = await db.execute("""
                SELECT contact_id, account_id, contact_email, contact_name, report_markdown, summary_tags, model_name, created_at, updated_at
                FROM contact_ai_reports WHERE contact_id = ?
            """, (contact_id,))
            row = await cursor.fetchone()
            if row:
                tags = []
                if row["summary_tags"]:
                    try:
                        tags = json.loads(row["summary_tags"])
                    except Exception:
                        tags = []
                return {
                    "contact_id": row["contact_id"],
                    "account_id": row["account_id"],
                    "contact_email": row["contact_email"],
                    "contact_name": row["contact_name"],
                    "report_markdown": row["report_markdown"],
                    "summary_tags": tags,
                    "model_name": row["model_name"] or "",
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"]
                }
        return None

    @classmethod
    async def list_summarized_contacts(cls, account_id: Optional[str] = None, sort_by: str = "weight") -> List[Dict[str, Any]]:
        """Lists all contacts that have generated AI reports with specified sorting"""
        async with get_db() as db:
            where_clause = "WHERE (? IS NULL OR r.account_id = ?)"
            order_clause = (
                "ORDER BY c.last_interaction DESC, r.updated_at DESC"
                if sort_by == "recent"
                else "ORDER BY (COALESCE(c.inbound_count,0) + COALESCE(c.outbound_count,0)) DESC, c.weight DESC, r.updated_at DESC"
            )
            cursor = await db.execute(f"""
                SELECT r.contact_id, r.account_id, r.contact_email, r.contact_name,
                       r.summary_tags, r.model_name, r.updated_at, r.created_at,
                       c.domain, c.inbound_count, c.outbound_count, c.first_interaction, c.last_interaction, c.weight
                FROM contact_ai_reports r
                LEFT JOIN contacts c ON r.contact_id = c.id
                {where_clause}
                {order_clause}
            """, (account_id, account_id))
            rows = await cursor.fetchall()
            results = []
            for r in rows:
                tags = []
                if r["summary_tags"]:
                    try:
                        tags = json.loads(r["summary_tags"])
                    except Exception:
                        tags = []
                results.append({
                    "contact_id": r["contact_id"],
                    "account_id": r["account_id"],
                    "email": r["contact_email"],
                    "name": r["contact_name"],
                    "domain": r["domain"],
                    "inbound_count": r["inbound_count"] or 0,
                    "outbound_count": r["outbound_count"] or 0,
                    "first_interaction": r["first_interaction"],
                    "last_interaction": r["last_interaction"],
                    "weight": r["weight"] or 0.0,
                    "summary_tags": tags,
                    "model_name": r["model_name"] or "",
                    "updated_at": r["updated_at"]
                })
            return results

    @classmethod
    async def delete_contact_ai_report(cls, contact_id: str) -> bool:
        """Deletes cached report for a contact"""
        async with get_db() as db:
            await db.execute("DELETE FROM contact_ai_reports WHERE contact_id = ?", (contact_id,))
            await db.commit()
        return True

    @classmethod
    async def stream_contact_ai_summary(
        cls, 
        contact_id: str, 
        force_refresh: bool = False,
        model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        Generates full-fledged relationship portrait and email dialogue journey summary for a contact.
        Caches the report in contact_ai_reports table.
        """
        # 1. Fetch contact info
        async with get_db() as db:
            c_cursor = await db.execute("""
                SELECT id, account_id, email, name, domain, inbound_count, outbound_count,
                       first_interaction, last_interaction, weight
                FROM contacts WHERE id = ?
            """, (contact_id,))
            contact = await c_cursor.fetchone()

        if not contact:
            yield f"data: {json.dumps({'type': 'error', 'error': '未找到该联系人信息'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        # 2. Check cached report
        if not force_refresh:
            cached = await cls.get_contact_ai_report(contact_id)
            if cached and cached.get("report_markdown"):
                yield f"data: {json.dumps({'type': 'cached', 'report': cached}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

        target_email = contact["email"]
        account_id = contact["account_id"]

        # Fetch account user email
        user_email = ""
        if account_id:
            async with get_db() as db:
                acc_cursor = await db.execute("SELECT email FROM accounts WHERE id = ?", (account_id,))
                acc = await acc_cursor.fetchone()
                if acc:
                    user_email = acc["email"].lower()

        # 3. Fetch all emails associated with this contact
        async with get_db() as db:
            email_params = [target_email, f"%{target_email}%", f"%{target_email}%"]
            acc_sql = " AND account_id = ?" if account_id else ""
            if account_id:
                email_params.append(account_id)

            e_cursor = await db.execute(f"""
                SELECT id, subject, from_name, from_email, to_emails, cc_emails,
                       date_timestamp, date_str, snippet, body_text, labels, has_attachments
                FROM emails
                WHERE (lower(from_email) = lower(?) OR to_emails LIKE ? OR cc_emails LIKE ?)
                {acc_sql}
                ORDER BY date_timestamp ASC
                LIMIT 120
            """, email_params)
            candidate_rows = await e_cursor.fetchall()

        # Strict isolation: ensure the target email address exactly matches
        target_lower = target_email.lower().strip()
        email_rows = []
        for em in candidate_rows:
            from_e = (em["from_email"] or "").lower().strip()
            to_e = (em["to_emails"] or "").lower()
            cc_e = (em["cc_emails"] or "").lower()
            to_addresses = [a.lower() for a in re.findall(r'[\w\.-]+@[\w\.-]+', to_e)]
            cc_addresses = [a.lower() for a in re.findall(r'[\w\.-]+@[\w\.-]+', cc_e)]
            if from_e == target_lower or target_lower in to_addresses or target_lower in cc_addresses:
                email_rows.append(em)

        if not email_rows:
            yield f"data: {json.dumps({'type': 'error', 'error': '该联系人暂无往来邮件记录，无法生成分析报告'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        if len(email_rows) > 60:
            email_rows = email_rows[-60:]

        # 4. Format emails summary
        email_items = []
        for em in email_rows:
            m_labels = em["labels"] or ""
            m_from = (em["from_email"] or "").lower()
            is_outbound = ("SENT" in m_labels) or (bool(user_email) and m_from == user_email)
            dir_str = "我方发送" if is_outbound else "对方来信"
            date_display = em["date_str"] or ""
            subj = em["subject"] or "(无主题)"
            body_sample = (em["body_text"] or em["snippet"] or "").strip()
            if len(body_sample) > 350:
                body_sample = body_sample[:350] + "..."
            
            att_tag = " [含附件]" if em["has_attachments"] else ""
            email_items.append(f"【{date_display} | {dir_str}{att_tag}】\n主题: {subj}\n摘要内容: {body_sample}\n")

        emails_digest = "\n".join(email_items)
        if len(emails_digest) > 12000:
            emails_digest = emails_digest[:12000] + "\n...(历史往来过多，已截取关键部分)..."

        contact_display_name = contact["name"] or contact["email"].split("@")[0]
        total_count = len(email_rows)
        inbound_cnt = sum(1 for e in email_rows if not (("SENT" in (e["labels"] or "")) or (user_email and (e["from_email"] or "").lower() == user_email)))
        outbound_cnt = total_count - inbound_cnt

        prompt = f"""你是由 Email-Yalis 本地邮件系统驱动的高级人脉智能与关系资产分析专家。
请仔细研读下方提供的该联系人的全部历史邮件往来记录，进行深度结构化提炼与洞察，输出一份专业、详实、排版优美的人脉关系总结分析报告。

【联系人基础档案】
- 姓名/称呼: {contact_display_name}
- 电子邮箱: {contact['email']}
- 机构域名: {contact['domain'] or '个人/通用邮箱'}
- 往来统计: 共 {total_count} 封（对方来信 {inbound_cnt} 封，我方发出 {outbound_cnt} 封）
- 首次互动: {contact['first_interaction'] or '未知'}
- 最近互动: {contact['last_interaction'] or '未知'}

【历史往来邮件脉络（按时间正序）】：
{emails_digest}

----------------
【请严格按以下五大维度与 Markdown 规范输出，语气客观透彻、重点突出，切勿废话客套】：

### 👤 人物与机构画像
- **身份与角色定位**：(综合发信人身份、签名、邮件内容，明确指出其职位/业务角色/机构属性，如：SaaS 平台通知机器人、商务合作负责人、技术服务支持等)
- **沟通风格与协作习惯**：(分析其用词风格、邮件响应节奏、沟通倾向与习惯，如：格式化系统推送/严谨商务洽谈/日常敏捷协作)

### 📈 邮件往来历程与阶段演进
- **初识与建联阶段**：(何时首次建联，因何契机或业务事件发起对话)
- **深化与关键转折**：(历程中发生的重要合作、关键协商、方案确定或里程碑事件)
- **近期互动现状**：(近期双方交流的频次、主要聚焦方向与互动紧密程度)

### 📌 核心往来议题与高频讨论点
- (按重要度罗列 2~4 个双方交流中最核心的议题、项目名称、产品或高频关键词，并分别附 1 句精炼说明)

### 💼 涉及资产/交易/账单要点
- (梳理信件中提及的所有财务账单、购买订阅、发票单号、订单金额、SaaS 账户授权或合同凭据；若纯属日常交流未涉及任何金额与资产，请写“经核查，往来中未涉及资金交易或 SaaS 账单凭据”)

### 📋 待跟进事项与关系维护建议
- **未结事项与待办**：(双方是否有尚未完成答复、需要进一步落实或等待后续确认的待办，若无请写“暂无悬挂事项”)
- **人脉经营建议**：(从职业社交与业务维护角度，给出 1~2 条切实可行的后续维护或跟进策略)
"""

        messages = [
            {"role": "system", "content": "你是由 Email-Yalis 驱动的高级人脉关系智能洞察助手，擅长从海量邮件对话中还原关系脉络与人物画像。"},
            {"role": "user", "content": prompt}
        ]

        full_output = []
        async for chunk in cls._stream_llm(messages, temperature=0.3, max_tokens=2500, model=model):
            yield chunk
            if "data: " in chunk and "[DONE]" not in chunk:
                try:
                    payload = json.loads(chunk.replace("data: ", "").strip())
                    if payload.get("type") == "chunk":
                        full_output.append(payload.get("delta", ""))
                except Exception:
                    pass

        # Persist report to SQLite
        accumulated_report = "".join(full_output).strip()
        if accumulated_report:
            base_url, api_key, model_name = await cls.resolve_model_and_credentials(model=model)

            # Extract tags heuristic
            tags = []
            if contact["domain"]:
                tags.append(contact["domain"])
            if total_count >= 10:
                tags.append("高频往来")
            elif total_count >= 3:
                tags.append("日常联系")
            else:
                tags.append("偶发建联")

            if "账单" in accumulated_report or "订阅" in accumulated_report or "金额" in accumulated_report:
                tags.append("涉及账单")
            if "待办" in accumulated_report and "暂无悬挂事项" not in accumulated_report:
                tags.append("有待办")

            async with get_db() as db:
                await db.execute("""
                    INSERT INTO contact_ai_reports(
                        contact_id, account_id, contact_email, contact_name,
                        report_markdown, summary_tags, model_name, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                    ON CONFLICT(contact_id) DO UPDATE SET
                        account_id = excluded.account_id,
                        contact_email = excluded.contact_email,
                        contact_name = excluded.contact_name,
                        report_markdown = excluded.report_markdown,
                        summary_tags = excluded.summary_tags,
                        model_name = excluded.model_name,
                        updated_at = excluded.updated_at
                """, (
                    contact_id,
                    contact["account_id"] or "",
                    contact["email"],
                    contact_display_name,
                    accumulated_report,
                    json.dumps(tags, ensure_ascii=False),
                    model_name
                ))
                await db.commit()
