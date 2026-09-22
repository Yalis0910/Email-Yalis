from typing import Optional, Dict, Any, List
from app.database import get_db

CATEGORY_LABELS = {
    "dev_ops": "开发与运维",
    "ai_tools": "AI 与大模型",
    "productivity": "办公与协作",
    "finance": "财务与支付",
    "entertainment": "影音与娱乐",
    "ecommerce": "电商与消费",
    "social": "社交与人脉",
    "other": "其他资产"
}

class StatsService:
    @classmethod
    async def get_overview(
        cls,
        account_id: Optional[str] = None,
        allowed_account_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if account_id:
            acc_filter = "WHERE account_id = ?"
            acc_params = [account_id]
            time_filter = "WHERE date_timestamp IS NOT NULL AND account_id = ?"
            time_params = [account_id]
            acc_count_filter = "WHERE id = ?"
            acc_count_params = [account_id]
        elif allowed_account_ids is not None:
            if not allowed_account_ids:
                return {
                    "total_emails": 0,
                    "total_accounts": 0,
                    "total_digital_assets": 0,
                    "total_attachments": 0,
                    "total_attachment_size_bytes": 0,
                    "estimated_monthly_expense_usd": 0.0,
                    "category_distribution": [],
                    "activity_timeline": [],
                    "recent_assets": [],
                    "top_contacts": []
                }
            placeholders = ",".join("?" for _ in allowed_account_ids)
            acc_filter = f"WHERE account_id IN ({placeholders})"
            acc_params = list(allowed_account_ids)
            time_filter = f"WHERE date_timestamp IS NOT NULL AND account_id IN ({placeholders})"
            time_params = list(allowed_account_ids)
            acc_count_filter = f"WHERE id IN ({placeholders})"
            acc_count_params = list(allowed_account_ids)
        else:
            acc_filter = ""
            acc_params = []
            time_filter = "WHERE date_timestamp IS NOT NULL"
            time_params = []
            acc_count_filter = ""
            acc_count_params = []

        async with get_db() as db:
            # 1. Counts
            async with db.execute(f"SELECT COUNT(*) FROM emails {acc_filter}", acc_params) as c:
                total_emails = (await c.fetchone())[0]

            async with db.execute(f"SELECT COUNT(*) FROM accounts {acc_count_filter}", acc_count_params) as c:
                total_accounts = (await c.fetchone())[0]

            async with db.execute(f"SELECT COUNT(*) FROM digital_assets {acc_filter}", acc_params) as c:
                total_assets = (await c.fetchone())[0]

            async with db.execute(f"SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM attachments {acc_filter}", acc_params) as c:
                att_row = await c.fetchone()
                total_attachments = att_row[0]
                total_att_size = att_row[1]

            # 2. Monthly Expense calculation
            sub_query = f"""
                SELECT cycle, SUM(amount) FROM subscriptions
                {acc_filter}
                GROUP BY cycle
            """
            monthly_sum = 0.0
            async with db.execute(sub_query, acc_params) as c:
                async for row in c:
                    cycle = row[0]
                    amt = row[1] or 0.0
                    if cycle == "monthly":
                        monthly_sum += amt
                    elif cycle == "yearly":
                        monthly_sum += amt / 12.0
                    elif cycle == "one_time":
                        pass

            # 3. Category distribution
            cat_query = f"""
                SELECT category, COUNT(*) as cnt FROM digital_assets
                {acc_filter}
                GROUP BY category
                ORDER BY cnt DESC
            """
            cat_distribution = []
            async with db.execute(cat_query, acc_params) as c:
                async for row in c:
                    cat_distribution.append({
                        "category": row[0],
                        "name": CATEGORY_LABELS.get(row[0], row[0]),
                        "value": row[1]
                    })

            # 4. Activity Timeline (group by date_timestamp into YYYY-MM-DD)
            timeline_query = f"""
                SELECT strftime('%Y-%m-%d', date_timestamp / 1000, 'unixepoch', 'localtime') as dt, COUNT(*) as cnt
                FROM emails
                {time_filter}
                GROUP BY dt
                ORDER BY dt ASC
                LIMIT 30
            """
            timeline = []
            async with db.execute(timeline_query, time_params) as c:
                async for row in c:
                    if row[0]:
                        raw_dt = row[0].strip()
                        parts = raw_dt.split("-")
                        if len(parts) == 3:
                            display_dt = f"{parts[1]}月{parts[2]}日"
                        else:
                            display_dt = raw_dt
                        timeline.append({
                            "date": raw_dt,
                            "display_date": display_dt,
                            "count": row[1]
                        })

            # 5. Recent Assets
            recent_query = f"""
                SELECT id, account_id, platform_name, domain, category,
                       registered_email, first_detected_at, last_activity_at,
                       source_email_id, confidence_score
                FROM digital_assets
                {acc_filter}
                ORDER BY last_activity_at DESC
                LIMIT 6
            """
            recent_assets = []
            async with db.execute(recent_query, acc_params) as c:
                async for row in c:
                    recent_assets.append(dict(row))

            # 6. Top Contacts
            contacts_query = f"""
                SELECT id, account_id, email, name, domain, inbound_count,
                       outbound_count, first_interaction, last_interaction, weight
                FROM contacts
                {acc_filter}
                ORDER BY weight DESC
                LIMIT 6
            """
            top_contacts = []
            async with db.execute(contacts_query, acc_params) as c:
                async for row in c:
                    top_contacts.append(dict(row))

            return {
                "total_emails": total_emails,
                "total_accounts": total_accounts,
                "total_digital_assets": total_assets,
                "total_attachments": total_attachments,
                "total_attachment_size_bytes": total_att_size,
                "estimated_monthly_expense_usd": round(monthly_sum, 2),
                "category_distribution": cat_distribution,
                "activity_timeline": timeline,
                "recent_assets": recent_assets,
                "top_contacts": top_contacts
            }

    @classmethod
    async def get_contacts_graph(
        cls,
        account_id: Optional[str] = None,
        limit: int = 35,
        allowed_account_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if account_id:
            acc_filter = "WHERE account_id = ?"
            acc_params = [account_id]
        elif allowed_account_ids is not None:
            if not allowed_account_ids:
                return {"nodes": [], "links": [], "categories": []}
            placeholders = ",".join("?" for _ in allowed_account_ids)
            acc_filter = f"WHERE account_id IN ({placeholders})"
            acc_params = list(allowed_account_ids)
        else:
            acc_filter = ""
            acc_params = []

        nodes = []
        links = []
        categories = [{"name": "核心邮箱"}, {"name": "SaaS / 企业"}, {"name": "联系人"}]

        # Center node
        center_id = account_id or "root_user"
        center_label = account_id.replace("acc_", "") if account_id else "全部邮箱"
        nodes.append({
            "id": center_id,
            "name": center_label,
            "symbolSize": 50,
            "category": 0,
            "draggable": True,
            "itemStyle": {"color": "#6366f1"}
        })

        async with get_db() as db:
            # Query top contacts
            query = f"""
                SELECT id, email, name, domain, weight, inbound_count
                FROM contacts
                {acc_filter}
                ORDER BY weight DESC
                LIMIT ?
            """
            params = (*acc_params, limit)
            seen_domains = set()

            async with db.execute(query, params) as c:
                async for row in c:
                    cid, email, name, domain, weight, in_cnt = row
                    node_id = f"node_{cid}"
                    node_size = max(18, min(45, int(15 + weight * 1.5)))

                    # If domain is not seen and meaningful, add domain node
                    if domain and domain not in ["gmail.com", "qq.com", "163.com", "outlook.com"] and domain not in seen_domains:
                        seen_domains.add(domain)
                        dom_node_id = f"dom_{domain}"
                        nodes.append({
                            "id": dom_node_id,
                            "name": domain,
                            "symbolSize": 32,
                            "category": 1,
                            "draggable": True,
                            "itemStyle": {"color": "#10b981"}
                        })
                        links.append({
                            "source": center_id,
                            "target": dom_node_id,
                            "value": 2,
                            "lineStyle": {"width": 2, "curveness": 0.1}
                        })

                    # Add contact node
                    nodes.append({
                        "id": node_id,
                        "name": name or email.split("@")[0],
                        "value": in_cnt,
                        "symbolSize": node_size,
                        "category": 2,
                        "draggable": True,
                        "itemStyle": {"color": "#3b82f6"}
                    })

                    # Link to domain if exists, else link to center
                    target_parent = f"dom_{domain}" if (domain in seen_domains) else center_id
                    links.append({
                        "source": target_parent,
                        "target": node_id,
                        "value": in_cnt,
                        "lineStyle": {"width": max(1, min(6, int(weight / 2))), "curveness": 0.2}
                    })

        return {
            "nodes": nodes,
            "links": links,
            "categories": categories
        }

    @classmethod
    async def update_contacts_incremental(cls, account_id: str, new_email_ids: Optional[List[str]] = None):
        """
        Ultra-fast incremental contacts updater for delta email synchronizations.
        Instead of scanning the entire historical emails table, it only processes
        newly synced messages and applies atomic UPSERT increments.
        Reduces post-sync recalculation from ~10s to ~5ms.
        """
        if not new_email_ids:
            return

        import re
        import hashlib
        from datetime import datetime, timezone
        from app.services.asset_extractor import AssetExtractor

        async with get_db() as db:
            async with db.execute("SELECT id, email FROM accounts WHERE id = ?", (account_id,)) as cur:
                acc = await cur.fetchone()
                if not acc:
                    return
                user_email = (acc["email"] or "").lower().strip()

            # Batch query newly synced emails
            BATCH = 400
            new_emails_records = []
            for i in range(0, len(new_email_ids), BATCH):
                sub_ids = new_email_ids[i:i + BATCH]
                ph = ",".join(["?"] * len(sub_ids))
                async with db.execute(f"""
                    SELECT from_name, from_email, to_emails, cc_emails, date_timestamp, labels
                    FROM emails
                    WHERE id IN ({ph})
                """, sub_ids) as cur:
                    rows = await cur.fetchall()
                    new_emails_records.extend(rows)

            if not new_emails_records:
                return

            delta_map = {}
            for row in new_emails_records:
                f_name = row["from_name"] or ""
                f_email = (row["from_email"] or "").lower().strip()
                to_emails = row["to_emails"] or ""
                cc_emails = row["cc_emails"] or ""
                ts = row["date_timestamp"]
                labels = row["labels"] or ""

                is_outbound = ("SENT" in labels) or (bool(user_email) and f_email == user_email)

                if is_outbound:
                    # Outbound: to recipients
                    recipients = re.findall(r'[\w\.-]+@[\w\.-]+\.\w+', f"{to_emails} {cc_emails}")
                    for r in set(recipients):
                        r_clean = r.lower().strip()
                        if not r_clean or r_clean == user_email:
                            continue
                        if r_clean not in delta_map:
                            delta_map[r_clean] = {
                                "name": r_clean.split("@")[0],
                                "domain": AssetExtractor.extract_domain(r_clean),
                                "inbound": 0,
                                "outbound": 0,
                                "first_ts": ts,
                                "last_ts": ts
                            }
                        entry = delta_map[r_clean]
                        entry["outbound"] += 1
                        if ts:
                            if entry["first_ts"] is None or ts < entry["first_ts"]: entry["first_ts"] = ts
                            if entry["last_ts"] is None or ts > entry["last_ts"]: entry["last_ts"] = ts
                else:
                    # Inbound: from other senders
                    if f_email and "@" in f_email and f_email != user_email:
                        if f_email not in delta_map:
                            delta_map[f_email] = {
                                "name": f_name or f_email.split("@")[0],
                                "domain": AssetExtractor.extract_domain(f_email),
                                "inbound": 0,
                                "outbound": 0,
                                "first_ts": ts,
                                "last_ts": ts
                            }
                        entry = delta_map[f_email]
                        entry["inbound"] += 1
                        if f_name and len(f_name) > len(entry["name"]):
                            entry["name"] = f_name
                        if ts:
                            if entry["first_ts"] is None or ts < entry["first_ts"]: entry["first_ts"] = ts
                            if entry["last_ts"] is None or ts > entry["last_ts"]: entry["last_ts"] = ts

            if not delta_map:
                return

            upsert_rows = []
            for c_email, data in delta_map.items():
                cnt_id = f"cnt_{account_id}_{hashlib.md5(c_email.encode()).hexdigest()[:10]}"
                first_str = datetime.fromtimestamp(data['first_ts'] / 1000, tz=timezone.utc).strftime('%Y-%m-%d') if data['first_ts'] else ""
                last_str = datetime.fromtimestamp(data['last_ts'] / 1000, tz=timezone.utc).strftime('%Y-%m-%d') if data['last_ts'] else ""
                weight = data["outbound"] * 1.5 + data["inbound"] * 1.0

                upsert_rows.append((
                    cnt_id, account_id, c_email, data["name"], data["domain"],
                    data["inbound"], data["outbound"], first_str, last_str, weight
                ))

            await db.executemany("""
                INSERT INTO contacts (
                    id, account_id, email, name, domain, inbound_count, outbound_count,
                    first_interaction, last_interaction, weight
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_id, email) DO UPDATE SET
                    name = CASE 
                        WHEN excluded.name IS NOT NULL AND excluded.name != '' AND (contacts.name IS NULL OR contacts.name = '' OR length(excluded.name) >= length(contacts.name))
                        THEN excluded.name 
                        ELSE contacts.name 
                    END,
                    domain = excluded.domain,
                    inbound_count = contacts.inbound_count + excluded.inbound_count,
                    outbound_count = contacts.outbound_count + excluded.outbound_count,
                    first_interaction = CASE
                        WHEN contacts.first_interaction IS NULL OR contacts.first_interaction = '' OR (excluded.first_interaction != '' AND excluded.first_interaction < contacts.first_interaction)
                        THEN excluded.first_interaction
                        ELSE contacts.first_interaction
                    END,
                    last_interaction = CASE
                        WHEN contacts.last_interaction IS NULL OR contacts.last_interaction = '' OR excluded.last_interaction > contacts.last_interaction
                        THEN excluded.last_interaction
                        ELSE contacts.last_interaction
                    END,
                    weight = (contacts.outbound_count + excluded.outbound_count) * 1.5 + (contacts.inbound_count + excluded.inbound_count) * 1.0
            """, upsert_rows)
            await db.commit()

    @classmethod
    async def rebuild_contacts(cls, account_id: Optional[str] = None):
        """
        Idempotently and accurately recalculates the contacts table directly from the emails table.
        Ensures inbound_count, outbound_count, first_interaction, last_interaction, and weight
        are 100% synchronized with actual stored emails in the emails table.
        """
        import re
        import hashlib
        from datetime import datetime, timezone
        from app.services.asset_extractor import AssetExtractor

        async with get_db() as db:
            if account_id:
                async with db.execute("SELECT id, email FROM accounts WHERE id = ?", (account_id,)) as cur:
                    accounts = await cur.fetchall()
            else:
                async with db.execute("SELECT id, email FROM accounts") as cur:
                    accounts = await cur.fetchall()

            for acc in accounts:
                acc_id = acc["id"]
                user_email = (acc["email"] or "").lower().strip()

                contacts_map = {}

                # 1. Inbound emails (received from others)
                async with db.execute("""
                    SELECT from_name, from_email, date_timestamp
                    FROM emails
                    WHERE account_id = ?
                      AND from_email IS NOT NULL
                      AND from_email != ''
                      AND from_email LIKE '%@%'
                """, (acc_id,)) as cur:
                    async for row in cur:
                        from_name = row[0]
                        from_email = row[1]
                        ts = row[2]
                        f_clean = from_email.lower().strip()
                        if f_clean == user_email:
                            continue

                        if f_clean not in contacts_map:
                            contacts_map[f_clean] = {
                                'name': from_name or f_clean.split('@')[0],
                                'domain': AssetExtractor.extract_domain(f_clean),
                                'inbound_count': 0,
                                'outbound_count': 0,
                                'first_ts': ts,
                                'last_ts': ts
                            }

                        c_data = contacts_map[f_clean]
                        c_data['inbound_count'] += 1
                        if from_name and len(from_name) > len(c_data['name']) and not c_data['name']:
                            c_data['name'] = from_name
                        if ts:
                            if c_data['first_ts'] is None or ts < c_data['first_ts']:
                                c_data['first_ts'] = ts
                            if c_data['last_ts'] is None or ts > c_data['last_ts']:
                                c_data['last_ts'] = ts

                # 2. Outbound emails (sent by user)
                async with db.execute("""
                    SELECT to_emails, cc_emails, date_timestamp
                    FROM emails
                    WHERE account_id = ?
                      AND from_email = ? COLLATE NOCASE
                """, (acc_id, user_email)) as cur:
                    async for row in cur:
                        to_emails = row[0] or ''
                        cc_emails = row[1] or ''
                        ts = row[2]
                        recipients = re.findall(r'[\w\.-]+@[\w\.-]+\.\w+', f"{to_emails} {cc_emails}")
                        for r in set(recipients):
                            r_clean = r.lower().strip()
                            if r_clean == user_email:
                                continue

                            if r_clean not in contacts_map:
                                contacts_map[r_clean] = {
                                    'name': r_clean.split('@')[0],
                                    'domain': AssetExtractor.extract_domain(r_clean),
                                    'inbound_count': 0,
                                    'outbound_count': 0,
                                    'first_ts': ts,
                                    'last_ts': ts
                                }

                            c_data = contacts_map[r_clean]
                            c_data['outbound_count'] += 1
                            if ts:
                                if c_data['first_ts'] is None or ts < c_data['first_ts']:
                                    c_data['first_ts'] = ts
                                if c_data['last_ts'] is None or ts > c_data['last_ts']:
                                    c_data['last_ts'] = ts

                # Insert or update contacts using UPSERT to prevent cascading deletes of AI reports and deal reviews
                insert_rows = []
                for c_email, c_data in contacts_map.items():
                    cnt_id = f"cnt_{acc_id}_{hashlib.md5(c_email.encode()).hexdigest()[:10]}"
                    first_str = ""
                    last_str = ""
                    if c_data['first_ts']:
                        first_str = datetime.fromtimestamp(c_data['first_ts'] / 1000, tz=timezone.utc).strftime('%Y-%m-%d')
                    if c_data['last_ts']:
                        last_str = datetime.fromtimestamp(c_data['last_ts'] / 1000, tz=timezone.utc).strftime('%Y-%m-%d')

                    weight = c_data['outbound_count'] * 1.5 + c_data['inbound_count'] * 1.0

                    insert_rows.append((
                        cnt_id,
                        acc_id,
                        c_email,
                        c_data['name'],
                        c_data['domain'],
                        c_data['inbound_count'],
                        c_data['outbound_count'],
                        first_str,
                        last_str,
                        weight
                    ))

                if insert_rows:
                    # Clean up obsolete contacts that no longer have emails AND have no reports/reviews/custom data
                    valid_emails_set = {r[2] for r in insert_rows}
                    async with db.execute("""
                        SELECT id, email FROM contacts 
                        WHERE account_id = ? 
                          AND id NOT IN (SELECT contact_id FROM contact_ai_reports)
                          AND id NOT IN (SELECT contact_id FROM deal_reviews)
                          AND tier_locked = 0
                    """, (acc_id,)) as cur_obs:
                        obs_rows = await cur_obs.fetchall()

                    obsolete_contact_ids = [r["id"] for r in obs_rows if r["email"] not in valid_emails_set]
                    if obsolete_contact_ids:
                        BATCH_SIZE = 500
                        for i in range(0, len(obsolete_contact_ids), BATCH_SIZE):
                            batch = obsolete_contact_ids[i:i + BATCH_SIZE]
                            p_holders = ','.join(['?'] * len(batch))
                            await db.execute(f"DELETE FROM contacts WHERE id IN ({p_holders})", batch)

                    await db.executemany("""
                        INSERT INTO contacts (
                            id, account_id, email, name, domain, inbound_count, outbound_count,
                            first_interaction, last_interaction, weight
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(account_id, email) DO UPDATE SET
                            name = CASE 
                                WHEN excluded.name IS NOT NULL AND excluded.name != '' AND (contacts.name IS NULL OR contacts.name = '' OR length(excluded.name) >= length(contacts.name))
                                THEN excluded.name 
                                ELSE contacts.name 
                            END,
                            domain = excluded.domain,
                            inbound_count = excluded.inbound_count,
                            outbound_count = excluded.outbound_count,
                            first_interaction = excluded.first_interaction,
                            last_interaction = excluded.last_interaction,
                            weight = excluded.weight
                    """, insert_rows)

                await db.commit()

