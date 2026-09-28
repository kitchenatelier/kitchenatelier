"""
Backend tests for the new features on top of the existing suite:

1. Global T&C acceptance (replaces per-E-DO tick):
   - GET /api/auth/me returns must_accept_terms & terms_accepted_at
   - Fresh customer: must_accept_terms=true; after POST /api/auth/accept-terms -> false + timestamp
   - PUT /api/settings changing edo_terms_text bumps edo_terms_updated_at so
     previously-accepted customers must re-accept
   - PUT /api/settings without changing edo_terms_text does NOT bump edo_terms_updated_at
   - Admin never gets must_accept_terms=true
   - POST /api/orders/{id}/edo without accepted_terms works when T&C accepted;
     returns 400 with "accept the T&C" when customer's terms are stale

2. Admin insights endpoints (products-sold, sales-monthly, products-sold.csv):
   - Aggregation correctness
   - Custom date ranges
   - 403 for customer role
   - Zero-order edge cases
   - CSV: text/csv content-type, UTF-8 BOM, expected header, TOTAL row

3. Existing /admin/export/orders.csv respects ?from=&to=
"""
import base64
import io
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://kitchen-atelier-mvp.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@kitchenatelier.com"
ADMIN_PASSWORD = "Admin@KA2026"
DEMO_CUSTOMER_EMAIL = "customer@demo.com"
DEMO_CUSTOMER_PASSWORD = "Customer@2026"


# ---------- Fixtures / Helpers ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_ctx():
    token, user = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    return {"token": token, "user": user, "headers": _headers(token)}


@pytest.fixture(scope="module")
def demo_customer_ctx():
    token, user = _login(DEMO_CUSTOMER_EMAIL, DEMO_CUSTOMER_PASSWORD)
    return {"token": token, "user": user, "headers": _headers(token)}


def _register_new_customer(suffix: str = "") -> dict:
    """Register a fresh customer for T&C tests. Returns ctx dict."""
    uniq = uuid.uuid4().hex[:10]
    email = f"tnc_{suffix}_{uniq}@example.com"
    password = "TestPass@2026"
    body = {
        "email": email, "password": password,
        "name": "T&C Test Chef",
        "company": "T&C Test Co",
        "phone": "+60123456789",
        "address": "1 Test Street, KL",
        "delivery_instructions": "",
    }
    r = requests.post(f"{API}/auth/register", json=body, timeout=30)
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "token": data["access_token"],
        "user": data["user"],
        "headers": _headers(data["access_token"]),
        "email": email,
        "password": password,
    }


# 1x1 PNG data URL for signature
_PNG_1X1 = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


