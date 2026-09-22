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
CREATE INDEX IF NOT EXISTS idx_emails_acc_att_date ON emails(account_id, has_attachments, date_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_emails_thread_date ON emails(thread_id, date_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_acc_created ON attachments(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_acc_activity ON digital_assets(account_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_acc_date ON subscriptions(account_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_created ON ai_messages(conversation_id, created_at ASC);

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
    tier TEXT DEFAULT 'D', -- A (重点战略), B (培育增长), C (广泛孵化), D (其它)
    tier_reason TEXT,
    tier_locked INTEGER DEFAULT 0, -- 0: AI可自动评估, 1: 业务员锁定
    deal_stage TEXT DEFAULT 'lead', -- lead, inquiry, sample, quote, won, lost, stale
    estimated_value REAL DEFAULT 0.0,
    last_follow_up_at TEXT,
    next_follow_up_due TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(account_id, email),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_weight ON contacts(weight DESC);

CREATE TABLE IF NOT EXISTS sales_playbook (
    id TEXT PRIMARY KEY,
    scenario_type TEXT NOT NULL, -- objection_price, objection_terms, objection_delivery, objection_competitor, follow_up_stale, win_reasons, custom
    title TEXT NOT NULL,
    trigger_pattern TEXT, -- 关键词或匹配模式
    response_strategy TEXT NOT NULL, -- 应对策略与核心要点
    reply_template TEXT NOT NULL, -- 中英文或实战回复模板
    source_contact_id TEXT, -- 若是从成单/丢单案例中沉淀，关联来源
    is_system_preset INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_playbook_type ON sales_playbook(scenario_type);

CREATE TABLE IF NOT EXISTS deal_reviews (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    deal_status TEXT NOT NULL, -- won, lost
    deal_amount REAL DEFAULT 0.0,
    currency TEXT DEFAULT 'USD',
    core_reasons TEXT NOT NULL, -- 归因分析要点 (Markdown/JSON)
    key_timeline TEXT, -- 邮件全链条里程碑
    lessons_learned TEXT, -- 教训与复盘经验
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deal_reviews_contact ON deal_reviews(contact_id);
CREATE INDEX IF NOT EXISTS idx_deal_reviews_status ON deal_reviews(deal_status);

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
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA cache_size = -64000;")
        conn.execute("PRAGMA temp_store = MEMORY;")
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

        # Migration: Ensure fast contact email lookup index & high-performance composite indexes
        conn.execute("CREATE INDEX IF NOT EXISTS idx_emails_acc_from_nocase ON emails(account_id, from_email COLLATE NOCASE);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_emails_acc_att_date ON emails(account_id, has_attachments, date_timestamp DESC);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_emails_thread_date ON emails(thread_id, date_timestamp DESC);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_attachments_acc_created ON attachments(account_id, created_at DESC);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_acc_activity ON digital_assets(account_id, last_activity_at DESC);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_subscriptions_acc_date ON subscriptions(account_id, invoice_date DESC);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_created ON ai_messages(conversation_id, created_at ASC);")

        # Migration: Ensure contacts table has CRM & tiering columns
        cur_ct = conn.execute("PRAGMA table_info(contacts)")
        ct_cols = {row[1] for row in cur_ct.fetchall()}
        if "tier" not in ct_cols:
            conn.execute("ALTER TABLE contacts ADD COLUMN tier TEXT DEFAULT 'D'")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_contacts_tier ON contacts(tier);")
        if "tier_reason" not in ct_cols:
            conn.execute("ALTER TABLE contacts ADD COLUMN tier_reason TEXT")
        if "tier_locked" not in ct_cols:
            conn.execute("ALTER TABLE contacts ADD COLUMN tier_locked INTEGER DEFAULT 0")
        if "deal_stage" not in ct_cols:
            conn.execute("ALTER TABLE contacts ADD COLUMN deal_stage TEXT DEFAULT 'lead'")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(deal_stage);")
        if "estimated_value" not in ct_cols:
            conn.execute("ALTER TABLE contacts ADD COLUMN estimated_value REAL DEFAULT 0.0")
        if "last_follow_up_at" not in ct_cols:
            conn.execute("ALTER TABLE contacts ADD COLUMN last_follow_up_at TEXT")
        if "next_follow_up_due" not in ct_cols:
            conn.execute("ALTER TABLE contacts ADD COLUMN next_follow_up_due TEXT")

        # Seed sales_playbook presets if table is empty
        cur_pb = conn.execute("SELECT COUNT(*) FROM sales_playbook")
        if cur_pb.fetchone()[0] == 0:
            default_playbooks = [
                (
                    "pb_price_too_high",
                    "objection_price",
                    "客户提出价格过高 (Price Too High / 议价破解)",
                    "贵,太贵,价格高,price is too high,expensive,discount,over budget,cheaper,lower price,can you reduce",
                    "肯定对方对成本效益的重视，拆解全生命周期成本（TCO）、原材料/品控认证与低售后率优势，提供阶梯采购量折扣或方案选配调整，切忌单方面无条件降价。",
                    "Dear [Client Name],\n\nThank you for your candid feedback regarding our quotation.\n\nWe fully understand that cost efficiency is paramount for your business. Our pricing reflects [Key Quality Value: e.g., Grade-A raw materials / strict ISO & CE compliance / 100% pre-shipment inspection], which protects your brand reputation and drastically reduces end-user RMA and defect rates.\n\nTo better accommodate your current procurement budget without compromising performance, we would like to propose two viable options:\n1. Tiered Volume Discount: If the trial volume can be scaled to [Target Quantity], we can offer a [X%] discount per unit.\n2. Specification Optimization: We can customize the packaging/accessory configuration to achieve your target landing cost.\n\nWould you be open to a brief follow-up call this Thursday to determine which approach works best for you?\n\nBest regards,\n[Your Name]",
                    None,
                    1
                ),
                (
                    "pb_payment_terms",
                    "payment_terms",
                    "付款条件与账期争议 (Payment Terms & Credit / 账期协商)",
                    "payment terms,OA,net 30,net 60,deposit,L/C,cash against documents,账期,首付比例,信用证",
                    "新客户首单坚持风控底线（30%定金+70%提单副本或即期信用证），明确承诺在建立1-2次良好履约记录后，可由中信保(Sinosure)授信开通OA 30/60天更优账期。",
                    "Dear [Client Name],\n\nThank you for reaching out regarding the commercial terms.\n\nAs this marks our first direct collaboration, our corporate finance compliance standardly requires [30% deposit upon order confirmation and 70% against the Bill of Lading copy / Irrevocable L/C at sight]. This enables us to lock in raw material prices and reserve priority production scheduling immediately.\n\nWe deeply value building a lasting strategic partnership with [Company Name]. Once we successfully conclude this initial trial batch and establish an insured credit record through Sinosure, we will be glad to offer extended payment terms (such as OA 30 or 60 days) on your recurring purchase orders.\n\nCould we proceed with the current standard terms for this maiden shipment to ensure your delivery timeline is met?\n\nBest regards,\n[Your Name]",
                    None,
                    1
                ),
                (
                    "pb_delivery_urgent",
                    "delivery_leadtime",
                    "交期紧迫与排产保障 (Urgent Delivery / 交期催促)",
                    "lead time,urgent,delivery date,ship immediately,rush order,交期,赶货,什么时候发货,延迟",
                    "给出确凿排产里程碑与生产透明度承诺，提出分批出运（Partial Shipment）以先满足紧急上架或展会需求，剩余批次海运跟进。",
                    "Dear [Client Name],\n\nWe completely understand the critical importance of meeting your market deadline for this project.\n\nOur production engineering division has reviewed our workshop schedule: our standard lead time is [X weeks], but to support your launch, we can activate our fast-track green channel:\n1. First Priority Dispatch: We can expedite an initial batch of [Quantity] units via fast-line air/express freight by [Specific Date] to satisfy your immediate demand.\n2. Main Balance: The remaining balance will ship by sea on [Date].\n\nWe will also send weekly milestone photos directly from the assembly line. Kindly confirm the PI today so we can allocate raw materials and lock your production slot.\n\nBest regards,\n[Your Name]",
                    None,
                    1
                ),
                (
                    "pb_competitor_quote",
                    "competitor",
                    "遭遇竞品低价拦截 (Competitor Lower Price / 竞品应对)",
                    "other supplier,competitor,better offer,cheaper elsewhere,another vendor,别的供应商,别家报价更低,同行便宜",
                    "尊重竞品存在，不进行人身攻击；从核心技术公差、用料厚度、认证标准、售后支持及供货稳定性等方面引导客户关注隐形成本，并主动提议提供比对样品。",
                    "Dear [Client Name],\n\nThank you for sharing the market feedback. We fully respect that there are varying options across the supply chain.\n\nWhen evaluating competitive offerings, subtle variations in raw material grades [e.g., steel thickness / PCB layers / electrical safety standards / tolerance] often yield lower upfront pricing, but may trigger hidden failure risks, assembly delays, or field returns.\n\nTo ensure an objective apples-to-apples evaluation, could you share the key technical parameters of the competing quote? Alternatively, we would be delighted to courier a physical sample unit to your engineering team for direct stress and performance testing.\n\nOur focus is always on delivering total long-term reliability and safeguarding your brand's market standing.\n\nBest regards,\n[Your Name]",
                    None,
                    1
                ),
                (
                    "pb_stale_reactivation",
                    "reactivation",
                    "沉睡与断联客户激活 (Stale Lead Reactivation / 破冰促单)",
                    "stale,haven't heard,checking in,any update,follow up,长期未回复,跟进询盘,断联",
                    "避免空洞的'Just checking in'，以原材料调价窗口预警、新品选型样册或空余海运舱位/产线空档为切入点，提供明确价值。",
                    "Dear [Client Name],\n\nHope this message finds you well.\n\nI am writing to share a brief operational update regarding your previous inquiry on [Product/Project Name]: due to impending raw material cost adjustments and seasonal freight spikes, our quoted pricing is secured until [Expiry Date]. Furthermore, we have reserved a high-efficiency production window for next month's dispatch.\n\nHave there been any updates on your project timeline, or would you like us to adjust any specifications or delivery terms to better suit your schedule?\n\nPlease let me know if we can assist you with any updated specs or testing samples.\n\nBest regards,\n[Your Name]",
                    None,
                    1
                ),
                (
                    "pb_closing_deal",
                    "closing",
                    "促成签单与合同确认 (Deal Closing / 下单与PI确认)",
                    "place order,send invoice,confirm order,sign contract,ready to order,下单,形式发票,签合同,打款",
                    "立即输出清晰规范的 Proforma Invoice (PI) 或合同，明确收款银行防伪说明、交期排产表及质量承诺，消除最后顾虑。",
                    "Dear [Client Name],\n\nThank you very much for your trust and decision to partner with us! We are thrilled to confirm your order for [Product Name].\n\nAttached please find our official Proforma Invoice (PI #[PI Number]) with complete order specifications, delivery terms, and official banking coordinates.\n\n[Security Notice: Please note our banking information will NEVER change via unverified emails. Please confirm with our official stamp before initiating wire transfers.]\n\nKindly countersign the PI and share the bank swift copy once the deposit is remitted, and our factory manager will immediately initiate the production schedule.\n\nBest regards,\n[Your Name]",
                    None,
                    1
                )
            ]
            conn.executemany("""
                INSERT INTO sales_playbook (id, scenario_type, title, trigger_pattern, response_strategy, reply_template, source_contact_id, is_system_preset, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
            """, default_playbooks)
        else:
            # Migrate legacy scenario types to clean unified names
            conn.execute("UPDATE sales_playbook SET scenario_type = 'payment_terms' WHERE scenario_type = 'objection_terms'")
            conn.execute("UPDATE sales_playbook SET scenario_type = 'delivery_leadtime' WHERE scenario_type = 'objection_delivery'")
            conn.execute("UPDATE sales_playbook SET scenario_type = 'competitor' WHERE scenario_type = 'objection_competitor'")
            conn.execute("UPDATE sales_playbook SET scenario_type = 'reactivation' WHERE scenario_type = 'follow_up_stale'")
            conn.execute("UPDATE sales_playbook SET scenario_type = 'closing' WHERE scenario_type = 'win_reasons'")

        # Ensure new foreign trade presets exist
        conn.execute("""
            INSERT OR IGNORE INTO sales_playbook (id, scenario_type, title, trigger_pattern, response_strategy, reply_template, source_contact_id, is_system_preset, created_at, updated_at)
            VALUES (
                'pb_cold_outreach',
                'cold_outreach',
                '精准外贸破冰开发信 (Cold Outreach / 价值切入)',
                'cold email,introduce,new supplier,catalog,sourcing,合作,新供应商,产品目录',
                '避免空洞群发式自我介绍，直接从对方所在行业痛点、对标竞品热销型号、专利认证或本地化仓储服务切入，并提出极低认知门槛的行动号召（CTA，如免费打样或索取PDF图册）。',
                'Dear [Client Name],\n\nHope this email finds you well.\n\nI noticed that [Company Name] has been expanding its presence in [Target Market/Product Category]. Given your focus on quality and supply reliability, I am reaching out to share a quick update on how we help similar distributors achieve [Key Metric: e.g., 15% lower landed costs / zero-defect batch delivery].\n\nWe specialize in [Core Product Line] with full [Certifications: ISO/CE/UL] compliance, serving top-tier partners across North America and Europe. We recently launched an upgraded specification tailored specifically for [Client''s Customer Segment].\n\nWould you be open to reviewing our latest 2-page product catalog, or may we send a free sample unit for your engineering team to benchmark?\n\nBest regards,\n[Your Name]',
                NULL, 1, datetime('now', 'localtime'), datetime('now', 'localtime')
            )
        """)
        conn.execute("""
            INSERT OR IGNORE INTO sales_playbook (id, scenario_type, title, trigger_pattern, response_strategy, reply_template, source_contact_id, is_system_preset, created_at, updated_at)
            VALUES (
                'pb_after_sales',
                'after_sales',
                '客诉索赔与货损妥善化解 (After-Sales / 索赔与质量抗辩)',
                'defect,damaged,broken,claim,compensation,bad quality,return,refund,质量问题,损坏,破损,索赔,退货',
                '第一时间真诚共情并启动48小时客诉快反通道；要求提供清晰箱号、批次号与破损视频留证；在锁定事实前不推诿，提出快速补发、备件随下单抵扣或第三方公证方案，转危为机巩固长远信任。',
                'Dear [Client Name],\n\nThank you for bringing this issue to our immediate attention. We take product quality and your operational success with the utmost seriousness.\n\nOur QA and engineering departments have opened an urgent investigation ticket [Ticket #[Ticket Number]] on this batch. To ensure we identify the root cause and provide an equitable resolution within 24 hours, could you kindly help confirm:\n1. The Lot/Batch number printed on the master cartons.\n2. Photos or a short clip showing the defective/damaged units and the outer packaging condition.\n\nIf transport damage or component defect is verified, we stand fully behind our warranty and will arrange [immediate express replacement dispatch / credit memo deduction on your next invoice].\n\nWe sincerely apologize for the inconvenience caused and appreciate your continued partnership as we resolve this swiftly.\n\nBest regards,\n[Your Name]',
                NULL, 1, datetime('now', 'localtime'), datetime('now', 'localtime')
            )
        """)

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
        await db.execute("PRAGMA synchronous = NORMAL;")
        await db.execute("PRAGMA cache_size = -64000;")
        await db.execute("PRAGMA temp_store = MEMORY;")
        yield db
