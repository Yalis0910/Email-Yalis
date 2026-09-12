import re
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime

# Known Platform Registry: {domain_keyword: (Platform Name, Category)}
KNOWN_PLATFORMS = {
    # AI & Machine Learning
    "openai.com": ("OpenAI", "ai_tools"),
    "anthropic.com": ("Anthropic", "ai_tools"),
    "claude.ai": ("Claude", "ai_tools"),
    "midjourney.com": ("Midjourney", "ai_tools"),
    "perplexity.ai": ("Perplexity", "ai_tools"),
    "deepseek.com": ("DeepSeek", "ai_tools"),
    "elevenlabs.io": ("ElevenLabs", "ai_tools"),
    "huggingface.co": ("Hugging Face", "ai_tools"),
    "groq.com": ("Groq", "ai_tools"),
    "poe.com": ("Poe", "ai_tools"),
    "cursor.com": ("Cursor", "ai_tools"),
    "cursor.sh": ("Cursor", "ai_tools"),

    # Dev & Infrastructure
    "github.com": ("GitHub", "dev_ops"),
    "gitlab.com": ("GitLab", "dev_ops"),
    "cloudflare.com": ("Cloudflare", "dev_ops"),
    "vercel.com": ("Vercel", "dev_ops"),
    "netlify.com": ("Netlify", "dev_ops"),
    "supabase.com": ("Supabase", "dev_ops"),
    "docker.com": ("Docker", "dev_ops"),
    "digitalocean.com": ("DigitalOcean", "dev_ops"),
    "amazonaws.com": ("AWS", "dev_ops"),
    "aws.amazon.com": ("AWS", "dev_ops"),
    "googlecloud": ("Google Cloud", "dev_ops"),
    "heroku.com": ("Heroku", "dev_ops"),
    "sentry.io": ("Sentry", "dev_ops"),
    "datadoghq.com": ("Datadog", "dev_ops"),
    "jetbrains.com": ("JetBrains", "dev_ops"),
    "postman.com": ("Postman", "dev_ops"),
    "npmjs.com": ("npm", "dev_ops"),
    "pypi.org": ("PyPI", "dev_ops"),
    "replit.com": ("Replit", "dev_ops"),
    "render.com": ("Render", "dev_ops"),
    "fly.io": ("Fly.io", "dev_ops"),
    "railway.app": ("Railway", "dev_ops"),

    # Productivity & Collaboration
    "notion.so": ("Notion", "productivity"),
    "slack.com": ("Slack", "productivity"),
    "discord.com": ("Discord", "productivity"),
    "linear.app": ("Linear", "productivity"),
    "atlassian.com": ("Atlassian (Jira/Confluence)", "productivity"),
    "trello.com": ("Trello", "productivity"),
    "asana.com": ("Asana", "productivity"),
    "figma.com": ("Figma", "productivity"),
    "miro.com": ("Miro", "productivity"),
    "canva.com": ("Canva", "productivity"),
    "zoom.us": ("Zoom", "productivity"),
    "loom.com": ("Loom", "productivity"),
    "calendly.com": ("Calendly", "productivity"),
    "airtable.com": ("Airtable", "productivity"),
    "clickup.com": ("ClickUp", "productivity"),

    # Finance & Payment
    "stripe.com": ("Stripe", "finance"),
    "paypal.com": ("PayPal", "finance"),
    "wise.com": ("Wise", "finance"),
    "lemonsqueezy.com": ("Lemon Squeezy", "finance"),
    "paddle.com": ("Paddle", "finance"),
    "square.com": ("Square", "finance"),
    "squareup.com": ("Square", "finance"),
    "revolut.com": ("Revolut", "finance"),
    "alipay.com": ("Alipay (支付宝)", "finance"),
    "wechat.com": ("WeChat Pay", "finance"),
    "apple.com": ("Apple", "finance"),
    "binance.com": ("Binance", "finance"),
    "coinbase.com": ("Coinbase", "finance"),
    "okx.com": ("OKX", "finance"),

    # E-Commerce & Media
    "amazon.com": ("Amazon", "ecommerce"),
    "shopify.com": ("Shopify", "ecommerce"),
    "steamcommunity.com": ("Steam", "entertainment"),
    "steampowered.com": ("Steam", "entertainment"),
    "epicgames.com": ("Epic Games", "entertainment"),
    "playstation.com": ("PlayStation", "entertainment"),
    "nintendo.com": ("Nintendo", "entertainment"),
    "netflix.com": ("Netflix", "entertainment"),
    "spotify.com": ("Spotify", "entertainment"),
    "youtube.com": ("YouTube", "entertainment"),

    # Social & Community
    "twitter.com": ("X (Twitter)", "social"),
    "x.com": ("X (Twitter)", "social"),
    "linkedin.com": ("LinkedIn", "social"),
    "reddit.com": ("Reddit", "social"),
    "telegram.org": ("Telegram", "social"),
    "substack.com": ("Substack", "social"),
    "medium.com": ("Medium", "social"),
}

