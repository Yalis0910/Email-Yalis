import time
import hashlib
from datetime import datetime, timedelta
from app.database import get_db

DEMO_ACCOUNT = {
    "id": "acc_demo_user",
    "email": "demo.architect@gmail.com",
    "display_name": "Demo Alex",
    "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=Alex",
    "sync_status": "completed",
    "sync_progress_current": 48,
    "sync_progress_total": 48,
    "sync_message": "演示数据加载完毕",
    "total_synced": 48,
    "last_synced_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
}

DEMO_PLATFORMS = [
    ("GitHub", "github.com", "dev_ops", "notifications@github.com", "GitHub Team", "Welcome to GitHub! Your developer journey begins here.", 1.0),
    ("OpenAI", "openai.com", "ai_tools", "support@openai.com", "OpenAI", "Your OpenAI ChatGPT Plus subscription invoice #INV-2024-9182", 1.0),
    ("AWS", "amazonaws.com", "dev_ops", "no-reply-aws@amazon.com", "Amazon Web Services", "Amazon Web Services Invoice [Account: 8829-1920-3341]", 1.0),
    ("Claude", "claude.ai", "ai_tools", "billing@anthropic.com", "Anthropic Claude", "Claude Pro Monthly Membership Receipt - $20.00", 1.0),
    ("Notion", "notion.so", "productivity", "mail@notion.so", "Notion", "Welcome to Notion! Let's get your workspace set up", 1.0),
    ("Figma", "figma.com", "productivity", "no-reply@figma.com", "Figma", "Design system updates and your Figma Professional receipt", 1.0),
    ("Stripe", "stripe.com", "finance", "receipts@stripe.com", "Stripe Receipts", "Receipt for Payment to Vercel Inc. ($20.00 USD)", 1.0),
    ("Cloudflare", "cloudflare.com", "dev_ops", "billing@cloudflare.com", "Cloudflare Billing", "Cloudflare Pro plan renewal notice and tax invoice", 1.0),
    ("Vercel", "vercel.com", "dev_ops", "notifications@vercel.com", "Vercel", "Your deployment is ready: email-yalis.vercel.app", 1.0),
    ("Slack", "slack.com", "productivity", "feedback@slack.com", "Slack", "Weekly workspace summary and team digest", 1.0),
    ("Linear", "linear.app", "productivity", "notifications@linear.app", "Linear", "New issue assigned to you: ARCH-102 Email Asset Engine", 1.0),
    ("Steam", "steampowered.com", "entertainment", "noreply@steampowered.com", "Steam Support", "Thank you for your Steam purchase! Total: $59.99", 1.0),
    ("Apple", "apple.com", "finance", "no_reply@email.apple.com", "Apple", "Your receipt from Apple for iCloud+ 2TB ($9.99/mo)", 1.0),
    ("Spotify", "spotify.com", "entertainment", "no-reply@spotify.com", "Spotify", "Spotify Premium Family monthly subscription receipt", 1.0),
    ("Google Cloud", "cloud.google.com", "dev_ops", "cloud-billing@google.com", "Google Cloud Billing", "Your Google Cloud Platform billing report for May", 1.0),
    ("Cursor", "cursor.com", "ai_tools", "team@cursor.com", "Cursor AI", "Welcome to Cursor Pro - The AI-first Code Editor", 1.0)
]

DEMO_SUBSCRIPTIONS = [
    ("OpenAI ChatGPT Plus", "USD", 20.0, "monthly", "2026-08-15"),
    ("Claude Pro (Anthropic)", "USD", 20.0, "monthly", "2026-08-20"),
    ("GitHub Copilot Business", "USD", 19.0, "monthly", "2026-08-01"),
    ("Cursor Pro AI Editor", "USD", 20.0, "monthly", "2026-08-05"),
    ("AWS Infrastructure Bill", "USD", 145.80, "monthly", "2026-08-03"),
    ("Cloudflare Pro Plan", "USD", 25.0, "monthly", "2026-08-12"),
    ("Figma Professional Seat", "USD", 15.0, "monthly", "2026-08-14"),
    ("Apple iCloud+ 2TB", "USD", 9.99, "monthly", "2026-08-28"),
    ("Notion Plus Team", "USD", 96.0, "yearly", "2026-06-10"),
    ("Google Cloud Workspace", "USD", 36.50, "monthly", "2026-08-25")
]

