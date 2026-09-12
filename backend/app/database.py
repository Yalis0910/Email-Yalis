import sqlite3
import aiosqlite
from contextlib import asynccontextmanager
from app.config import DB_PATH

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expiry TEXT,
    history_id TEXT,
    sync_status TEXT DEFAULT 'idle', -- idle, syncing, completed, error
    sync_progress_current INTEGER DEFAULT 0,
    sync_progress_total INTEGER DEFAULT 0,
    sync_message TEXT DEFAULT '',
    total_synced INTEGER DEFAULT 0,
    last_synced_at TEXT,
    account_type TEXT DEFAULT 'gmail_oauth', -- gmail_oauth, imap
    provider TEXT DEFAULT 'gmail', -- gmail, qq, 163, outlook, custom
    imap_host TEXT,
    imap_port INTEGER DEFAULT 993,
    use_ssl INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    thread_id TEXT,
    subject TEXT,
    from_name TEXT,
    from_email TEXT,
    to_emails TEXT,
    cc_emails TEXT,
    date_timestamp INTEGER,
    date_str TEXT,
    snippet TEXT,
    body_text TEXT,
    body_html TEXT,
    labels TEXT,
    has_attachments INTEGER DEFAULT 0,
    size_estimate INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_emails_account_date ON emails(account_id, date_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_email);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_emails_acc_from_nocase ON emails(account_id, from_email COLLATE NOCASE);

CREATE VIRTUAL TABLE IF NOT EXISTS email_fts USING fts5(
    id UNINDEXED,
    account_id UNINDEXED,
    subject,
    snippet,
    body_text,
    from_email,
    tokenize = 'unicode61'
);

-- Triggers for FTS5 sync (insert only; search queries JOIN with emails to filter deleted items)
CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
    INSERT INTO email_fts(id, account_id, subject, snippet, body_text, from_email)
    VALUES (new.id, new.account_id, new.subject, new.snippet, new.body_text, new.from_email);
END;

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    email_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT,
    category TEXT, -- document, invoice, spreadsheet, image, archive, code, other
    file_hash TEXT,
    storage_path TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_attachments_account ON attachments(account_id);
CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(file_hash);
CREATE INDEX IF NOT EXISTS idx_attachments_category ON attachments(category);

CREATE TABLE IF NOT EXISTS digital_assets (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    platform_name TEXT NOT NULL,
    domain TEXT,
    category TEXT, -- dev_ops, productivity, finance, entertainment, social, ecommerce, ai_tools, other
    registered_email TEXT,
    first_detected_at TEXT,
    last_activity_at TEXT,
    source_email_id TEXT,
    confidence_score REAL DEFAULT 1.0,
    metadata_json TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assets_account ON digital_assets(account_id);
CREATE INDEX IF NOT EXISTS idx_assets_platform ON digital_assets(platform_name);

CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    service_name TEXT NOT NULL,
    currency TEXT DEFAULT 'USD',
    amount REAL DEFAULT 0.0,
    cycle TEXT DEFAULT 'monthly', -- monthly, yearly, one_time, unknown
    invoice_date TEXT,
    source_email_id TEXT,
    attachment_id TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id);

CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    domain TEXT,
    inbound_count INTEGER DEFAULT 0,
    outbound_count INTEGER DEFAULT 0,
    first_interaction TEXT,
    last_interaction TEXT,
    weight REAL DEFAULT 0.0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(account_id, email),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_weight ON contacts(weight DESC);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS email_ai_insights (
    email_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    summary TEXT,
    action_items TEXT,
    key_entities TEXT,
    reply_draft TEXT,
    model_name TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_account ON email_ai_insights(account_id);

CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    user_id TEXT DEFAULT 'admin',
    contact_id TEXT,
    context_summary TEXT,
    compressed_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    thinking_content TEXT,
    thinking_duration INTEGER DEFAULT 0,
    references_json TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id);

