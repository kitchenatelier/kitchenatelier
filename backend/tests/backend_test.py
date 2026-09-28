"""
Backend regression tests for The Kitchen Atelier MVP.
Covers: auth, products, product image upload/download, orders (validation,
idempotency, isolation, status/notes updates), notifications, settings,
customers admin listing, order-statuses.
"""
import io
import os
import struct
import uuid
import zlib

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://kitchen-atelier-mvp.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@kitchenatelier.com"
ADMIN_PASSWORD = "Admin@KA2026"
CUSTOMER_EMAIL = "customer@demo.com"
CUSTOMER_PASSWORD = "Customer@2026"


# ---------- Helpers ----------
def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


def _tiny_png_bytes():
    # 1x1 red PNG
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


@pytest.fixture(scope="session")
def admin_ctx():
    s = requests.Session()
    token, user = _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
    s.headers.update({"Authorization": f"Bearer {token}"})
    return {"session": s, "token": token, "user": user}


@pytest.fixture(scope="session")
def customer_ctx():
    s = requests.Session()
    token, user = _login(s, CUSTOMER_EMAIL, CUSTOMER_PASSWORD)
    s.headers.update({"Authorization": f"Bearer {token}"})
    return {"session": s, "token": token, "user": user}


@pytest.fixture(scope="session")
def customer_b_ctx():
    # Register a second customer to test order isolation & 403
    s = requests.Session()
    email = f"test_iso_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={
        "email": email, "password": "Passw0rd!", "name": "Iso B",
        "company": "TEST Iso", "phone": "+60000",
        "address": "Nowhere", "delivery_instructions": ""
    }, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}"})
    return {"session": s, "user": data["user"], "email": email}


# ---------- Auth ----------
class TestAuth:
    def test_register_creates_customer_role_only(self):
        s = requests.Session()
        email = f"test_reg_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": "Passw0rd!", "name": "TEST User"
        }, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["role"] == "customer"
        assert body["user"]["email"] == email
        assert "access_token" in body

    def test_register_duplicate_email_409(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/register", json={
            "email": CUSTOMER_EMAIL, "password": "Whatever1!", "name": "dup"
        }, timeout=30)
        assert r.status_code == 409

    def test_login_admin_returns_jwt(self):
        s = requests.Session()
        token, user = _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
        assert token
        assert user["role"] == "admin"
        assert user["email"] == ADMIN_EMAIL

    def test_login_customer_returns_jwt(self):
        s = requests.Session()
        token, user = _login(s, CUSTOMER_EMAIL, CUSTOMER_PASSWORD)
        assert token
        assert user["role"] == "customer"
        assert user["email"] == CUSTOMER_EMAIL

    def test_login_invalid_password_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": CUSTOMER_EMAIL, "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_auth_me_returns_user(self, customer_ctx):
        r = customer_ctx["session"].get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == CUSTOMER_EMAIL
        assert body["role"] == "customer"

    def test_auth_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401


