# The Kitchen Atelier — B2B Wholesale Ordering App

## Purpose
Cross-platform mobile app (Expo + FastAPI + MongoDB) for kitchenware wholesaler "The Kitchen Atelier". Customers browse products, pick variations & quantities, submit orders. Admin receives orders, manages inventory & delivery, invoicing, and dispute-safe E-DO on receipt.

## Roles
- **Customer**: register/login, browse & search products with category filter, pick variation & quantity, review & submit orders, in-app notifications, view invoice PDF & due date, sign the E-DO on receipt (photo + drawn signature + T&C), reorder from history.
- **Admin**: dashboard (orders by 9 statuses + overdue invoices + unpaid total), full order flow with status update / customer-facing note / internal notes / edit line quantities / paid toggle / invoice PDF, product CRUD with per-variation pricing AND per-variation stock, customer manager with per-customer payment terms (days) AND per-customer negotiated prices per product+variation, price display toggle, editable E-DO T&C text, CSV import for products & customers.

## Auth
Email + password, JWT bearer, Argon2 hashing (pwdlib). Admin seeded at startup. Registration always creates customer role.

## Order lifecycle (9 statuses)
Order Received → Under Review → Confirmed → Preparing → Ready for Delivery → Dispatched → Delivered → Completed (or Cancelled). Each change is logged in status_history with admin email + optional customer-facing note, and creates an in-app notification.

## Stock management
- Each product has `track_stock` and either base `stock` (no variations) or per-variation `stock`.
- Order create validates + decrements stock when tracked; blocks with clear error when insufficient.
- Cancelling an order restocks the items.
- Admin `PUT /orders/{id}/items` replaces the line-item list and adjusts stock atomically; rolls back stock changes if any new item is out of stock.

## Invoicing / Timeline
- Every customer has `payment_terms_days` (default 30) editable by admin from the customer detail screen.
- When admin marks the order **Confirmed**, `invoice_issued_at = now` and `invoice_due_at = now + payment_terms_days`.
- Admin can toggle **Paid** on the order. Dashboard shows overdue invoice count + total unpaid amount.
- Any order has a downloadable invoice PDF at `GET /api/orders/{id}/invoice.pdf` (reportlab-generated).

## Customer-specific pricing
- Collection `customer_prices` keyed by (customer_id, product_id, variation).
- Resolved at order-create time; if no override, falls back to variation price or base price.
- Managed from admin → customer detail → "Custom prices" list (per product+variation).

## E-DO (Electronic Delivery Order)
- Customer can sign only when status is Ready for Delivery / Dispatched / Delivered / Completed.
- Flow: type signer name → take/pick 1+ photos of the box → draw signature → accept T&C → submit.
- Backend stores signature PNG in Object Storage, photo URLs, terms snapshot, signed_at, signer_name.
- Signing auto-advances the order to **Delivered**.
- Signing is one-shot (second attempt returns 400).
- Admin can view the signed E-DO (signature + photos) from the order detail.
- The T&C text is editable from Settings and clearly states the signature is binding even without company name on box.

## Bulk CSV Import
- `POST /admin/import/products` — columns: sku,name,description,category,unit,price,track_stock,stock,variation,variation_price,variation_stock. Multiple rows with the same SKU are merged into one product with variations. Update-in-place by SKU.
- `POST /admin/import/customers` — columns: email,password,name,company,phone,address,payment_terms_days. Password required only for new users; existing users keep their password unless a new one is provided. Returns imported/failed counts and per-row errors.

## Storage
MongoDB collections: users, products, orders, notifications, settings, counters, customer_prices. Product images, E-DO photos, and E-DO signatures live in Emergent Object Storage. All non-URL images are proxied via `/api/files/{path}`.

## Backend endpoints (all under /api)
Auth: `/auth/register`, `/auth/login`, `/auth/me` (GET/PUT)
Products: `/products` list/get/create/update/delete, `/products/categories`, `/products/upload-image`
Files: `/files/{path}`
Orders: `/orders` list/create, `/orders/{id}` get, `/orders/{id}/status`, `/orders/{id}/notes`, `/orders/{id}/paid`, `/orders/{id}/items`, `/orders/dashboard/summary`, `/orders/{id}/invoice.pdf`
E-DO: `/orders/{id}/edo/photo`, `/orders/{id}/edo`
Customers (admin): `/customers` list/create, `/customers/{id}` get/update, `/customers/{id}/prices` get/put
CSV: `/admin/import/products`, `/admin/import/customers`
Notifications: `/notifications`, `/notifications/{id}/read`
Settings: `/settings` get/put
Meta: `/order-statuses`

## Demo data seeded at startup (idempotent)
- Admin: `admin@kitchenatelier.com` / `Admin@KA2026`
- Customer: `customer@demo.com` / `Customer@2026` (payment_terms_days: 30)
- 5 demo products with stock (4 track stock; 1 is untracked apparel)

## Frontend structure (Expo Router)
- `/` → auto-redirect on auth & role
- `/login`, `/register`
- `/customer/(tabs)`: home, products, cart, orders, account. Nested: product/[id], order/[id], checkout, edo/[id].
- `/admin/(tabs)`: dashboard, orders, products, customers, settings. Nested: order/[id], product/edit, customer/[id].

## Key libraries added in this iteration
- backend: `reportlab` (invoice PDF)
- frontend: `react-native-signature-canvas` + `react-native-webview` (E-DO signature drawing), `expo-document-picker` (CSV file selection)

## Not built (deferred)
- WhatsApp alerts: deferred by user. Backend already tracks all state (invoice date, due date, status) that a WhatsApp sender would consume. Adding Twilio later is a purely additive change.