# ============================================================================
# T&C acceptance flow
# ============================================================================
class TestTermsAcceptance:
    """Global T&C acceptance flow."""

    def test_me_returns_terms_fields(self, admin_ctx):
        r = requests.get(f"{API}/auth/me", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert "must_accept_terms" in me
        assert "terms_accepted_at" in me

    def test_admin_never_prompted(self, admin_ctx):
        r = requests.get(f"{API}/auth/me", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200
        assert r.json()["must_accept_terms"] is False

    def test_fresh_customer_must_accept_then_accept(self):
        ctx = _register_new_customer("fresh")
        # Fresh -> must_accept_terms=true
        r = requests.get(f"{API}/auth/me", headers=ctx["headers"], timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert me["must_accept_terms"] is True, f"Expected True, got: {me}"
        assert me["terms_accepted_at"] is None

        # Accept
        r = requests.post(f"{API}/auth/accept-terms", headers=ctx["headers"], timeout=30)
        assert r.status_code == 200
        me2 = r.json()
        assert me2["must_accept_terms"] is False
        assert me2["terms_accepted_at"] is not None

        # Re-check with /me
        r = requests.get(f"{API}/auth/me", headers=ctx["headers"], timeout=30)
        assert r.status_code == 200
        assert r.json()["must_accept_terms"] is False

    def test_admin_terms_text_change_bumps_updated_at(self, admin_ctx):
        # Save original settings text
        r = requests.get(f"{API}/settings", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200
        original = r.json()
        original_terms = original["edo_terms_text"]

        # Fresh customer, accept
        ctx = _register_new_customer("bump")
        r = requests.post(f"{API}/auth/accept-terms", headers=ctx["headers"], timeout=30)
        assert r.status_code == 200
        assert r.json()["must_accept_terms"] is False

        try:
            # Admin changes terms text
            new_text = original_terms + f"\n[Test update {uuid.uuid4().hex[:6]}]"
            r = requests.put(
                f"{API}/settings",
                headers=admin_ctx["headers"],
                json={"edo_terms_text": new_text},
                timeout=30,
            )
            assert r.status_code == 200, r.text
            settings_after = r.json()
            assert settings_after["edo_terms_updated_at"] is not None
            assert settings_after["edo_terms_text"] == new_text

            # Customer /me should now require re-acceptance
            r = requests.get(f"{API}/auth/me", headers=ctx["headers"], timeout=30)
            assert r.status_code == 200
            me = r.json()
            assert me["must_accept_terms"] is True, f"Expected True after terms bump, got: {me}"
        finally:
            # Restore original terms
            requests.put(
                f"{API}/settings",
                headers=admin_ctx["headers"],
                json={"edo_terms_text": original_terms},
                timeout=30,
            )

    def test_put_settings_without_terms_change_does_not_bump(self, admin_ctx):
        # Read current
        r = requests.get(f"{API}/settings", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200
        before = r.json()
        before_bumped = before.get("edo_terms_updated_at")

        # Update an unrelated field
        original_contact = before.get("company_contact") or "The Kitchen Atelier"
        new_contact = original_contact + " "
        try:
            r = requests.put(
                f"{API}/settings",
                headers=admin_ctx["headers"],
                json={"company_contact": new_contact},
                timeout=30,
            )
            assert r.status_code == 200
            after = r.json()
            assert after.get("edo_terms_updated_at") == before_bumped, (
                f"edo_terms_updated_at bumped unexpectedly: before={before_bumped} after={after.get('edo_terms_updated_at')}"
            )

            # Same text put should not bump either
            r = requests.put(
                f"{API}/settings",
                headers=admin_ctx["headers"],
                json={"edo_terms_text": before["edo_terms_text"]},
                timeout=30,
            )
            assert r.status_code == 200
            assert r.json().get("edo_terms_updated_at") == before_bumped
        finally:
            requests.put(
                f"{API}/settings",
                headers=admin_ctx["headers"],
                json={"company_contact": original_contact},
                timeout=30,
            )


# ============================================================================
# E-DO uses global T&C
# ============================================================================
class TestEdoUsesGlobalTerms:
    """E-DO submit no longer requires body.accepted_terms; blocks when T&C stale."""

    def _place_order_and_prepare(self, admin_ctx, ctx):
        """Create an order for ctx customer, advance to Dispatched, upload a photo."""
        # Pick any available product
        r = requests.get(f"{API}/products", headers=ctx["headers"], timeout=30)
        assert r.status_code == 200
        products = r.json()
        assert products, "No products available"
        p = next((x for x in products if x.get("available", True)), products[0])
        variation = p["variations"][0]["name"] if p.get("variations") else ""
        body = {
            "items": [{"product_id": p["id"], "variation": variation, "quantity": 1}],
            "notes": "",
            "client_ref": uuid.uuid4().hex,
        }
        r = requests.post(f"{API}/orders", headers=ctx["headers"], json=body, timeout=30)
        assert r.status_code == 200, f"Order create failed: {r.status_code} {r.text}"
        order = r.json()
        order_id = order["id"]

        # Advance status to Dispatched (admin)
        for status in ["Confirmed", "Preparing", "Ready for Delivery", "Dispatched"]:
            r = requests.put(
                f"{API}/orders/{order_id}/status",
                headers=admin_ctx["headers"],
                json={"status": status},
                timeout=30,
            )
            assert r.status_code == 200, f"Status {status} update failed: {r.status_code} {r.text}"

        # Upload a photo
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        files = {"file": ("photo.png", io.BytesIO(png), "image/png")}
        r = requests.post(
            f"{API}/orders/{order_id}/edo/photo",
            headers={"Authorization": ctx["headers"]["Authorization"]},
            files=files,
            timeout=60,
        )
        assert r.status_code == 200, f"Photo upload failed: {r.status_code} {r.text}"
        photo_url = r.json()["url"]
        return order_id, photo_url

    def test_edo_blocked_when_terms_not_accepted(self, admin_ctx):
        ctx = _register_new_customer("edo_block")
        # Do NOT accept terms
        order_id, photo_url = self._place_order_and_prepare(admin_ctx, ctx)
        # Attempt submit without accepted_terms in body
        r = requests.post(
            f"{API}/orders/{order_id}/edo",
            headers=ctx["headers"],
            json={
                "signer_name": "John",
                "signature_data_url": _PNG_1X1,
                "photo_urls": [photo_url],
            },
            timeout=60,
        )
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"
        assert "T&C" in r.text or "accept" in r.text.lower()

    def test_edo_ok_after_accept_without_accepted_terms_body(self, admin_ctx):
        ctx = _register_new_customer("edo_ok")
        # Accept terms
        r = requests.post(f"{API}/auth/accept-terms", headers=ctx["headers"], timeout=30)
        assert r.status_code == 200
        order_id, photo_url = self._place_order_and_prepare(admin_ctx, ctx)
        # Submit without accepted_terms field -> should default to true and succeed
        r = requests.post(
            f"{API}/orders/{order_id}/edo",
            headers=ctx["headers"],
            json={
                "signer_name": "Jane",
                "signature_data_url": _PNG_1X1,
                "photo_urls": [photo_url],
            },
            timeout=60,
        )
        assert r.status_code == 200, f"E-DO submit failed: {r.status_code} {r.text}"
        assert r.json()["edo"]["signed"] is True


# ============================================================================
# Admin insights
# ============================================================================
class TestAdminInsights:
    """Admin insights: products-sold, sales-monthly, exports."""

    @pytest.fixture(scope="class")
    def seeded_order(self, admin_ctx, demo_customer_ctx):
        """Create a fresh order via demo customer to guarantee data in current month."""
        # Ensure demo customer has accepted terms (safe no-op)
        requests.post(f"{API}/auth/accept-terms", headers=demo_customer_ctx["headers"], timeout=30)

        r = requests.get(f"{API}/products", headers=demo_customer_ctx["headers"], timeout=30)
        assert r.status_code == 200
        products = r.json()
        p = next((x for x in products if x.get("variations")), None) or products[0]
        variation = p["variations"][0]["name"] if p.get("variations") else ""
        qty = 2
        body = {
            "items": [{"product_id": p["id"], "variation": variation, "quantity": qty}],
            "notes": "",
            "client_ref": uuid.uuid4().hex,
        }
        r = requests.post(f"{API}/orders", headers=demo_customer_ctx["headers"], json=body, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        return {
            "order": order,
            "sku": p["sku"],
            "variation": variation,
            "quantity": qty,
            "line_total": order["items"][0]["line_total"],
            "unit_price": order["items"][0]["unit_price"],
        }

    def test_products_sold_default_month(self, admin_ctx, seeded_order):
        r = requests.get(f"{API}/admin/insights/products-sold", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and "total_units" in data and "total_revenue" in data
        # sums check
        sum_units = sum(row["units"] for row in data["rows"])
        sum_rev = round(sum(row["revenue"] for row in data["rows"]), 2)
        assert sum_units == data["total_units"]
        assert abs(sum_rev - data["total_revenue"]) < 0.01
        # sorted by revenue desc
        revs = [row["revenue"] for row in data["rows"]]
        assert revs == sorted(revs, reverse=True)
        # Our seeded order should be in there
        match = [
            row for row in data["rows"]
            if row["sku"] == seeded_order["sku"] and row["variation"] == seeded_order["variation"]
        ]
        assert match, f"Seeded order not found in rows: sku={seeded_order['sku']}"
        assert match[0]["units"] >= seeded_order["quantity"]

    def test_products_sold_range_including_order(self, admin_ctx, seeded_order):
        today = datetime.now(timezone.utc).date().isoformat()
        r = requests.get(
            f"{API}/admin/insights/products-sold",
            headers=admin_ctx["headers"],
            params={"from": today, "to": today},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        match = [row for row in data["rows"] if row["sku"] == seeded_order["sku"]]
        assert match, "Order created today not found in today-range"

    def test_products_sold_range_excluding_order(self, admin_ctx):
        # A range far in the past should have zero rows (assuming no old orders on that day)
        r = requests.get(
            f"{API}/admin/insights/products-sold",
            headers=admin_ctx["headers"],
            params={"from": "2000-01-01", "to": "2000-01-02"},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["rows"] == []
        assert data["total_units"] == 0
        assert data["total_revenue"] == 0.0

    def test_sales_monthly_default_and_shape(self, admin_ctx, seeded_order):
        r = requests.get(
            f"{API}/admin/insights/sales-monthly",
            headers=admin_ctx["headers"],
            params={"months": 6},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["months"] == 6
        series = data["series"]
        assert len(series) == 6
        # Chronological order
        keys = [s["month"] for s in series]
        assert keys == sorted(keys)
        # Each key YYYY-MM
        for k in keys:
            assert len(k) == 7 and k[4] == "-"
        # Current month should have revenue > 0 (we just created an order)
        now = datetime.now(timezone.utc)
        cur_key = f"{now.year:04d}-{now.month:02d}"
        cur = next(s for s in series if s["month"] == cur_key)
        assert cur["revenue"] > 0, f"Expected revenue > 0 for {cur_key}, got {cur}"
        assert cur["orders"] >= 1

    def test_sales_monthly_bounds(self, admin_ctx):
        r = requests.get(
            f"{API}/admin/insights/sales-monthly",
            headers=admin_ctx["headers"],
            params={"months": 1},
            timeout=30,
        )
        assert r.status_code == 200
        assert len(r.json()["series"]) == 1

    def test_products_sold_csv(self, admin_ctx, seeded_order):
        r = requests.get(
            f"{API}/admin/export/products-sold.csv",
            headers=admin_ctx["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("text/csv"), r.headers.get("content-type")
        content = r.content
        # UTF-8 BOM
        assert content.startswith(b"\xef\xbb\xbf"), f"CSV missing UTF-8 BOM (got {content[:10]!r})"
        text = content.decode("utf-8-sig")
        lines = [ln for ln in text.splitlines() if ln.strip() != ""]
        # Header
        assert lines[0] == "sku,product_name,variation,unit,orders,units,revenue", f"Bad header: {lines[0]}"
        # TOTAL row at the end
        assert lines[-1].startswith("TOTAL,"), f"Bad tail: {lines[-1]}"

    def test_insights_forbidden_for_customer(self, demo_customer_ctx):
        for path in [
            "/admin/insights/products-sold",
            "/admin/insights/sales-monthly",
            "/admin/export/products-sold.csv",
        ]:
            r = requests.get(f"{API}{path}", headers=demo_customer_ctx["headers"], timeout=30)
            assert r.status_code == 403, f"{path} -> {r.status_code}"

    def test_empty_range_zero_series(self, admin_ctx):
        # Range with no orders
        r = requests.get(
            f"{API}/admin/insights/products-sold",
            headers=admin_ctx["headers"],
            params={"from": "1999-01-01", "to": "1999-01-02"},
            timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["rows"] == []
        assert data["total_units"] == 0
        assert data["total_revenue"] == 0

        # CSV in same empty range should still be text/csv with BOM+header+TOTAL
        r = requests.get(
            f"{API}/admin/export/products-sold.csv",
            headers=admin_ctx["headers"],
            params={"from": "1999-01-01", "to": "1999-01-02"},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        text = r.content.decode("utf-8-sig")
        lines = [ln for ln in text.splitlines() if ln.strip() != ""]
        assert lines[0] == "sku,product_name,variation,unit,orders,units,revenue"
        assert lines[-1].startswith("TOTAL,")


# ============================================================================
# Orders CSV custom range
# ============================================================================
class TestOrdersCsvRange:
    def test_orders_csv_today_contains_new_order(self, admin_ctx, demo_customer_ctx):
        # Create a fresh order today
        r = requests.get(f"{API}/products", headers=demo_customer_ctx["headers"], timeout=30)
        assert r.status_code == 200
        products = r.json()
        p = products[0]
        variation = p["variations"][0]["name"] if p.get("variations") else ""
        client_ref = uuid.uuid4().hex
        body = {
            "items": [{"product_id": p["id"], "variation": variation, "quantity": 1}],
            "notes": "",
            "client_ref": client_ref,
        }
        r = requests.post(f"{API}/orders", headers=demo_customer_ctx["headers"], json=body, timeout=30)
        assert r.status_code == 200, r.text
        order_number = r.json()["order_number"]

        today = datetime.now(timezone.utc).date().isoformat()
        r = requests.get(
            f"{API}/admin/export/orders.csv",
            headers=admin_ctx["headers"],
            params={"from": today, "to": today},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        text = r.content.decode("utf-8-sig")
        assert order_number in text, f"Order {order_number} not in today's CSV"

    def test_orders_csv_past_range_excludes_new_order(self, admin_ctx, demo_customer_ctx):
        # Make a fresh order
        r = requests.get(f"{API}/products", headers=demo_customer_ctx["headers"], timeout=30)
        p = r.json()[0]
        variation = p["variations"][0]["name"] if p.get("variations") else ""
        body = {
            "items": [{"product_id": p["id"], "variation": variation, "quantity": 1}],
            "notes": "",
            "client_ref": uuid.uuid4().hex,
        }
        r = requests.post(f"{API}/orders", headers=demo_customer_ctx["headers"], json=body, timeout=30)
        assert r.status_code == 200
        order_number = r.json()["order_number"]

        # Past range should exclude the new order
        r = requests.get(
            f"{API}/admin/export/orders.csv",
            headers=admin_ctx["headers"],
            params={"from": "1999-01-01", "to": "1999-01-02"},
            timeout=30,
        )
        assert r.status_code == 200
        text = r.content.decode("utf-8-sig")
        assert order_number not in text
