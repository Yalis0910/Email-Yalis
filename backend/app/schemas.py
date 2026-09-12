from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class AccountOut(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    sync_status: str
    sync_progress_current: int = 0
    sync_progress_total: int = 0
    sync_message: Optional[str] = ""
    total_synced: int = 0
    last_synced_at: Optional[str] = None
    account_type: Optional[str] = "gmail_oauth"
    provider: Optional[str] = "gmail"
    imap_host: Optional[str] = None
    imap_port: Optional[int] = 993
    use_ssl: Optional[int] = 1
    created_at: Optional[str] = None

class GenericImapConnectRequest(BaseModel):
    email: str
    password: str
    provider: Optional[str] = "custom"
    imap_host: str
    imap_port: int = 993
    use_ssl: bool = True

class AutoSyncSettingsResponse(BaseModel):
    auto_sync_enabled: bool = False
    auto_sync_interval_minutes: int = 30
    auto_sync_last_run: Optional[str] = None
    is_running: bool = False

class AutoSyncSettingsUpdate(BaseModel):
    auto_sync_enabled: bool
    auto_sync_interval_minutes: int

class SyncTriggerRequest(BaseModel):
    account_id: str
    full_sync: bool = False
    force: bool = False
    query: Optional[str] = None
    max_results: Optional[int] = None

class EmailListItem(BaseModel):
    id: str
    account_id: str
    thread_id: Optional[str] = None
    subject: Optional[str] = None
    from_name: Optional[str] = None
    from_email: Optional[str] = None
    to_emails: Optional[str] = None
    date_timestamp: Optional[int] = None
    date_str: Optional[str] = None
    snippet: Optional[str] = None
    labels: Optional[str] = None
    has_attachments: int = 0
    size_estimate: int = 0

class AttachmentItem(BaseModel):
    id: str
    email_id: str
    account_id: str
    filename: str
    file_size: int
    mime_type: Optional[str] = None
    category: Optional[str] = "other"
    file_hash: Optional[str] = None
    created_at: Optional[str] = None

class EmailDetail(EmailListItem):
    cc_emails: Optional[str] = None
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    attachments: List[AttachmentItem] = []

class DigitalAssetItem(BaseModel):
    id: str
    account_id: str
    platform_name: str
    domain: Optional[str] = None
    category: str
    registered_email: Optional[str] = None
    first_detected_at: Optional[str] = None
    last_activity_at: Optional[str] = None
    source_email_id: Optional[str] = None
    confidence_score: float = 1.0
    metadata_json: Optional[str] = None

class SubscriptionItem(BaseModel):
    id: str
    account_id: str
    service_name: str
    currency: str = "USD"
    amount: float = 0.0
    cycle: str = "monthly"
    invoice_date: Optional[str] = None
    source_email_id: Optional[str] = None
    attachment_id: Optional[str] = None

class ContactItem(BaseModel):
    id: str
    account_id: str
    email: str
    name: Optional[str] = None
    domain: Optional[str] = None
    inbound_count: int = 0
    outbound_count: int = 0
    first_interaction: Optional[str] = None
    last_interaction: Optional[str] = None
    weight: float = 0.0

class CategoryCount(BaseModel):
    category: str
    label: str
    count: int

class TimelineCount(BaseModel):
    date: str
    count: int

class DashboardOverview(BaseModel):
    total_emails: int = 0
    total_accounts: int = 0
    total_digital_assets: int = 0
    total_attachments: int = 0
    total_attachment_size_bytes: int = 0
    estimated_monthly_expense_usd: float = 0.0
    category_distribution: List[Dict[str, Any]] = []
    activity_timeline: List[Dict[str, Any]] = []
    recent_assets: List[DigitalAssetItem] = []
    top_contacts: List[ContactItem] = []
