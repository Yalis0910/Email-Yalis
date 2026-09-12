import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
ATTACHMENTS_DIR = DATA_DIR / "attachments"
DB_PATH = DATA_DIR / "email_assets.db"
CREDENTIALS_FILE = DATA_DIR / "credentials.json"

# Ensure runtime directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)

# Gmail OAuth Scopes (Read-only for security)
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "openid"
]

SERVER_HOST = os.environ.get("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.environ.get("SERVER_PORT", "8008"))
BACKEND_URL = os.environ.get("BACKEND_URL", f"http://localhost:{SERVER_PORT}")
OAUTH_REDIRECT_URI = os.environ.get("OAUTH_REDIRECT_URI", f"{BACKEND_URL}/api/auth/callback")