WELCOME_KEYWORDS = [
    "welcome to", "welcome aboard", "confirm your account", "verify your email",
    "activate your account", "your account is ready", "thanks for signing up",
    "get started with", "registration confirmed", "account created",
    "欢迎加入", "验证您的邮箱", "激活您的账户", "注册成功", "开启您的", "欢迎使用"
]

BILLING_KEYWORDS = [
    "receipt", "invoice", "payment receipt", "payment confirmed", "billing statement",
    "your order", "subscription confirmed", "subscription renewed", "payment successful",
    "charged", "renewal notice", "tax invoice", "发票", "电子发票", "收据", "账单",
    "付款凭证", "支付成功", "订阅确认", "扣费提醒", "续费通知"
]

# Regex for currency & amount
AMOUNT_REGEX = re.compile(r'(?:[\$￥€£]|USD|EUR|GBP|CNY|RMB)\s*([0-9]+(?:\.[0-9]{2})?)', re.IGNORECASE)
CYCLE_MONTH_REGEX = re.compile(r'(monthly|per month|\/mo|/month|按月|每月)', re.IGNORECASE)
CYCLE_YEAR_REGEX = re.compile(r'(annually|yearly|per year|\/yr|/year|按年|每年)', re.IGNORECASE)

class AssetExtractor:
    @staticmethod
    def extract_domain(email_address: str) -> str:
        if not email_address or "@" not in email_address:
            return ""
        return email_address.strip().split("@")[-1].lower()

    @classmethod
    def identify_platform(cls, from_email: str, from_name: str, subject: str) -> Optional[Tuple[str, str, str, float]]:
        """
        Returns (platform_name, domain, category, confidence_score) or None
        """
        domain = cls.extract_domain(from_email)
        subject_lower = subject.lower() if subject else ""
        from_name_lower = from_name.lower() if from_name else ""

        # 1. Match against known platforms
        for known_domain, (p_name, category) in KNOWN_PLATFORMS.items():
            if known_domain in domain:
                confidence = 1.0
                return p_name, domain, category, confidence

        # 2. Check for registration / welcome emails from other domains
        is_welcome = any(kw in subject_lower for kw in WELCOME_KEYWORDS)
        if is_welcome and domain and domain not in ["gmail.com", "qq.com", "163.com", "outlook.com", "hotmail.com", "yahoo.com"]:
            # Auto deduce platform name from domain
            parts = domain.split(".")
            name_part = parts[0].capitalize() if len(parts) >= 2 else domain
            if from_name and len(from_name) < 30 and not "@" in from_name:
                name_part = from_name.strip()
            return name_part, domain, "other", 0.85

        return None

    @classmethod
    def detect_subscription_bill(cls, from_email: str, from_name: str, subject: str, snippet: str, body_text: str) -> Optional[Dict[str, Any]]:
        """
        Detects if email is a bill/invoice/subscription receipt and extracts amount & currency
        """
        content_to_scan = f"{subject} {snippet} {body_text[:2000]}".lower()
        is_bill = any(kw in content_to_scan for kw in BILLING_KEYWORDS)
        if not is_bill:
            return None

        # Determine service name
        platform_info = cls.identify_platform(from_email, from_name, subject)
        service_name = platform_info[0] if platform_info else (from_name or cls.extract_domain(from_email))

        # Extract amount
        match = AMOUNT_REGEX.search(content_to_scan)
        amount = 0.0
        currency = "USD"
        if match:
            try:
                amount = float(match.group(1))
            except ValueError:
                amount = 0.0
        if "￥" in content_to_scan or "cny" in content_to_scan or "rmb" in content_to_scan:
            currency = "CNY"
        elif "€" in content_to_scan or "eur" in content_to_scan:
            currency = "EUR"
        elif "£" in content_to_scan or "gbp" in content_to_scan:
            currency = "GBP"

        # Detect cycle
        cycle = "one_time"
        if CYCLE_MONTH_REGEX.search(content_to_scan):
            cycle = "monthly"
        elif CYCLE_YEAR_REGEX.search(content_to_scan):
            cycle = "yearly"

        return {
            "service_name": service_name,
            "currency": currency,
            "amount": amount,
            "cycle": cycle
        }

    @staticmethod
    def classify_attachment(filename: str, mime_type: str = "") -> str:
        """
        Classifies file into: invoice, document, spreadsheet, image, archive, code, other
        """
        fn_lower = filename.lower()
        # Check if invoice
        if any(kw in fn_lower for kw in ["invoice", "receipt", "bill", "发票", "账单", "receipt_"]):
            return "invoice"

        if fn_lower.endswith(('.pdf', '.doc', '.docx', '.rtf', '.txt', '.md', '.odt')):
            return "document"
        if fn_lower.endswith(('.xls', '.xlsx', '.csv', '.tsv', '.ods')):
            return "spreadsheet"
        if fn_lower.endswith(('.ppt', '.pptx', '.key')):
            return "presentation"
        if fn_lower.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico')):
            return "image"
        if fn_lower.endswith(('.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2')):
            return "archive"
        if fn_lower.endswith(('.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.sql', '.java', '.go', '.rs', '.cpp', '.c', '.sh')):
            return "code"
        return "other"