# ---------- Products ----------
class TestProducts:
    def test_list_products_customer_available_only(self, customer_ctx):
        r = customer_ctx["session"].get(f"{API}/products", timeout=30)
        assert r.status_code == 200
        products = r.json()
        assert isinstance(products, list)
        assert len(products) >= 5, f"Expected demo products, got {len(products)}"
        for p in products:
            assert p["available"] is True

    def test_products_categories(self, customer_ctx):
        r = customer_ctx["session"].get(f"{API}/products/categories", timeout=30)
        assert r.status_code == 200
        cats = r.json()
        assert isinstance(cats, list)
        assert "Plates & Trays" in cats
        assert "Pots & Pans" in cats

    def test_get_single_product(self, customer_ctx):
        products = customer_ctx["session"].get(f"{API}/products", timeout=30).json()
        pid = products[0]["id"]
        r = customer_ctx["session"].get(f"{API}/products/{pid}", timeout=30)
        assert r.status_code == 200
        assert r.json()["id"] == pid

    def test_get_product_invalid_id_404(self, customer_ctx):
        r = customer_ctx["session"].get(f"{API}/products/not-a-real-id", timeout=30)
        assert r.status_code == 404

    def test_customer_cannot_create_product_403(self, customer_ctx):
        r = customer_ctx["session"].post(f"{API}/products", json={
            "sku": "TEST-C-1", "name": "TEST c create", "price": 1.0
        }, timeout=30)
        assert r.status_code == 403

    def test_admin_can_create_update_delete_product(self, admin_ctx):
        sku = f"TEST-{uuid.uuid4().hex[:6]}"
        r = admin_ctx["session"].post(f"{API}/products", json={
            "sku": sku, "name": "TEST Product", "description": "d",
            "category": "TEST Cat", "unit": "pc", "price": 9.9,
            "variations": [{"name": "S", "price": 9.9, "available": True}],
        }, timeout=30)
        assert r.status_code == 200, r.text
        created = r.json()
        pid = created["id"]
        assert created["sku"] == sku
        assert created["price"] == 9.9

        # GET verify persistence
        g = admin_ctx["session"].get(f"{API}/products/{pid}", timeout=30)
        assert g.status_code == 200
        assert g.json()["name"] == "TEST Product"

        # PUT update
        u = admin_ctx["session"].put(f"{API}/products/{pid}", json={
            "sku": sku, "name": "TEST Product v2", "description": "d2",
            "category": "TEST Cat", "unit": "pc", "price": 19.9, "variations": [], "available": True
        }, timeout=30)
        assert u.status_code == 200
        assert u.json()["name"] == "TEST Product v2"
        assert u.json()["price"] == 19.9

        # DELETE
        d = admin_ctx["session"].delete(f"{API}/products/{pid}", timeout=30)
        assert d.status_code == 200

        # verify 404
        g2 = admin_ctx["session"].get(f"{API}/products/{pid}", timeout=30)
        assert g2.status_code == 404


