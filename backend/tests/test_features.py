"""
Backend tests for The Kitchen Atelier feature additions:
- Settings edo_terms_text & company_address
- payment_terms_days on customers
- customer-specific pricing
- stock management (track_stock, per-variation)
- invoice_issued_at / invoice_due_at on Confirmed
- paid toggle admin/customer
- PUT /orders/{id}/items admin edit
- dashboard summary (overdue_count, unpaid_total)
- E-DO photo upload + signature signing + re-sign block
- Invoice PDF download & 403 for other customer
- CSV import products & customers
"""
import io
import os
import time
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://kitchen-atelier-mvp.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@kitchenatelier.com"
ADMIN_PASSWORD = "Admin@KA2026"
CUSTOMER_EMAIL = "customer@demo.com"
CUSTOMER_PASSWORD = "Customer@2026"


# 1x1 transparent PNG
_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
_TINY_PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def customer_token():
    r = requests.post(f"{API}/auth/login", json={"email": CUSTOMER_EMAIL, "password": CUSTOMER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Customer login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def customer_id(admin_token):
    r = requests.get(f"{API}/customers", headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
    assert r.status_code == 200
    for c in r.json():
        if c["email"] == CUSTOMER_EMAIL:
            return c["id"]
    pytest.fail("Demo customer not found")


def _admin_h(t): return {"Authorization": f"Bearer {t}"}
def _cust_h(t): return {"Authorization": f"Bearer {t}"}


# ============================================================================
# Settings
# ============================================================================
class TestSettings:
    def test_get_settings_has_new_fields(self, admin_token):
        r = requests.get(f"{API}/settings", headers=_admin_h(admin_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "edo_terms_text" in data
        assert "company_address" in data
        assert isinstance(data["edo_terms_text"], str)

    def test_put_settings_updates_edo_terms(self, admin_token):
        new_terms = "TEST_TERMS " + uuid.uuid4().hex[:8]
        new_addr = "TEST_ADDR 12 Jalan Test"
        r = requests.put(
            f"{API}/settings", headers=_admin_h(admin_token),
            json={"edo_terms_text": new_terms, "company_address": new_addr}, timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["edo_terms_text"] == new_terms
        assert data["company_address"] == new_addr


# ============================================================================
# Customer payment_terms_days
# ============================================================================
class TestPaymentTerms:
    def test_auth_me_has_payment_terms(self, customer_token):
        r = requests.get(f"{API}/auth/me", headers=_cust_h(customer_token), timeout=30)
        assert r.status_code == 200
        assert "payment_terms_days" in r.json()

    def test_admin_update_customer_payment_terms(self, admin_token, customer_id):
        r = requests.put(
            f"{API}/customers/{customer_id}", headers=_admin_h(admin_token),
            json={"payment_terms_days": 45}, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["payment_terms_days"] == 45
        # Restore to 30 to isolate later tests but keep 45 for invoice test
        # We'll flip back to 30 at end via fixture teardown-less approach

    def test_admin_create_customer_with_terms(self, admin_token):
        email = f"TEST_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{API}/customers", headers=_admin_h(admin_token),
            json={"email": email, "password": "Passw0rd!", "name": "TEST NEW", "payment_terms_days": 60},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["payment_terms_days"] == 60


# ============================================================================
# Products - track_stock and stock
# ============================================================================
@pytest.fixture(scope="module")
def tracked_product(admin_token):
    payload = {
        "sku": f"TEST-STK-{uuid.uuid4().hex[:6]}",
        "name": "TEST Tracked Product",
        "price": 10.0, "unit": "pc",
        "track_stock": True, "stock": 0,
        "variations": [
            {"name": "S", "price": 10.0, "available": True, "stock": 5},
            {"name": "L", "price": 20.0, "available": True, "stock": 2},
        ],
    }
    r = requests.post(f"{API}/products", headers=_admin_h(admin_token), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["track_stock"] is True
    assert data["variations"][0]["stock"] == 5
    yield data
    requests.delete(f"{API}/products/{data['id']}", headers=_admin_h(admin_token), timeout=30)


class TestProductStock:
    def test_product_returns_track_stock(self, tracked_product):
        assert tracked_product["track_stock"] is True
        assert len(tracked_product["variations"]) == 2

    def test_out_of_stock_order_rejected(self, customer_token, tracked_product):
        payload = {
            "items": [{"product_id": tracked_product["id"], "variation": "L", "quantity": 99}],
            "client_ref": f"test-oos-{uuid.uuid4().hex}",
        }
        r = requests.post(f"{API}/orders", headers=_cust_h(customer_token), json=payload, timeout=30)
        assert r.status_code == 400
        assert "stock" in r.text.lower()

    def test_order_decrements_stock_and_cancel_restocks(self, admin_token, customer_token, tracked_product):
        pid = tracked_product["id"]
        payload = {
            "items": [{"product_id": pid, "variation": "S", "quantity": 2}],
            "client_ref": f"test-stk-{uuid.uuid4().hex}",
        }
        r = requests.post(f"{API}/orders", headers=_cust_h(customer_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        order_id = r.json()["id"]

        # Verify stock decremented from 5 -> 3
        r2 = requests.get(f"{API}/products/{pid}", headers=_admin_h(admin_token), timeout=30)
        s_stock = next(v["stock"] for v in r2.json()["variations"] if v["name"] == "S")
        assert s_stock == 3, f"Expected 3, got {s_stock}"

        # Cancel and verify restock 3 -> 5
        r3 = requests.put(
            f"{API}/orders/{order_id}/status", headers=_admin_h(admin_token),
            json={"status": "Cancelled"}, timeout=30,
        )
        assert r3.status_code == 200
        r4 = requests.get(f"{API}/products/{pid}", headers=_admin_h(admin_token), timeout=30)
        s_stock = next(v["stock"] for v in r4.json()["variations"] if v["name"] == "S")
        assert s_stock == 5, f"Expected 5 after cancel, got {s_stock}"


# ============================================================================
# Customer prices
# ============================================================================
class TestCustomerPrices:
    def test_set_and_get_prices(self, admin_token, customer_id, tracked_product):
        pid = tracked_product["id"]
        r = requests.put(
            f"{API}/customers/{customer_id}/prices", headers=_admin_h(admin_token),
            json={"prices": [
                {"product_id": pid, "variation": "S", "price": 7.77},
                {"product_id": pid, "variation": "L", "price": 15.00},
            ]}, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["count"] == 2

        rg = requests.get(
            f"{API}/customers/{customer_id}/prices", headers=_admin_h(admin_token), timeout=30,
        )
        assert rg.status_code == 200
        prices = {(p["product_id"], p["variation"]): p["price"] for p in rg.json()}
        assert prices[(pid, "S")] == 7.77

    def test_order_uses_customer_price(self, customer_token, tracked_product):
        pid = tracked_product["id"]
        payload = {
            "items": [{"product_id": pid, "variation": "S", "quantity": 1}],
            "client_ref": f"test-cp-{uuid.uuid4().hex}",
        }
        r = requests.post(f"{API}/orders", headers=_cust_h(customer_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        unit_price = r.json()["items"][0]["unit_price"]
        assert unit_price == 7.77, f"Expected customer price 7.77, got {unit_price}"


# ============================================================================
# Invoice issue/due, paid toggle, edit items, dashboard
# ============================================================================
@pytest.fixture(scope="module")
def sample_order(admin_token, customer_token, tracked_product, customer_id):
    # Ensure customer payment_terms_days = 45
    requests.put(
        f"{API}/customers/{customer_id}", headers=_admin_h(admin_token),
        json={"payment_terms_days": 45}, timeout=30,
    )
    payload = {
        "items": [{"product_id": tracked_product["id"], "variation": "L", "quantity": 1}],
        "client_ref": f"test-inv-{uuid.uuid4().hex}",
    }
    r = requests.post(f"{API}/orders", headers=_cust_h(customer_token), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestInvoiceTimeline:
    def test_confirmed_sets_invoice_dates(self, admin_token, sample_order):
        r = requests.put(
            f"{API}/orders/{sample_order['id']}/status", headers=_admin_h(admin_token),
            json={"status": "Confirmed"}, timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["invoice_issued_at"] is not None
        assert data["invoice_due_at"] is not None
        assert data["payment_terms_days"] == 45
        # Difference ~45 days
        from datetime import datetime
        issued = datetime.fromisoformat(data["invoice_issued_at"].replace("Z", "+00:00"))
        due = datetime.fromisoformat(data["invoice_due_at"].replace("Z", "+00:00"))
        delta_days = (due - issued).days
        assert 44 <= delta_days <= 46, f"Expected ~45 days, got {delta_days}"

    def test_paid_toggle_admin_only(self, admin_token, customer_token, sample_order):
        # Customer 403
        r = requests.put(
            f"{API}/orders/{sample_order['id']}/paid", headers=_cust_h(customer_token),
            json={"paid": True}, timeout=30,
        )
        assert r.status_code == 403
        # Admin ok
        r2 = requests.put(
            f"{API}/orders/{sample_order['id']}/paid", headers=_admin_h(admin_token),
            json={"paid": True}, timeout=30,
        )
        assert r2.status_code == 200
        assert r2.json()["paid"] is True

    def test_dashboard_summary(self, admin_token):
        r = requests.get(f"{API}/orders/dashboard/summary", headers=_admin_h(admin_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "overdue_count" in data
        assert "unpaid_total" in data
        assert isinstance(data["overdue_count"], int)


class TestEditOrderItems:
    def test_admin_edit_order_items(self, admin_token, customer_token, customer_id, tracked_product):
        pid = tracked_product["id"]
        # Create fresh order for editing
        r = requests.post(
            f"{API}/orders", headers=_cust_h(customer_token),
            json={"items": [{"product_id": pid, "variation": "S", "quantity": 1}],
                  "client_ref": f"test-edit-{uuid.uuid4().hex}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        order_id = r.json()["id"]

        # Get L stock before
        rp = requests.get(f"{API}/products/{pid}", headers=_admin_h(admin_token), timeout=30)
        l_before = next(v["stock"] for v in rp.json()["variations"] if v["name"] == "L")
        s_before = next(v["stock"] for v in rp.json()["variations"] if v["name"] == "S")

        # Edit: swap to L qty=1
        r2 = requests.put(
            f"{API}/orders/{order_id}/items", headers=_admin_h(admin_token),
            json={"items": [{"product_id": pid, "variation": "L", "quantity": 1}]}, timeout=30,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["items"][0]["variation"] == "L"

        rp2 = requests.get(f"{API}/products/{pid}", headers=_admin_h(admin_token), timeout=30)
        l_after = next(v["stock"] for v in rp2.json()["variations"] if v["name"] == "L")
        s_after = next(v["stock"] for v in rp2.json()["variations"] if v["name"] == "S")
        # S was consumed and now restocked (+1); L now consumed (-1)
        assert s_after == s_before + 1
        assert l_after == l_before - 1

    def test_edit_items_oos_rolls_back(self, admin_token, customer_token, tracked_product):
        pid = tracked_product["id"]
        r = requests.post(
            f"{API}/orders", headers=_cust_h(customer_token),
            json={"items": [{"product_id": pid, "variation": "S", "quantity": 1}],
                  "client_ref": f"test-oos-edit-{uuid.uuid4().hex}"}, timeout=30,
        )
        assert r.status_code == 200
        order_id = r.json()["id"]

        rp = requests.get(f"{API}/products/{pid}", headers=_admin_h(admin_token), timeout=30)
        s_before = next(v["stock"] for v in rp.json()["variations"] if v["name"] == "S")

        # Try edit with impossible qty
        r2 = requests.put(
            f"{API}/orders/{order_id}/items", headers=_admin_h(admin_token),
            json={"items": [{"product_id": pid, "variation": "S", "quantity": 9999}]}, timeout=30,
        )
        assert r2.status_code == 400

        rp2 = requests.get(f"{API}/products/{pid}", headers=_admin_h(admin_token), timeout=30)
        s_after = next(v["stock"] for v in rp2.json()["variations"] if v["name"] == "S")
        # Pre-restore state preserved
        assert s_after == s_before, f"Stock changed after failed edit: {s_before} -> {s_after}"


# ============================================================================
# E-DO
# ============================================================================
class TestEDO:
    def test_edo_full_flow(self, admin_token, customer_token, tracked_product):
        pid = tracked_product["id"]
        # Fresh order
        r = requests.post(
            f"{API}/orders", headers=_cust_h(customer_token),
            json={"items": [{"product_id": pid, "variation": "L", "quantity": 1}],
                  "client_ref": f"test-edo-{uuid.uuid4().hex}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        oid = r.json()["id"]

        # Advance to Dispatched
        for st in ["Confirmed", "Preparing", "Ready for Delivery", "Dispatched"]:
            rs = requests.put(
                f"{API}/orders/{oid}/status", headers=_admin_h(admin_token),
                json={"status": st}, timeout=30,
            )
            assert rs.status_code == 200, f"{st}: {rs.text}"

        # Upload photo
        files = {"file": ("box.png", _TINY_PNG, "image/png")}
        rp = requests.post(
            f"{API}/orders/{oid}/edo/photo", headers=_cust_h(customer_token),
            files=files, timeout=60,
        )
        assert rp.status_code == 200, rp.text
        photo_url = rp.json()["url"]
        assert photo_url.startswith("/api/files/")

        # Fetch back
        rf = requests.get(f"{BASE_URL}{photo_url}", timeout=60)
        assert rf.status_code == 200
        assert len(rf.content) > 0

        # Submit E-DO
        rs = requests.post(
            f"{API}/orders/{oid}/edo", headers=_cust_h(customer_token),
            json={
                "signer_name": "TEST Signer",
                "signature_data_url": _TINY_PNG_DATA_URL,
                "photo_urls": [photo_url],
                "accepted_terms": True,
            }, timeout=60,
        )
        assert rs.status_code == 200, rs.text
        data = rs.json()
        assert data["edo"]["signed"] is True
        assert data["status"] == "Delivered"

        # Second signing -> 400
        rs2 = requests.post(
            f"{API}/orders/{oid}/edo", headers=_cust_h(customer_token),
            json={
                "signer_name": "TEST Signer",
                "signature_data_url": _TINY_PNG_DATA_URL,
                "photo_urls": [photo_url],
                "accepted_terms": True,
            }, timeout=30,
        )
        assert rs2.status_code == 400


# ============================================================================
# Invoice PDF
# ============================================================================
class TestInvoicePDF:
    def test_invoice_pdf_download(self, customer_token, sample_order):
        r = requests.get(
            f"{API}/orders/{sample_order['id']}/invoice.pdf",
            headers=_cust_h(customer_token), timeout=60,
        )
        assert r.status_code == 200, r.text
        assert "application/pdf" in r.headers.get("Content-Type", "")
        assert len(r.content) > 100
        assert r.content.startswith(b"%PDF")

    def test_invoice_pdf_forbidden_for_other(self, admin_token, sample_order):
        # Create another customer & login
        email = f"TEST_other_{uuid.uuid4().hex[:6]}@example.com"
        pw = "Passw0rd!"
        r = requests.post(
            f"{API}/customers", headers=_admin_h(admin_token),
            json={"email": email, "password": pw, "name": "OTHER"}, timeout=30,
        )
        assert r.status_code == 200
        rl = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
        other_token = rl.json()["access_token"]
        rp = requests.get(
            f"{API}/orders/{sample_order['id']}/invoice.pdf",
            headers=_cust_h(other_token), timeout=30,
        )
        assert rp.status_code == 403


# ============================================================================
# CSV Imports
# ============================================================================
class TestCSVImport:
    def test_import_products(self, admin_token):
        sku1 = f"TEST-IMP-{uuid.uuid4().hex[:6]}"
        csv_text = (
            "sku,name,description,category,unit,price,image_url,track_stock,stock,variation,variation_price,variation_stock\n"
            f"{sku1},TEST Imported,desc,cat,pc,10.00,,true,0,Small,10.00,20\n"
            f"{sku1},,,,,,,,,Large,15.00,10\n"
        )
        files = {"file": ("prods.csv", csv_text.encode("utf-8"), "text/csv")}
        r = requests.post(
            f"{API}/admin/import/products", headers=_admin_h(admin_token),
            files=files, timeout=60,
        )
        assert r.status_code == 200, r.text
        assert r.json()["imported"] == 1

        # Verify merged variations
        rp = requests.get(f"{API}/products", headers=_admin_h(admin_token), params={"q": sku1}, timeout=30)
        prods = [p for p in rp.json() if p["sku"] == sku1]
        assert len(prods) == 1
        assert len(prods[0]["variations"]) == 2

        # Re-import: existing sku updated in place
        csv_text2 = (
            "sku,name,description,category,unit,price,image_url,track_stock,stock,variation,variation_price,variation_stock\n"
            f"{sku1},TEST Updated,desc,cat,pc,12.00,,true,0,Small,12.00,30\n"
        )
        files2 = {"file": ("prods2.csv", csv_text2.encode("utf-8"), "text/csv")}
        r2 = requests.post(
            f"{API}/admin/import/products", headers=_admin_h(admin_token),
            files=files2, timeout=60,
        )
        assert r2.status_code == 200
        rp2 = requests.get(f"{API}/products", headers=_admin_h(admin_token), params={"q": sku1}, timeout=30)
        prods2 = [p for p in rp2.json() if p["sku"] == sku1]
        assert prods2[0]["name"] == "TEST Updated"

        # cleanup
        requests.delete(f"{API}/products/{prods2[0]['id']}", headers=_admin_h(admin_token), timeout=30)

    def test_import_customers(self, admin_token):
        new_email = f"test_imp_{uuid.uuid4().hex[:6]}@example.com"
        short_pw_email = f"test_short_{uuid.uuid4().hex[:6]}@example.com"
        csv_text = (
            "email,password,name,company,phone,address,payment_terms_days\n"
            f"{new_email},StrongPass1,TEST New,TestCo,123,addr,45\n"
            f"{short_pw_email},abc,TEST Short,TestCo,123,addr,30\n"
            f"{CUSTOMER_EMAIL},,Demo Chef Updated,Demo Restaurant Sdn Bhd,+60123456789,addr,60\n"
        )
        files = {"file": ("customers.csv", csv_text.encode("utf-8"), "text/csv")}
        r = requests.post(
            f"{API}/admin/import/customers", headers=_admin_h(admin_token),
            files=files, timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["imported"] >= 2  # new + existing update
        assert data["failed"] >= 1  # short password rejected
        assert any("short" in e.lower() or "6" in e or "password" in e.lower() for e in data["errors"])

        # New customer can login with StrongPass1 and has 45 days
        rl = requests.post(f"{API}/auth/login", json={"email": new_email, "password": "StrongPass1"}, timeout=30)
        assert rl.status_code == 200
        assert rl.json()["user"]["payment_terms_days"] == 45

        # Existing demo customer still logs in with original password
        rl2 = requests.post(f"{API}/auth/login", json={"email": CUSTOMER_EMAIL, "password": CUSTOMER_PASSWORD}, timeout=30)
        assert rl2.status_code == 200
        assert rl2.json()["user"]["payment_terms_days"] == 60