CREATE TABLE IF NOT EXISTS contact_ai_reports (
    contact_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_name TEXT,
    report_markdown TEXT NOT NULL,
    summary_tags TEXT,
    model_name TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contact_reports_account ON contact_ai_reports(account_id);
CREATE INDEX IF NOT EXISTS idx_contact_reports_updated ON contact_ai_reports(updated_at DESC);

-- RBAC Tables
CREATE TABLE IF NOT EXISTS user_groups (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    page_permissions_json TEXT NOT NULL DEFAULT '[]',
    action_permissions_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT,
    group_id TEXT,
    is_superadmin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(group_id) REFERENCES user_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS group_account_permissions (
    group_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (group_id, account_id),
    FOREIGN KEY(group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_account_permissions (
    user_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (user_id, account_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
"""

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA busy_timeout = 30000;")
        conn.executescript(SCHEMA_SQL)

        # Migration: Ensure accounts table has generic IMAP columns
        cur = conn.execute("PRAGMA table_info(accounts)")
        existing_cols = {row[1] for row in cur.fetchall()}
        if "account_type" not in existing_cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN account_type TEXT DEFAULT 'gmail_oauth'")
        if "provider" not in existing_cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN provider TEXT DEFAULT 'gmail'")
        if "imap_host" not in existing_cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN imap_host TEXT")
        if "imap_port" not in existing_cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN imap_port INTEGER DEFAULT 993")
        if "use_ssl" not in existing_cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN use_ssl INTEGER DEFAULT 1")

        # Drop legacy slow FTS triggers that cause full-table-scan hangs on email deletion
        conn.execute("DROP TRIGGER IF EXISTS emails_ad")
        conn.execute("DROP TRIGGER IF EXISTS emails_au")

        # Migration: Ensure ai_messages has thinking columns
        cur_msg = conn.execute("PRAGMA table_info(ai_messages)")
        msg_cols = {row[1] for row in cur_msg.fetchall()}
        if "thinking_content" not in msg_cols:
            conn.execute("ALTER TABLE ai_messages ADD COLUMN thinking_content TEXT")
        if "thinking_duration" not in msg_cols:
            conn.execute("ALTER TABLE ai_messages ADD COLUMN thinking_duration INTEGER DEFAULT 0")

        # Migration: Ensure ai_conversations has user_id and contact_id columns
        cur_conv = conn.execute("PRAGMA table_info(ai_conversations)")
        conv_cols = {row[1] for row in cur_conv.fetchall()}
        if "user_id" not in conv_cols:
            conn.execute("ALTER TABLE ai_conversations ADD COLUMN user_id TEXT DEFAULT 'admin'")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id);")
        if "contact_id" not in conv_cols:
            conn.execute("ALTER TABLE ai_conversations ADD COLUMN contact_id TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_conversations_contact ON ai_conversations(contact_id);")
        if "context_summary" not in conv_cols:
            conn.execute("ALTER TABLE ai_conversations ADD COLUMN context_summary TEXT")
        if "compressed_at" not in conv_cols:
            conn.execute("ALTER TABLE ai_conversations ADD COLUMN compressed_at TEXT")

        # Migration: Ensure fast contact email lookup index
        conn.execute("CREATE INDEX IF NOT EXISTS idx_emails_acc_from_nocase ON emails(account_id, from_email COLLATE NOCASE);")

        # Ensure default auto-sync settings in system_settings
        conn.execute("""
            INSERT OR IGNORE INTO system_settings (key, value, updated_at)
            VALUES ('auto_sync_enabled', 'false', datetime('now', 'localtime'))
        """)
        conn.execute("""
            INSERT OR IGNORE INTO system_settings (key, value, updated_at)
            VALUES ('auto_sync_interval_minutes', '30', datetime('now', 'localtime'))
        """)

        # Initialize default superadmin & migrate conversations
        from app.services.auth_service import AuthService
        AuthService.init_superadmin_sync(conn)

        conn.commit()
    finally:
        conn.close()

@asynccontextmanager
async def get_db():
    async with aiosqlite.connect(DB_PATH, timeout=30.0) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON;")
        await db.execute("PRAGMA busy_timeout = 30000;")
        yield db
