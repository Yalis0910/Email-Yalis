import asyncio
import sys
from app.database import init_db, get_db
from app.services.auth_service import AuthService
from app.services.ai_service import AIService

async def run_tests():
    print("=== Starting RBAC & Data Isolation Test Suite ===")
    init_db()

    # Test 1: Password hashing and verification
    pwd = "secret_password_123"
    h, salt = AuthService.hash_password(pwd)
    assert AuthService.verify_password(pwd, salt, h) is True, "Password verification failed"
    assert AuthService.verify_password("wrong_password", salt, h) is False, "Wrong password accepted"
    print("[PASS] 1. Password Hashing & Verification")

    # Test 2: Token generation & verification
    token = await AuthService.create_token("user_101", "testuser", expires_days=1)
    payload = await AuthService.verify_token(token)
    assert payload is not None, "Token verification failed"
    assert payload["uid"] == "user_101", "Token payload mismatch"
    assert payload["username"] == "testuser", "Token payload mismatch"
    assert await AuthService.verify_token("invalid.token.string") is None, "Invalid token accepted"
    print("[PASS] 2. Token Creation & Signature Verification")

    # Test 3: Superadmin authentication & profile
    admin_profile = await AuthService.authenticate_user("admin", "admin123")
    assert admin_profile is not None, "Admin authentication failed"
    assert admin_profile["is_superadmin"] is True, "Admin should be superadmin"
    assert "page:rbac" in admin_profile["page_permissions"], "Admin should have page:rbac"
    assert "action:rbac_manage" in admin_profile["action_permissions"], "Admin should have action:rbac_manage"
    assert admin_profile["authorized_accounts"] is None, "Superadmin should have access to ALL accounts (None)"
    print("[PASS] 3. Superadmin Profile & All-Access Check")

    # Test 3.1: Verify Built-in Default Management Groups (普通管理组, 业务管理组)
    from app.routers.users import list_groups, delete_group
    from fastapi import HTTPException
    all_groups = await list_groups(current_user=admin_profile)
    groups_by_id = {g["id"]: g for g in all_groups}
    assert "group_superadmin" in groups_by_id, "group_superadmin should exist"
    assert "group_normal_admin" in groups_by_id, "group_normal_admin should exist"
    assert "group_business_admin" in groups_by_id, "group_business_admin should exist"

    normal_grp = groups_by_id["group_normal_admin"]
    assert normal_grp["name"] == "普通管理组", f"Unexpected name: {normal_grp['name']}"
    assert "page:settings" in normal_grp["page_permissions"], "Normal admin should have page:settings"
    assert "action:accounts_manage" in normal_grp["action_permissions"], "Normal admin should have action:accounts_manage"
    assert "page:rbac" not in normal_grp["page_permissions"], "Normal admin should NOT have page:rbac"
    assert "action:rbac_manage" not in normal_grp["action_permissions"], "Normal admin should NOT have action:rbac_manage"

    biz_grp = groups_by_id["group_business_admin"]
    assert biz_grp["name"] == "业务管理组", f"Unexpected name: {biz_grp['name']}"
    assert "page:emails" in biz_grp["page_permissions"], "Business admin should have page:emails"
    assert "page:ai_copilot" in biz_grp["page_permissions"], "Business admin should have page:ai_copilot"
    assert "action:sync_trigger" in biz_grp["action_permissions"], "Business admin should have action:sync_trigger"
    assert "page:settings" not in biz_grp["page_permissions"], "Business admin should NOT have page:settings"
    assert "page:rbac" not in biz_grp["page_permissions"], "Business admin should NOT have page:rbac"
    assert "action:accounts_manage" not in biz_grp["action_permissions"], "Business admin should NOT have action:accounts_manage"

    # Test deletion protection for default groups
    try:
        await delete_group("group_normal_admin", current_user=admin_profile)
        assert False, "Should have raised HTTPException when deleting group_normal_admin"
    except HTTPException as e:
        assert e.status_code == 400, "Should be 400 Bad Request"
    print("[PASS] 3.1. Built-in Default Management Groups (普通管理组 & 业务管理组) Verified")

    # Test 4: Management Group Creation & Mailbox Association
    async with get_db() as db:
        # Clean up any previous test group/user/accounts
        await db.execute("DELETE FROM users WHERE username IN ('test_ops_user', 'test_dev_user')")
        await db.execute("DELETE FROM user_groups WHERE name = '测试业务组'")
        await db.execute("DELETE FROM accounts WHERE id IN ('acc_test_1', 'acc_test_extra')")
        # Insert test accounts
        await db.execute("INSERT OR IGNORE INTO accounts (id, email) VALUES ('acc_test_1', 'test1@example.com')")
        await db.execute("INSERT OR IGNORE INTO accounts (id, email) VALUES ('acc_test_extra', 'test_extra@example.com')")
        await db.commit()

    from app.routers.users import create_group, GroupCreateOrUpdateRequest, create_user, UserCreateRequest
    admin_ctx = admin_profile

    grp_res = await create_group(
        GroupCreateOrUpdateRequest(
            name="测试业务组",
            description="仅允许看板与检索，绑定邮箱 acc_test_1",
            page_permissions=["page:dashboard", "page:emails"],
            action_permissions=["action:sync_trigger"],
            account_ids=["acc_test_1"]
        ),
        current_user=admin_ctx
    )
    group_id = grp_res["group_id"]
    print(f"[PASS] 4. Management Group Created: {group_id}")

    # Test 5: User Creation with Group & Extra Account
    user_res = await create_user(
        UserCreateRequest(
            username="test_ops_user",
            password="user12345",
            display_name="业务测试员",
            group_id=group_id,
            account_ids=["acc_test_extra"]
        ),
        current_user=admin_ctx
    )
    user_id = user_res["user_id"]
    print(f"[PASS] 5. User Created: {user_id}")

    # Test 6: Authenticate User & Validate Effective Permissions
    user_profile = await AuthService.authenticate_user("test_ops_user", "user12345")
    assert user_profile is not None, "User login failed"
    assert user_profile["is_superadmin"] is False, "User should not be superadmin"
    assert "page:dashboard" in user_profile["page_permissions"], "User should have page:dashboard"
    assert "page:emails" in user_profile["page_permissions"], "User should have page:emails"
    assert "page:rbac" not in user_profile["page_permissions"], "User should NOT have page:rbac"
    assert "action:rbac_manage" not in user_profile["action_permissions"], "User should NOT have action:rbac_manage"
    assert set(user_profile["authorized_accounts"]) == {"acc_test_1", "acc_test_extra"}, "Authorized accounts mismatch"
    print("[PASS] 6. User Effective Permissions & Account Inheritance Verified")

    # Test 7: AI Conversation Physical Isolation
    # Admin creates conversation
    conv_admin = await AIService.create_conversation(title="超管的专属对话", user_id="admin")
    # User creates conversation
    conv_user = await AIService.create_conversation(title="业务员的私密对话", user_id=user_id)

    # Admin lists conversations
    admin_convs = await AIService.list_conversations(user_id="admin")
    admin_conv_ids = [c["id"] for c in admin_convs]
    assert conv_admin["id"] in admin_conv_ids, "Admin should see their conversation"
    assert conv_user["id"] not in admin_conv_ids, "Admin list should NOT contain user conversation"

    # User lists conversations
    user_convs = await AIService.list_conversations(user_id=user_id)
    user_conv_ids = [c["id"] for c in user_convs]
    assert conv_user["id"] in user_conv_ids, "User should see their conversation"
    assert conv_admin["id"] not in user_conv_ids, "User list should NOT contain admin conversation"

    # User tries to access Admin's conversation details -> should return None
    cross_access = await AIService.get_conversation(conv_admin["id"], user_id=user_id)
    assert cross_access is None, "Security Breach: User was able to access Admin conversation!"

    # Clean up test conversations
    await AIService.delete_conversation(conv_admin["id"], user_id="admin")
    await AIService.delete_conversation(conv_user["id"], user_id=user_id)
    print("[PASS] 7. AI Conversation Physical Isolation Verified")

    # Clean up test user & group & accounts
    async with get_db() as db:
        await db.execute("DELETE FROM users WHERE username = 'test_ops_user'")
        await db.execute("DELETE FROM user_groups WHERE id = ?", (group_id,))
        await db.execute("DELETE FROM accounts WHERE id IN ('acc_test_1', 'acc_test_extra')")
        await db.commit()
    print("[PASS] 8. Cleaned up test data")

    print("\nALL BACKEND TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(run_tests())