DEMO_ATTACHMENTS = [
    ("AWS_Invoice_Aug_2026.pdf", 245000, "application/pdf", "invoice"),
    ("OpenAI_Tax_Receipt_INV9182.pdf", 182000, "application/pdf", "invoice"),
    ("Email_Yalis_Architecture_Design.docx", 1450000, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"),
    ("Q3_Cloud_Expense_Budget.xlsx", 890000, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet"),
    ("System_Data_Flow_Diagram.png", 620000, "image/png", "image"),
    ("Anthropic_Claude_Subscription.pdf", 112000, "application/pdf", "invoice"),
    ("Contract_Service_Agreement_v2.pdf", 3200000, "application/pdf", "document"),
    ("Database_Export_Backup_2026.zip", 14200000, "application/zip", "archive"),
    ("API_Integration_Spec.pdf", 540000, "application/pdf", "document"),
    ("Product_Roadmap_2026.pptx", 4500000, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "presentation"),
    ("Vercel_Billing_Statement.pdf", 195000, "application/pdf", "invoice"),
    ("Figma_Design_Tokens_Source.json", 78000, "application/json", "code")
]

async def seed_demo_data():
    async with get_db() as db:
        # Check if already seeded
        async with db.execute("SELECT COUNT(*) FROM accounts WHERE id = ?", (DEMO_ACCOUNT["id"],)) as cur:
            row = await cur.fetchone()
            if row and row[0] > 0:
                return {"message": "演示数据已存在", "status": "exists"}

        # 1. Insert Account
        await db.execute("""
            INSERT OR REPLACE INTO accounts (
                id, email, display_name, avatar_url, sync_status,
                sync_progress_current, sync_progress_total, sync_message,
                total_synced, last_synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            DEMO_ACCOUNT["id"], DEMO_ACCOUNT["email"], DEMO_ACCOUNT["display_name"],
            DEMO_ACCOUNT["avatar_url"], DEMO_ACCOUNT["sync_status"],
            DEMO_ACCOUNT["sync_progress_current"], DEMO_ACCOUNT["sync_progress_total"],
            DEMO_ACCOUNT["sync_message"], DEMO_ACCOUNT["total_synced"], DEMO_ACCOUNT["last_synced_at"]
        ))

        # 2. Insert Digital Assets
        now = datetime.now()
        for idx, (p_name, domain, cat, from_mail, from_name, subj, conf) in enumerate(DEMO_PLATFORMS):
            asset_id = f"asset_demo_{p_name.lower().replace(' ', '_')}"
            first_detected = (now - timedelta(days=idx * 20 + 30)).strftime("%Y-%m-%d %H:%M:%S")
            last_activity = (now - timedelta(days=idx * 2 + 1)).strftime("%Y-%m-%d %H:%M:%S")
            msg_id = f"msg_demo_{idx}"

            await db.execute("""
                INSERT OR REPLACE INTO digital_assets (
                    id, account_id, platform_name, domain, category,
                    registered_email, first_detected_at, last_activity_at,
                    source_email_id, confidence_score
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                asset_id, DEMO_ACCOUNT["id"], p_name, domain, cat,
                DEMO_ACCOUNT["email"], first_detected, last_activity, msg_id, conf
            ))

            # Also create corresponding email
            body_text = f"Hello Alex,\n\n{subj}\n\nThank you for using {p_name}. You can manage your account and billing preferences at https://{domain}.\n\nBest regards,\nThe {p_name} Team"
            body_html = f"<html><body><h3>Hello Alex,</h3><p>{subj}</p><p>Thank you for using <b>{p_name}</b>. You can manage your account at <a href='https://{domain}'>https://{domain}</a>.</p><hr><p style='color:#666;'>Sent by {from_name} ({from_mail})</p></body></html>"
            date_ts = int((now - timedelta(days=idx * 2 + 1)).timestamp() * 1000)
            date_str = (now - timedelta(days=idx * 2 + 1)).strftime("%a, %d %b %Y %H:%M:%S +0000")

            has_att = 1 if idx < len(DEMO_ATTACHMENTS) else 0

            await db.execute("""
                INSERT OR REPLACE INTO emails (
                    id, account_id, thread_id, subject, from_name, from_email,
                    to_emails, cc_emails, date_timestamp, date_str, snippet,
                    body_text, body_html, labels, has_attachments, size_estimate
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                msg_id, DEMO_ACCOUNT["id"], f"thread_{idx}", subj, from_name, from_mail,
                DEMO_ACCOUNT["email"], "", date_ts, date_str, subj[:100],
                body_text, body_html, '["INBOX"]', has_att, 15000 + idx * 2500
            ))

            # Contacts
            domain_part = domain.split("/")[0]
            contact_id = f"cnt_demo_{idx}"
            await db.execute("""
                INSERT OR REPLACE INTO contacts (
                    id, account_id, email, name, domain, inbound_count, outbound_count,
                    first_interaction, last_interaction, weight
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                contact_id, DEMO_ACCOUNT["id"], from_mail, from_name, domain_part,
                10 + (20 - idx), 2, first_detected[:10], last_activity[:10], (20 - idx) * 1.5
            ))

        # 3. Insert Subscriptions
        for idx, (srv, curr, amt, cyc, inv_date) in enumerate(DEMO_SUBSCRIPTIONS):
            sub_id = f"sub_demo_{idx}"
            await db.execute("""
                INSERT OR REPLACE INTO subscriptions (
                    id, account_id, service_name, currency, amount, cycle, invoice_date, source_email_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                sub_id, DEMO_ACCOUNT["id"], srv, curr, amt, cyc, inv_date, f"msg_demo_{idx}"
            ))

        # 4. Insert Attachments
        for idx, (fname, fsize, mtype, cat) in enumerate(DEMO_ATTACHMENTS):
            att_id = f"att_demo_{idx}"
            msg_id = f"msg_demo_{idx % len(DEMO_PLATFORMS)}"
            fhash = hashlib.sha256(fname.encode()).hexdigest()
            await db.execute("""
                INSERT OR REPLACE INTO attachments (
                    id, email_id, account_id, filename, file_size, mime_type, category, file_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                att_id, msg_id, DEMO_ACCOUNT["id"], fname, fsize, mtype, cat, fhash
            ))

        # 5. Authorize demo account to default groups (normal & business)
        for gid in ("group_normal_admin", "group_business_admin"):
            await db.execute("""
                INSERT OR IGNORE INTO group_account_permissions (group_id, account_id, created_at)
                VALUES (?, ?, datetime('now', 'localtime'))
            """, (gid, DEMO_ACCOUNT["id"]))

        await db.commit()

    return {"message": "演示数据成功注入", "status": "success"}
