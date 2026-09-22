"""
Verification tests for Copilot RAG optimizations:
1. Cross-lingual trade terms expansion
2. read_email_detail tool execution
3. search_emails enhanced retrieval & ranking
4. Fallback search_context_for_query with bilingual expansion
"""

import sys
import os
import asyncio

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.trade_terms import expand_trade_keywords, FOREIGN_TRADE_TERMS
from app.services.ai_tools import COPILOT_TOOLS, execute_copilot_tool
from app.services.ai_retrieval import search_context_for_query, extract_keyword_window
from app.database import get_db

def test_trade_terms_expansion():
    print("Testing expand_trade_keywords...")
    
    # Chinese phrase expansion
    exp_sample = expand_trade_keywords("我想了解一下打样费的问题")
    assert any("sample" in x for x in exp_sample), f"Expected 'sample' in expansion, got {exp_sample}"
    
    exp_lead = expand_trade_keywords("交期延误怎么处理")
    assert any("lead time" in x or "delivery" in x for x in exp_lead), f"Expected delivery/lead time, got {exp_lead}"
    
    exp_quality = expand_trade_keywords("客户抱怨产品表面有划痕和瑕疵")
    assert any("scratch" in x for x in exp_quality), f"Expected 'scratch' in expansion, got {exp_quality}"
    assert any("defect" in x for x in exp_quality), f"Expected 'defect' in expansion, got {exp_quality}"

    # List input expansion
    exp_list = expand_trade_keywords(["单价", "尾款", "徽章"])
    assert any("unit price" in x or "price" in x for x in exp_list)
    assert any("balance" in x for x in exp_list)
    assert any("pin" in x or "badge" in x for x in exp_list)

    print(" [PASS] 1. Trade terms expansion verified.")

def test_tool_definitions():
    print("Testing COPILOT_TOOLS schema...")
    tool_names = [t["function"]["name"] for t in COPILOT_TOOLS]
    assert "search_emails" in tool_names, "search_emails missing from COPILOT_TOOLS"
    assert "read_email_detail" in tool_names, "read_email_detail missing from COPILOT_TOOLS"
    assert "inspect_attachment" in tool_names, "inspect_attachment missing from COPILOT_TOOLS"

    detail_tool = next(t for t in COPILOT_TOOLS if t["function"]["name"] == "read_email_detail")
    assert "email_id" in detail_tool["function"]["parameters"]["required"]
    print(" [PASS] 2. COPILOT_TOOLS schema verified with read_email_detail.")

def test_extract_keyword_window():
    print("Testing extract_keyword_window...")
    long_text = "Hello! " * 50 + "Regarding the unit price, we can offer $1.25 per pin. " + "Thank you! " * 50
    snip = extract_keyword_window(long_text, ["unit price", "单价"], window_size=100)
    assert "unit price" in snip
    assert "$1.25" in snip
    print(" [PASS] 3. extract_keyword_window sliding window verified.")

async def test_copilot_tools_async():
    print("Testing async execute_copilot_tool...")
    async with get_db() as db:
        cur = await db.execute("SELECT id, subject, body_text FROM emails LIMIT 1")
        sample_email = await cur.fetchone()

    if sample_email:
        test_email_id = sample_email["id"]
        # 4.1 Test read_email_detail with real email
        res, refs, summary = await execute_copilot_tool("read_email_detail", {"email_id": test_email_id})
        assert res["status"] == "success"
        assert res["email_id"] == test_email_id
        assert len(refs) == 1
        assert refs[0]["id"] == test_email_id
        assert "body" in res
        print(f" [PASS] 4.1 read_email_detail succeeded for email '{test_email_id}': {summary}")

        # 4.2 Test read_email_detail with truncation
        res_trunc, _, _ = await execute_copilot_tool("read_email_detail", {"email_id": test_email_id, "max_chars": 50})
        assert len(res_trunc["body"]) <= 120
        print(" [PASS] 4.2 read_email_detail max_chars truncation verified.")

    # 4.3 Test read_email_detail with non-existent email
    not_found_res, _, _ = await execute_copilot_tool("read_email_detail", {"email_id": "non_existent_em_123456"})
    assert not_found_res["status"] == "not_found"
    print(" [PASS] 4.3 read_email_detail not_found branch verified.")

    # 4.4 Test search_emails with bilingual keyword expansion
    res_search, _, sum_search = await execute_copilot_tool("search_emails", {"keywords": "报价", "limit": 5})
    assert "matched_count" in res_search
    print(f" [PASS] 4.4 search_emails with '报价' executed successfully: {sum_search}")

    # 4.5 Test fallback search_context_for_query with bilingual expansion
    context_str, fallback_refs = await search_context_for_query("请问客户对打样费和交期有什么要求？")
    assert isinstance(context_str, str)
    assert isinstance(fallback_refs, list)
    print(f" [PASS] 4.5 search_context_for_query executed successfully (context length: {len(context_str)}, refs: {len(fallback_refs)})")

def main():
    test_trade_terms_expansion()
    test_tool_definitions()
    test_extract_keyword_window()
    asyncio.run(test_copilot_tools_async())
    print("\nALL COPILOT RAG OPTIMIZATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    main()