# ---------- Product Image Upload ----------
class TestProductImage:
    def test_upload_png_and_fetch(self, admin_ctx):
        png = _tiny_png_bytes()
        # multipart upload
        s = admin_ctx["session"]
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        # requests.Session already has Auth header; ensure content-type is multipart
        r = s.post(f"{API}/products/upload-image", files=files, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "url" in body and body["url"].startswith("/api/files/")
        # Now fetch it via public URL
        fetch_url = f"{BASE_URL}{body['url']}"
        rf = requests.get(fetch_url, timeout=60)
        assert rf.status_code == 200
        assert rf.content == png or len(rf.content) > 0

    def test_upload_requires_admin(self, customer_ctx):
        png = _tiny_png_bytes()
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = customer_ctx["session"].post(f"{API}/products/upload-image", files=files, timeout=60)
        assert r.status_code == 403


# ---------- Orders ----------
class TestOrders:
    @pytest.fixture(scope="class")
    def demo_products(self, customer_ctx):
        return customer_ctx["session"].get(f"{API}/products", timeout=30).json()

    def test_create_order_validation_zero_qty(self, customer_ctx, demo_products):
        p = demo_products[0]
        r = customer_ctx["session"].post(f"{API}/orders", json={
            "items": [{"product_id": p["id"], "variation": p["variations"][0]["name"] if p["variations"] else "", "quantity": 0}],
            "notes": "TEST zero",
            "client_ref": f"TEST-{uuid.uuid4().hex}",
        }, timeout=30)
        # Pydantic will reject quantity 0 (ge=1) -> 422; or backend returns 400
        assert r.status_code in (400, 422)

    def test_create_order_unavailable_product_rejected(self, admin_ctx, customer_ctx):
        # Create a product then set available=False
        sku = f"TEST-U-{uuid.uuid4().hex[:6]}"
        c = admin_ctx["session"].post(f"{API}/products", json={
            "sku": sku, "name": "TEST Unavail", "unit": "pc", "price": 5.0,
            "variations": [], "available": False,
        }, timeout=30).json()
        pid = c["id"]
        r = customer_ctx["session"].post(f"{API}/orders", json={
            "items": [{"product_id": pid, "quantity": 1}],
            "notes": "TEST unavail", "client_ref": f"TEST-{uuid.uuid4().hex}",
        }, timeout=30)
        assert r.status_code == 400
        # cleanup
        admin_ctx["session"].delete(f"{API}/products/{pid}", timeout=30)

    def test_create_order_invalid_variation_rejected(self, customer_ctx, demo_products):
        p = next(x for x in demo_products if x["variations"])
        r = customer_ctx["session"].post(f"{API}/orders", json={
            "items": [{"product_id": p["id"], "variation": "NOT-A-VARIATION", "quantity": 1}],
            "notes": "TEST bad var", "client_ref": f"TEST-{uuid.uuid4().hex}",
        }, timeout=30)
        assert r.status_code == 400

    def test_create_order_success_and_order_number_format(self, customer_ctx, demo_products):
        p = demo_products[0]
        var = p["variations"][0]["name"] if p["variations"] else ""
        r = customer_ctx["session"].post(f"{API}/orders", json={
            "items": [{"product_id": p["id"], "variation": var, "quantity": 2}],
            "notes": "TEST create",
            "client_ref": f"TEST-{uuid.uuid4().hex}",
        }, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["order_number"].startswith("KA-")
        assert len(order["order_number"].split("-")[1]) == 6
        assert order["status"] == "Order Received"
        assert order["total_amount"] > 0
        assert len(order["status_history"]) == 1
        assert order["status_history"][0]["to"] == "Order Received"

    def test_create_order_idempotent_client_ref(self, customer_ctx, demo_products):
        p = demo_products[0]
        var = p["variations"][0]["name"] if p["variations"] else ""
        ref = f"TEST-{uuid.uuid4().hex}"
        payload = {
            "items": [{"product_id": p["id"], "variation": var, "quantity": 1}],
            "notes": "TEST idem", "client_ref": ref,
        }
        r1 = customer_ctx["session"].post(f"{API}/orders", json=payload, timeout=30)
        r2 = customer_ctx["session"].post(f"{API}/orders", json=payload, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"]
        assert r1.json()["order_number"] == r2.json()["order_number"]

    def test_customer_sees_only_own_orders(self, customer_ctx, customer_b_ctx, demo_products):
        # Customer A creates one order
        p = demo_products[0]
        var = p["variations"][0]["name"] if p["variations"] else ""
        customer_ctx["session"].post(f"{API}/orders", json={
            "items": [{"product_id": p["id"], "variation": var, "quantity": 1}],
            "notes": "TEST iso A", "client_ref": f"TEST-{uuid.uuid4().hex}",
        }, timeout=30)

        list_a = customer_ctx["session"].get(f"{API}/orders", timeout=30).json()
        list_b = customer_b_ctx["session"].get(f"{API}/orders", timeout=30).json()
        assert isinstance(list_a, list) and isinstance(list_b, list)
        # B has no orders
        assert list_b == []
        # A has at least 1 and all belong to A
        assert len(list_a) >= 1
        a_id = customer_ctx["user"]["id"]
        assert all(o["customer_id"] == a_id for o in list_a)

    def test_customer_b_cannot_view_a_order_403(self, customer_ctx, customer_b_ctx, demo_products):
        p = demo_products[0]
        var = p["variations"][0]["name"] if p["variations"] else ""
        r = customer_ctx["session"].post(f"{API}/orders", json={
            "items": [{"product_id": p["id"], "variation": var, "quantity": 1}],
            "notes": "TEST cross", "client_ref": f"TEST-{uuid.uuid4().hex}",
        }, timeout=30)
        assert r.status_code == 200
        a_order = r.json()
        rb = customer_b_ctx["session"].get(f"{API}/orders/{a_order['id']}", timeout=30)
        assert rb.status_code == 403

    def test_admin_update_status_creates_history_and_notification(self, customer_ctx, admin_ctx, demo_products):
        # create fresh order
        p = demo_products[0]
        var = p["variations"][0]["name"] if p["variations"] else ""
        cr = customer_ctx["session"].post(f"{API}/orders", json={
            "items": [{"product_id": p["id"], "variation": var, "quantity": 1}],
            "notes": "TEST status", "client_ref": f"TEST-{uuid.uuid4().hex}",
        }, timeout=30)
        assert cr.status_code == 200
        oid = cr.json()["id"]

        # notifications for customer before
        n_before = customer_ctx["session"].get(f"{API}/notifications", timeout=30).json()

        u = admin_ctx["session"].put(f"{API}/orders/{oid}/status", json={
            "status": "Confirmed", "customer_facing_note": "TEST confirm note",
        }, timeout=30)
        assert u.status_code == 200, u.text
        o = u.json()
        assert o["status"] == "Confirmed"
        assert o["customer_facing_notes"] == "TEST confirm note"
        assert any(h["to"] == "Confirmed" for h in o["status_history"])

        n_after = customer_ctx["session"].get(f"{API}/notifications", timeout=30).json()
        assert len(n_after) > len(n_before)
        latest = n_after[0]
        assert latest["order_id"] == oid
        assert latest["status"] == "Confirmed"

    def test_admin_update_notes(self, customer_ctx, admin_ctx, demo_products):
        p = demo_products[0]
        var = p["variations"][0]["name"] if p["variations"] else ""
        cr = customer_ctx["session"].post(f"{API}/orders", json={
            "items": [{"product_id": p["id"], "variation": var, "quantity": 1}],
            "notes": "TEST notes", "client_ref": f"TEST-{uuid.uuid4().hex}",
        }, timeout=30)
        oid = cr.json()["id"]
        u = admin_ctx["session"].put(f"{API}/orders/{oid}/notes", json={
            "admin_notes": "TEST internal", "customer_facing_notes": "TEST public",
        }, timeout=30)
        assert u.status_code == 200
        o = u.json()
        assert o["admin_notes"] == "TEST internal"
        assert o["customer_facing_notes"] == "TEST public"

    def test_admin_dashboard_summary(self, admin_ctx):
        r = admin_ctx["session"].get(f"{API}/orders/dashboard/summary", timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "counts" in body and "total" in body
        assert isinstance(body["counts"], dict)
        assert body["total"] >= 1

    def test_customer_forbidden_dashboard(self, customer_ctx):
        r = customer_ctx["session"].get(f"{API}/orders/dashboard/summary", timeout=30)
        assert r.status_code == 403


# ---------- Customers admin ----------
class TestCustomers:
    def test_admin_can_list_customers(self, admin_ctx):
        r = admin_ctx["session"].get(f"{API}/customers", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert any(u["email"] == CUSTOMER_EMAIL for u in data)

    def test_customer_forbidden_customers_list(self, customer_ctx):
        r = customer_ctx["session"].get(f"{API}/customers", timeout=30)
        assert r.status_code == 403


# ---------- Notifications ----------
class TestNotifications:
    def test_list_and_mark_read(self, customer_ctx):
        notifs = customer_ctx["session"].get(f"{API}/notifications", timeout=30).json()
        assert isinstance(notifs, list)
        if not notifs:
            pytest.skip("No notifications available yet")
        nid = notifs[0]["id"]
        r = customer_ctx["session"].post(f"{API}/notifications/{nid}/read", timeout=30)
        assert r.status_code == 200
        after = customer_ctx["session"].get(f"{API}/notifications", timeout=30).json()
        target = next((n for n in after if n["id"] == nid), None)
        assert target is not None and target["read"] is True


# ---------- Settings ----------
class TestSettings:
    def test_get_settings(self, customer_ctx):
        r = customer_ctx["session"].get(f"{API}/settings", timeout=30)
        assert r.status_code == 200
        s = r.json()
        assert "show_prices_to_customers" in s

    def test_admin_can_update_settings(self, admin_ctx):
        # toggle then restore
        cur = admin_ctx["session"].get(f"{API}/settings", timeout=30).json()
        new_val = not cur["show_prices_to_customers"]
        r = admin_ctx["session"].put(f"{API}/settings", json={"show_prices_to_customers": new_val}, timeout=30)
        assert r.status_code == 200
        assert r.json()["show_prices_to_customers"] == new_val
        # restore
        admin_ctx["session"].put(f"{API}/settings", json={"show_prices_to_customers": cur["show_prices_to_customers"]}, timeout=30)

    def test_customer_forbidden_update_settings(self, customer_ctx):
        r = customer_ctx["session"].put(f"{API}/settings", json={"show_prices_to_customers": True}, timeout=30)
        assert r.status_code == 403


# ---------- Order Statuses ----------
class TestOrderStatuses:
    def test_returns_nine_statuses(self, customer_ctx):
        r = customer_ctx["session"].get(f"{API}/order-statuses", timeout=30)
        assert r.status_code == 200
        statuses = r.json()
        assert len(statuses) == 9
        for s in [
            "Order Received", "Under Review", "Confirmed", "Preparing",
            "Ready for Delivery", "Dispatched", "Delivered", "Completed", "Cancelled",
        ]:
            assert s in statuses
