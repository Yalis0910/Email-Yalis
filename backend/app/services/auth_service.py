import hmac
import hashlib
import json
import base64
import time
import secrets
import sqlite3
import aiosqlite
from typing import Optional, Dict, Any, List, Set, Tuple
from app.config import DB_PATH
from app.database import get_db

PAGE_PERMISSIONS = [
    {"key": "page:dashboard", "label": "总览看板", "desc": "允许访问全局/授权邮箱的总览看板数据与指标"},
    {"key": "page:assets", "label": "账号资产", "desc": "允许查看 SaaS 平台资产、订阅账单与开销统计"},
    {"key": "page:attachments", "label": "附件中心", "desc": "允许检索、分类预览与下载邮件附件"},
    {"key": "page:contacts", "label": "人脉网络", "desc": "允许查阅往来联系人、往来频次与 AI 关系画像"},
    {"key": "page:emails", "label": "检索阅读", "desc": "允许全文搜索邮件正文、阅读邮件内容与线索"},
    {"key": "page:sales_playbook", "label": "话术资料库", "desc": "允许查阅与维护外贸实战异议应答策略、跟进模版与复盘案例库"},
    {"key": "page:ai_copilot", "label": "AI 助手", "desc": "允许使用 AI Copilot 问答工作台与邮件总结草拟"},
    {"key": "page:settings", "label": "配置授权", "desc": "允许查看邮箱连接状态与基础系统配置"},
    {"key": "page:rbac", "label": "组织权限", "desc": "允许访问组织架构、管理组配置与成员账号管理"},
]

ACTION_PERMISSIONS = [
    {"key": "action:accounts_manage", "label": "邮箱账号管理", "desc": "允许添加/绑定新邮箱、解绑/删除邮箱账号"},
    {"key": "action:sync_trigger", "label": "邮件手动同步", "desc": "允许手动触发全量或增量邮件拉取同步"},
    {"key": "action:ai_config", "label": "AI 平台与密钥配置", "desc": "允许修改全局大模型平台地址与 API Key 凭证"},
    {"key": "action:system_ops", "label": "系统维护与清理", "desc": "允许清空数据、注入演示数据及数据库整理"},
    {"key": "action:rbac_manage", "label": "用户与权限管理", "desc": "允许创建、编辑、停用用户及调整管理组权限"},
]

ALL_PAGE_KEYS = [p["key"] for p in PAGE_PERMISSIONS]
ALL_ACTION_KEYS = [a["key"] for a in ACTION_PERMISSIONS]
ALL_PERMISSION_KEYS = ALL_PAGE_KEYS + ALL_ACTION_KEYS

DEFAULT_USER_GROUPS = [
    {
        "id": "group_superadmin",
        "name": "超级管理组",
        "description": "具备系统全部页面访问与全功能管理权限，享有最高运维与组织权限",
        "pages": ALL_PAGE_KEYS,
        "actions": ALL_ACTION_KEYS,
    },
    {
        "id": "group_normal_admin",
        "name": "普通管理组",
        "description": "负责系统日常运营与基础邮箱配置，允许添加/解绑邮箱与执行邮件同步，不享有底层系统运维与组织权限修改权限",
        "pages": [
            "page:dashboard",
            "page:assets",
            "page:attachments",
            "page:contacts",
            "page:emails",
            "page:sales_playbook",
            "page:ai_copilot",
            "page:settings",
        ],
        "actions": [
            "action:accounts_manage",
            "action:sync_trigger",
        ],
    },
    {
        "id": "group_business_admin",
        "name": "业务管理组",
        "description": "面向业务开拓与商务沟通团队，聚焦客户人脉、附件知识库、往来邮件检索及 AI 智能撰写草稿，可按需手动触发邮件同步",
        "pages": [
            "page:dashboard",
            "page:assets",
            "page:attachments",
            "page:contacts",
            "page:emails",
            "page:sales_playbook",
            "page:ai_copilot",
        ],
        "actions": [
            "action:sync_trigger",
        ],
    }
]

_jwt_secret_cache: Optional[str] = None
_user_profile_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}

def _get_or_create_jwt_secret_sync(conn: sqlite3.Connection) -> str:
    global _jwt_secret_cache
    if _jwt_secret_cache:
        return _jwt_secret_cache
    cur = conn.execute("SELECT value FROM system_settings WHERE key = 'jwt_secret'")
    row = cur.fetchone()
    if row and row[0]:
        _jwt_secret_cache = row[0]
        return row[0]
    secret = secrets.token_hex(32)
    conn.execute(
        "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('jwt_secret', ?, datetime('now', 'localtime'))",
        (secret,)
    )
    conn.commit()
    _jwt_secret_cache = secret
    return secret

