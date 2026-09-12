import sqlite3
from app.config import DB_PATH

con = sqlite3.connect(DB_PATH)
con.row_factory = sqlite3.Row
cur = con.cursor()

def search_emails(q, account_id=None, has_attachments=None, limit=25, offset=0):
    clean_q = '"' + q.strip().replace('"', '""') + '"'
    conditions = ["email_fts MATCH ?"]
    params = [clean_q]

    if account_id:
        conditions.append("e.account_id = ?")
        params.append(account_id)
    if has_attachments is not None:
        conditions.append("e.has_attachments = ?")
        params.append(has_attachments)

    where_clause = f"WHERE {' AND '.join(conditions)}"

    try:
        count_sql = f"""
            SELECT COUNT(*)
            FROM email_fts
            JOIN emails e ON email_fts.id = e.id
            {where_clause}
        """
        cur.execute(count_sql, params)
        total = cur.fetchone()[0]

        query_sql = f"""
            SELECT e.id, e.subject, e.from_email, e.from_name, e.date_str
            FROM email_fts
            JOIN emails e ON email_fts.id = e.id
            {where_clause}
            ORDER BY e.date_timestamp DESC
            LIMIT ? OFFSET ?
        """
        cur.execute(query_sql, (*params, limit, offset))
        items = [dict(r) for r in cur.fetchall()]
        return total, items
    except Exception as e:
        print("FTS failed, falling back to LIKE:", e)
        # Fallback to LIKE
        like_conds = ["(e.subject LIKE ? OR e.from_email LIKE ? OR e.from_name LIKE ? OR e.snippet LIKE ?)"]
        like_pat = f"%{q.strip()}%"
        like_params = [like_pat, like_pat, like_pat, like_pat]
        if account_id:
            like_conds.append("e.account_id = ?")
            like_params.append(account_id)
        where_like = f"WHERE {' AND '.join(like_conds)}"
        cur.execute(f"SELECT COUNT(*) FROM emails e {where_like}", like_params)
        total = cur.fetchone()[0]
        cur.execute(f"SELECT e.id, e.subject, e.from_email, e.from_name, e.date_str FROM emails e {where_like} ORDER BY e.date_timestamp DESC LIMIT ? OFFSET ?", (*like_params, limit, offset))
        items = [dict(r) for r in cur.fetchall()]
        return total, items

for test_query in ["support@example.com", "example", "Invoice", "test@example.com"]:
    total, items = search_emails(test_query, account_id="acc_test_demo")
    print(f"Query [{test_query}] -> Found {total} emails. First: {items[0]['subject'] if items else 'None'}")
