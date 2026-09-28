# The Kitchen Atelier — B2B Wholesale Ordering App

## Purpose
Cross-platform mobile app (Expo + FastAPI + MongoDB) for kitchenware wholesaler "The Kitchen Atelier". Customers browse products, pick variations and quantities, and submit orders. Admin receives orders, updates status, and customers get notified in-app.

## Roles
- **Customer**: register/login, browse products with search + category filter, pick variation & quantity, review cart, submit orders, view status & history, reorder, in-app notifications, edit delivery info
- **Admin** (seeded at startup): dashboard by status, order details, update statuses (9 steps), internal + customer-facing notes, manage products (create/edit/delete/toggle availability, upload photo via Emergent Object Storage), variations & pricing, customer list, price-display toggle, company contact info

## Auth
- Email + password, JWT bearer tokens, Argon2 hashing (pwdlib)
- Registration always creates customer role (admin cannot self-register)
- Admin seeded from backend env at startup

## Backend endpoints (all under /api)
- `/auth/register`, `/auth/login`, `/auth/me` (GET/PUT)
- `/products` (list/get/create/update/delete), `/products/categories`, `/products/upload-image`
- `/files/{path}` — serves images from Emergent Object Storage
- `/orders` (list/create/get), `/orders/{id}/status`, `/orders/{id}/notes`, `/orders/dashboard/summary`
- `/customers` (admin only), `/notifications`, `/notifications/{id}/read`
- `/settings` (get/update), `/order-statuses`

## Order lifecycle (9 statuses)
Order Received → Under Review → Confirmed → Preparing → Ready for Delivery → Dispatched → Delivered → Completed (or Cancelled at any point). Every status change appends to `status_history` with timestamp + admin email + optional customer-facing note, and creates an in-app notification.

## Storage
- MongoDB collections: users, products, orders, notifications, settings, counters
- Product images: Emergent Object Storage (via backend upload endpoint)
- Auto-incrementing `order_number` (KA-000001, KA-000002 …) via counters collection

## Demo data seeded at startup (idempotent)
- Admin: `admin@kitchenatelier.com` / `Admin@KA2026`
- Customer: `customer@demo.com` / `Customer@2026`
- 5 demo products, some with size variations

## Frontend structure (Expo Router)
- `/` — auto-redirect based on auth & role
- `/login`, `/register`
- `/customer/(tabs)`: home, products, cart, orders, account (+ product/[id], order/[id], checkout)
- `/admin/(tabs)`: dashboard, orders, products, customers, settings (+ order/[id], product/edit)

## Key features
- Idempotent order submission via `client_ref` — prevents duplicates on double-tap
- Backend validates product existence + availability + quantity on every order
- Customer-facing note field on status update pushes into notifications
- Price display toggle in admin settings — customers see "Price confirmed after review" when off
- Reorder: copy items from an old order into cart
