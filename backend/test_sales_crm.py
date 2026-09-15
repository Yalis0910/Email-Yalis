import asyncio
import sys
import os
import json
from app.database import init_db, get_db
from app.services.sales_service import SalesService
from app.services.auth_service import AuthService
from app.services.ai_tools import execute_copilot_tool

async def run_tests():
    print("=== Starting Foreign Trade CRM & Sales Playbook Test Suite ===")
    init_db()

    # Test 1: Playbook seeding verification
    playbooks = await SalesService.list_playbooks()
    assert len(playbooks) >= 6, f"Expected at least 6 playbooks, got {len(playbooks)}"
    categories = {p["scenario_type"] for p in playbooks}
    assert "objection_price" in categories, "Missing objection_price playbook"
    assert "payment_terms" in categories, "Missing payment_terms playbook"
    assert "delivery_leadtime" in categories, "Missing delivery_leadtime playbook"
    assert "competitor" in categories, "Missing competitor playbook"
    assert "reactivation" in categories, "Missing reactivation playbook"
    assert "closing" in categories, "Missing closing playbook"
    print(f"[PASS] 1. Seeded Playbooks verified: {len(playbooks)} playbooks active across all foreign trade scenarios.")

    # Test 2: Playbook CRUD operations
    new_pb = await SalesService.create_playbook({
        "title": "测试话术: 广交会后针对北美大买家的极速跟进",
        "scenario_type": "reactivation",
        "trigger_patterns": ["Canton Fair", "booth follow up", "北美买家"],
        "response_strategy": "强调广交会面谈细节，针对意向样品锁定限时早鸟交期",
        "template_text": "Hi {{customer_name}}, It was a great pleasure meeting you at our booth..."
    })
    pb_id = new_pb["id"]
    assert new_pb["title"] == "测试话术: 广交会后针对北美大买家的极速跟进"
    print("[PASS] 2.1 Playbook Creation")

    # Update playbook
    updated_pb = await SalesService.update_playbook(pb_id, {
        "title": "测试话术: 广交会后跟进(已优化)"
    })
    assert updated_pb["title"] == "测试话术: 广交会后跟进(已优化)"
    print("[PASS] 2.2 Playbook Update")

    # Search playbook
    search_res = await SalesService.list_playbooks(search="广交会")
    assert any(p["id"] == pb_id for p in search_res), "Search by keyword failed"
    print("[PASS] 2.3 Playbook Keyword Search")

    # Delete playbook
    deleted = await SalesService.delete_playbook(pb_id)
    assert deleted is True
    post_delete_search = await SalesService.list_playbooks(search="广交会")
    assert not any(p["id"] == pb_id for p in post_delete_search), "Playbook should be deleted"
    print("[PASS] 2.4 Playbook Deletion")

    # Test 3: Contact Tiering & Lock
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM contacts LIMIT 1")
        row = await cur.fetchone()
        contact_id = row[0] if row else None

    if contact_id:
        # Update tier manually
        updated_c = await SalesService.update_contact_tier(
            contact_id=contact_id,
            tier="A",
            tier_reason="年度采购预算超100万美金的核心战略大客",
            tier_locked=True,
            deal_stage="negotiation",
            estimated_value=120000.0,
            next_follow_up_due="2026-09-20 18:00:00"
        )
        assert updated_c["tier"] == "A", f"Tier mismatch: {updated_c.get('tier')}"
        assert updated_c["tier_locked"] == 1, "tier_locked should be 1"
        assert updated_c["deal_stage"] == "negotiation"
        assert updated_c["estimated_value"] == 120000.0
        print(f"[PASS] 3. Contact Tier & Lock Updated for contact {contact_id}")

        # Test 4: Follow-up Radar Check
        radar = await SalesService.get_follow_up_radar()
        assert "total_urgent" in radar
        assert "total_warning" in radar
        assert "urgent_items" in radar
        assert "warning_items" in radar
        assert "summary" in radar
        print(f"[PASS] 4. Follow-up Radar returned {radar['total_urgent']} urgent, {radar['total_warning']} warning items, overdue A: {radar['summary']['a_tier_overdue']}")

    # Test 5: Copilot AI Tools Integration
    # Test query_customer_tier tool
    res_tier_tool, _, summary_tier = await execute_copilot_tool(
        "query_customer_tier",
        {"email_or_name": updated_c["email"]}
    )
    assert "customer" in res_tier_tool, f"Tool error: {res_tier_tool}"
    assert res_tier_tool["customer"]["tier"] == "A"
    print(f"[PASS] 5.1 Copilot Tool query_customer_tier returned: {summary_tier}")

    # Test search_sales_playbook tool
    res_pb_tool, _, summary_pb = await execute_copilot_tool(
        "search_sales_playbook",
        {"query": "价格", "scenario_type": "objection_price"}
    )
    assert len(res_pb_tool.get("matched_playbooks", [])) >= 1, "Expected at least 1 matching playbook"
    print(f"[PASS] 5.2 Copilot Tool search_sales_playbook returned {len(res_pb_tool['matched_playbooks'])} playbooks: {summary_pb}")

    print("\n=== ALL CRM & SALES PLAYBOOK TESTS PASSED! ===")

if __name__ == "__main__":
    asyncio.run(run_tests())
