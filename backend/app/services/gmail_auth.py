import json
import os
import aiosqlite
from typing import Optional, Dict, Any
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from app.config import CREDENTIALS_FILE, GMAIL_SCOPES, OAUTH_REDIRECT_URI, DB_PATH
from app.database import get_db

class GmailAuthService:
    @staticmethod
    def is_credentials_configured() -> bool:
        return CREDENTIALS_FILE.exists()

    @staticmethod
    def get_credentials_info() -> Optional[Dict[str, Any]]:
        if not CREDENTIALS_FILE.exists():
            return None
        try:
            with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                client_type = "web" if "web" in data else "installed"
                info = data.get(client_type, {})
                return {
                    "client_id": info.get("client_id"),
                    "project_id": info.get("project_id"),
                    "client_type": client_type,
                    "configured": True
                }
        except Exception:
            return None

    @staticmethod
    def create_oauth_flow(redirect_uri: Optional[str] = None) -> Flow:
        if not CREDENTIALS_FILE.exists():
            raise FileNotFoundError("Google Cloud credentials.json not found in data directory.")
        
        flow = Flow.from_client_secrets_file(
            str(CREDENTIALS_FILE),
            scopes=GMAIL_SCOPES,
            redirect_uri=redirect_uri or OAUTH_REDIRECT_URI,
            autogenerate_code_verifier=False
        )
        return flow

    @classmethod
    def get_authorization_url(cls, redirect_uri: Optional[str] = None) -> Dict[str, str]:
        flow = cls.create_oauth_flow(redirect_uri)
        auth_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'
        )
        return {"auth_url": auth_url, "state": state}

    @classmethod
    async def exchange_code_and_save_account(
        cls,
        code: str,
        redirect_uri: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        flow = cls.create_oauth_flow(redirect_uri)
        flow.fetch_token(code=code)
        creds = flow.credentials

        # Get User Info from Google
        service = build("gmail", "v1", credentials=creds)
        profile = service.users().getProfile(userId="me").execute()
        email_address = profile.get("emailAddress")
        history_id = profile.get("historyId")

        # Try to get display name from userinfo
        display_name = email_address.split("@")[0]
        avatar_url = ""
        try:
            oauth2_service = build("oauth2", "v2", credentials=creds)
            user_info = oauth2_service.userinfo().get().execute()
            display_name = user_info.get("name") or display_name
            avatar_url = user_info.get("picture") or ""
        except Exception:
            pass

        account_id = f"acc_{email_address.lower()}"

        # Cache avatar locally if picture URL exists
        if avatar_url and avatar_url.startswith("http"):
            try:
                import urllib.request
                from app.config import AVATARS_DIR
                req = urllib.request.Request(avatar_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    img_data = resp.read()
                    if img_data:
                        ext = ".png" if img_data.startswith(b'\x89PNG') else ".jpg"
                        (AVATARS_DIR / f"{account_id}{ext}").write_bytes(img_data)
            except Exception:
                pass

        async with get_db() as db:
            await db.execute("""
                INSERT INTO accounts (
                    id, email, display_name, avatar_url, access_token, refresh_token,
                    token_expiry, history_id, sync_status, sync_message, account_type, provider
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', 'Google 官方授权已连接', 'gmail', 'gmail')
                ON CONFLICT(email) DO UPDATE SET
                    display_name = excluded.display_name,
                    avatar_url = excluded.avatar_url,
                    access_token = excluded.access_token,
                    refresh_token = COALESCE(excluded.refresh_token, accounts.refresh_token),
                    token_expiry = excluded.token_expiry,
                    history_id = excluded.history_id,
                    account_type = 'gmail',
                    provider = 'gmail',
                    sync_status = 'idle',
                    sync_message = 'Google 官方授权已连接'
            """, (
                account_id,
                email_address.lower(),
                display_name,
                avatar_url,
                creds.token,
                creds.refresh_token,
                creds.expiry.isoformat() if creds.expiry else None,
                history_id
            ))
            await db.commit()

        # Grant access to user if user_id is provided
        if user_id:
            try:
                async with get_db() as db:
                    await db.execute(
                        "INSERT OR IGNORE INTO user_account_permissions (user_id, account_id) VALUES (?, ?)",
                        (user_id, account_id)
                    )
                    await db.commit()
            except Exception:
                pass

        return {
            "id": account_id,
            "email": email_address.lower(),
            "display_name": display_name,
            "avatar_url": avatar_url
        }

    @classmethod
    async def get_valid_credentials(cls, account_id: str) -> Optional[Credentials]:
        async with get_db() as db:
            async with db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)) as cursor:
                row = await cursor.fetchone()
                if not row:
                    return None

        creds_data = dict(row)
        with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
            secret_data = json.load(f)
            client_type = "web" if "web" in secret_data else "installed"
            client_info = secret_data.get(client_type, {})

        creds = Credentials(
            token=creds_data["access_token"],
            refresh_token=creds_data["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_info.get("client_id"),
            client_secret=client_info.get("client_secret"),
            scopes=GMAIL_SCOPES
        )

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            # Update database with new token
            async with get_db() as db:
                await db.execute(
                    "UPDATE accounts SET access_token = ?, token_expiry = ? WHERE id = ?",
                    (creds.token, creds.expiry.isoformat() if creds.expiry else None, account_id)
                )
                await db.commit()

        return creds