async def _get_or_create_jwt_secret() -> str:
    global _jwt_secret_cache
    if _jwt_secret_cache:
        return _jwt_secret_cache
    async with get_db() as db:
        async with db.execute("SELECT value FROM system_settings WHERE key = 'jwt_secret'") as cur:
            row = await cur.fetchone()
            if row and row[0]:
                _jwt_secret_cache = row[0]
                return row[0]
        secret = secrets.token_hex(32)
        await db.execute(
            "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('jwt_secret', ?, datetime('now', 'localtime'))",
            (secret,)
        )
        await db.commit()
        _jwt_secret_cache = secret
        return secret

class AuthService:
    @staticmethod
    def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
        """Hash password using PBKDF2-HMAC-SHA256 with 100,000 iterations"""
        if not salt:
            salt = secrets.token_hex(16)
        pwd_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            100000
        ).hex()
        return pwd_hash, salt

    @staticmethod
    def verify_password(password: str, salt: str, expected_hash: str) -> bool:
        """Verify password against salt and expected hash"""
        calc_hash, _ = AuthService.hash_password(password, salt)
        return hmac.compare_digest(calc_hash, expected_hash)

    @staticmethod
    async def create_token(user_id: str, username: str, expires_days: int = 30) -> str:
        """Create signed token for user"""
        secret = await _get_or_create_jwt_secret()
        payload = {
            "uid": user_id,
            "username": username,
            "exp": int(time.time()) + (expires_days * 86400)
        }
        payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8").rstrip("=")
        sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
        sig_b64 = base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")
        return f"{payload_b64}.{sig_b64}"

    @staticmethod
    async def verify_token(token: str) -> Optional[Dict[str, Any]]:
        """Verify signed token, checking signature and expiration"""
        if not token or "." not in token:
            return None
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, sig_b64 = parts
        secret = await _get_or_create_jwt_secret()

        # Re-compute expected signature
        sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
        expected_sig_b64 = base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")
        if not hmac.compare_digest(sig_b64, expected_sig_b64):
            return None

        # Decode payload
        try:
            # Fix padding for base64
            padded = payload_b64 + "=" * (-len(payload_b64) % 4)
            payload_json = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
            payload = json.loads(payload_json)
            if payload.get("exp", 0) < time.time():
                return None
            return payload
        except Exception:
            return None

    @staticmethod
    def init_superadmin_sync(conn: sqlite3.Connection):
        """Synchronous migration check: ensure superadmin & default groups exist and migrate old conversations"""
        _get_or_create_jwt_secret_sync(conn)

        # 1. Ensure all default groups exist
        for grp in DEFAULT_USER_GROUPS:
            cur_grp = conn.execute("SELECT id, page_permissions_json FROM user_groups WHERE id = ?", (grp["id"],))
            row_grp = cur_grp.fetchone()
            if not row_grp:
                conn.execute("""
                    INSERT INTO user_groups (id, name, description, page_permissions_json, action_permissions_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
                """, (grp["id"], grp["name"], grp["description"], json.dumps(grp["pages"]), json.dumps(grp["actions"])))

                # Grant existing accounts to new default group if accounts table exists
                try:
                    cur_accs = conn.execute("SELECT id FROM accounts")
                    for acc_row in cur_accs.fetchall():
                        conn.execute("""
                            INSERT OR IGNORE INTO group_account_permissions (group_id, account_id, created_at)
                            VALUES (?, ?, datetime('now', 'localtime'))
                        """, (grp["id"], acc_row[0]))
                except Exception:
                    pass
            else:
                try:
                    existing_pages = set(json.loads(row_grp[1]) if row_grp[1] else [])
                    needed_pages = set(grp["pages"])
                    if not needed_pages.issubset(existing_pages):
                        merged_pages = list(existing_pages.union(needed_pages))
                        conn.execute("UPDATE user_groups SET page_permissions_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", (json.dumps(merged_pages), grp["id"]))
                except Exception:
                    pass

        # 2. Ensure superadmin user exists
        cur = conn.execute("SELECT id, username FROM users WHERE is_superadmin = 1 LIMIT 1")
        admin = cur.fetchone()
        admin_id = "admin"
        if not admin:
            # Check if username 'admin' exists
            cur_adm = conn.execute("SELECT id FROM users WHERE username = 'admin'")
            adm_row = cur_adm.fetchone()
            if adm_row:
                admin_id = adm_row[0]
                conn.execute("UPDATE users SET is_superadmin = 1, group_id = 'group_superadmin' WHERE id = ?", (admin_id,))
            else:
                salt = secrets.token_hex(16)
                pwd_hash = hashlib.pbkdf2_hmac("sha256", "admin123".encode("utf-8"), salt.encode("utf-8"), 100000).hex()
                conn.execute("""
                    INSERT INTO users (id, username, password_hash, salt, display_name, group_id, is_superadmin, is_active, created_at, updated_at)
                    VALUES (?, 'admin', ?, ?, '超级管理员', 'group_superadmin', 1, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
                """, (admin_id, pwd_hash, salt))
        else:
            admin_id = admin[0]
            conn.execute("UPDATE users SET group_id = 'group_superadmin' WHERE id = ? AND (group_id IS NULL OR group_id = '')", (admin_id,))

        # 3. Migrate existing ai_conversations without user_id to admin
        try:
            cur_col = conn.execute("PRAGMA table_info(ai_conversations)")
            cols = {row[1] for row in cur_col.fetchall()}
            if "user_id" in cols:
                conn.execute("UPDATE ai_conversations SET user_id = ? WHERE user_id IS NULL OR user_id = ''", (admin_id,))
        except Exception as e:
            print(f"Migration ai_conversations error: {e}")

        conn.commit()

    @staticmethod
    def invalidate_user_cache(user_id: Optional[str] = None):
        """Invalidates in-memory user profile cache (call on user/permission updates)"""
        global _user_profile_cache
        if user_id:
            _user_profile_cache.pop(user_id, None)
        else:
            _user_profile_cache.clear()

    @staticmethod
    async def get_user_profile(user_id: str, use_cache: bool = True) -> Optional[Dict[str, Any]]:
        """Fetch complete user profile including group, permissions, and authorized mailboxes with short memory TTL cache"""
        global _user_profile_cache
        if use_cache and user_id in _user_profile_cache:
            ts, cached_profile = _user_profile_cache[user_id]
            if time.time() - ts < 15.0:
                return cached_profile

        async with get_db() as db:
            async with db.execute("""
                SELECT u.id, u.username, u.display_name, u.group_id, u.is_superadmin, u.is_active,
                       u.created_at, u.updated_at,
                       g.name as group_name, g.page_permissions_json, g.action_permissions_json
                FROM users u
                LEFT JOIN user_groups g ON u.group_id = g.id
                WHERE u.id = ?
            """, (user_id,)) as cur:
                row = await cur.fetchone()
                if not row:
                    return None
                user = dict(row)

            # Check if active
            if not user.get("is_active"):
                return None

            is_super = bool(user.get("is_superadmin"))
            page_perms: Set[str] = set()
            action_perms: Set[str] = set()
            authorized_accounts: Optional[List[str]] = None

            if is_super:
                page_perms = set(ALL_PAGE_KEYS)
                action_perms = set(ALL_ACTION_KEYS)
                authorized_accounts = None # None means all accounts authorized
            else:
                try:
                    if user.get("page_permissions_json"):
                        page_perms = set(json.loads(user["page_permissions_json"]))
                except Exception:
                    page_perms = set()
                try:
                    if user.get("action_permissions_json"):
                        action_perms = set(json.loads(user["action_permissions_json"]))
                except Exception:
                    action_perms = set()

                # Get group accounts
                acc_set: Set[str] = set()
                if user.get("group_id"):
                    async with db.execute(
                        "SELECT account_id FROM group_account_permissions WHERE group_id = ?",
                        (user["group_id"],)
                    ) as cur:
                        acc_set.update([r[0] for r in await cur.fetchall()])

                # Get user individual extra accounts
                async with db.execute(
                    "SELECT account_id FROM user_account_permissions WHERE user_id = ?",
                    (user_id,)
                ) as cur:
                    acc_set.update([r[0] for r in await cur.fetchall()])

                authorized_accounts = list(acc_set)

            profile = {
                "id": user["id"],
                "username": user["username"],
                "display_name": user["display_name"] or user["username"],
                "is_superadmin": is_super,
                "group_id": user.get("group_id"),
                "group_name": user.get("group_name") or ("超级管理员" if is_super else "未分配组"),
                "page_permissions": sorted(list(page_perms)),
                "action_permissions": sorted(list(action_perms)),
                "all_permissions": sorted(list(page_perms | action_perms)),
                "authorized_accounts": authorized_accounts,
                "created_at": user["created_at"]
            }
            _user_profile_cache[user_id] = (time.time(), profile)
            return profile

    @staticmethod
    async def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
        """Validate credentials and return user profile if successful"""
        async with get_db() as db:
            async with db.execute(
                "SELECT id, password_hash, salt, is_active FROM users WHERE username = ?",
                (username.strip(),)
            ) as cur:
                row = await cur.fetchone()
                if not row:
                    return None
                user_id, pwd_hash, salt, is_active = row[0], row[1], row[2], row[3]
                if not is_active:
                    return None
                if not AuthService.verify_password(password, salt, pwd_hash):
                    return None

        return await AuthService.get_user_profile(user_id)
