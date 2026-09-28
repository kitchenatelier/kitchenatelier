"""
The Kitchen Atelier - Backend API
FastAPI + MongoDB + JWT Auth + Emergent Object Storage
"""
import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Literal, Annotated

import jwt
import requests
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from pwdlib import PasswordHash
from pydantic import BaseModel, EmailStr, Field
from pymongo import ASCENDING

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("kitchen-atelier")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
JWT_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"].strip().lower()
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
APP_NAME = "kitchen-atelier"
_storage_key: Optional[str] = None

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)

Role = Literal["customer", "admin"]
OrderStatus = Literal[
    "Order Received", "Under Review", "Confirmed", "Preparing",
    "Ready for Delivery", "Dispatched", "Delivered", "Completed", "Cancelled",
]
ORDER_STATUSES: List[str] = [
    "Order Received", "Under Review", "Confirmed", "Preparing",
    "Ready for Delivery", "Dispatched", "Delivered", "Completed", "Cancelled",
]

# ---------------------------------------------------------------------------
# Storage helpers (sync -> run_in_threadpool)
# ---------------------------------------------------------------------------
def _init_storage_sync() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY not set")
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    r.raise_for_status()
    _storage_key = r.json()["storage_key"]
    return _storage_key


def _put_object_sync(path: str, data: bytes, content_type: str) -> dict:
    key = _init_storage_sync()
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if r.status_code == 503:
        # stale key retry once
        global _storage_key
        _storage_key = None
        key = _init_storage_sync()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    r.raise_for_status()
    return r.json()


def _get_object_sync(path: str):
    key = _init_storage_sync()
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------------------
# Pydantic Models (all use string ids to avoid ObjectId serialization issues)
# ---------------------------------------------------------------------------
class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: Role
    name: str = ""
    company: str = ""
    phone: str = ""
    address: str = ""
    delivery_instructions: str = ""


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str
    company: str = ""
    phone: str = ""
    address: str = ""
    delivery_instructions: str = ""


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    delivery_instructions: Optional[str] = None


class Variation(BaseModel):
    name: str  # e.g. "20cm"
    price: float = 0.0
    available: bool = True


class ProductIn(BaseModel):
    sku: str
    name: str
    description: str = ""
    category: str = ""
    image_url: str = ""
    unit: str = "pcs"
    price: float = 0.0
    variations: List[Variation] = []
    available: bool = True
    is_demo: bool = False


class ProductOut(ProductIn):
    id: str
    created_at: datetime
    updated_at: datetime


class OrderItemIn(BaseModel):
    product_id: str
    variation: str = ""  # variation name, may be empty
    quantity: int = Field(ge=1)


class OrderCreateIn(BaseModel):
    items: List[OrderItemIn]
    notes: str = ""
    client_ref: str  # idempotency key to prevent duplicate submissions


class OrderItemOut(BaseModel):
    product_id: str
    product_name: str
    sku: str
    variation: str
    quantity: int
    unit: str
    unit_price: float
    line_total: float


class OrderOut(BaseModel):
    id: str
    order_number: str
    customer_id: str
    customer_name: str
    customer_company: str
    customer_phone: str
    customer_address: str
    items: List[OrderItemOut]
    total_amount: float
    notes: str
    admin_notes: str
    customer_facing_notes: str
    status: str
    status_history: List[dict]
    created_at: datetime
    updated_at: datetime


class StatusUpdateIn(BaseModel):
    status: str
    customer_facing_note: str = ""


class AdminNoteIn(BaseModel):
    admin_notes: Optional[str] = None
    customer_facing_notes: Optional[str] = None


class NotificationOut(BaseModel):
    id: str
    order_id: str
    order_number: str
    status: str
    message: str
    created_at: datetime
    read: bool


class SettingsOut(BaseModel):
    show_prices_to_customers: bool
    company_contact: str
    company_phone: str
    company_email: str


class SettingsIn(BaseModel):
    show_prices_to_customers: Optional[bool] = None
    company_contact: Optional[str] = None
    company_phone: Optional[str] = None
    company_email: Optional[str] = None


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def _make_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "role": role, "iat": now, "exp": now + timedelta(minutes=JWT_MINUTES)},
        JWT_SECRET, algorithm=JWT_ALG,
    )


def _user_public(doc: dict) -> UserOut:
    return UserOut(
        id=str(doc["_id"]),
        email=doc["email"],
        role=doc["role"],
        name=doc.get("name", ""),
        company=doc.get("company", ""),
        phone=doc.get("phone", ""),
        address=doc.get("address", ""),
        delivery_instructions=doc.get("delivery_instructions", ""),
    )


async def current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer_scheme)]
) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        claims = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        uid = claims.get("sub")
        if not uid or not ObjectId.is_valid(uid):
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"_id": ObjectId(uid)})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_admin(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_customer(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Customer access required")
    return user


# ---------------------------------------------------------------------------
# Helpers to build DTOs from Mongo docs
# ---------------------------------------------------------------------------
def _product_dto(p: dict) -> ProductOut:
    return ProductOut(
        id=str(p["_id"]),
        sku=p.get("sku", ""),
        name=p.get("name", ""),
        description=p.get("description", ""),
        category=p.get("category", ""),
        image_url=p.get("image_url", ""),
        unit=p.get("unit", "pcs"),
        price=float(p.get("price", 0.0)),
        variations=[Variation(**v) for v in p.get("variations", [])],
        available=p.get("available", True),
        is_demo=p.get("is_demo", False),
        created_at=p.get("created_at", datetime.now(timezone.utc)),
        updated_at=p.get("updated_at", datetime.now(timezone.utc)),
    )


def _order_dto(o: dict) -> OrderOut:
    items = [OrderItemOut(**i) for i in o.get("items", [])]
    return OrderOut(
        id=str(o["_id"]),
        order_number=o["order_number"],
        customer_id=str(o["customer_id"]),
        customer_name=o.get("customer_name", ""),
        customer_company=o.get("customer_company", ""),
        customer_phone=o.get("customer_phone", ""),
        customer_address=o.get("customer_address", ""),
        items=items,
        total_amount=float(o.get("total_amount", 0.0)),
        notes=o.get("notes", ""),
        admin_notes=o.get("admin_notes", ""),
        customer_facing_notes=o.get("customer_facing_notes", ""),
        status=o.get("status", "Order Received"),
        status_history=o.get("status_history", []),
        created_at=o.get("created_at", datetime.now(timezone.utc)),
        updated_at=o.get("updated_at", datetime.now(timezone.utc)),
    )


async def _next_order_number() -> str:
    result = await db.counters.find_one_and_update(
        {"_id": "order"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = result["seq"] if result else 1
    return f"KA-{seq:06d}"


async def _create_notification(order: dict, message: str) -> None:
    await db.notifications.insert_one({
        "customer_id": order["customer_id"],
        "order_id": str(order["_id"]),
        "order_number": order["order_number"],
        "status": order["status"],
        "message": message,
        "created_at": datetime.now(timezone.utc),
        "read": False,
    })


# ---------------------------------------------------------------------------
# App / Router
# ---------------------------------------------------------------------------
app = FastAPI(title="The Kitchen Atelier API")
api = APIRouter(prefix="/api")


@app.on_event("startup")
async def on_startup():
    # Indexes
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.products.create_index([("sku", ASCENDING)])
    await db.orders.create_index([("customer_id", ASCENDING)])
    await db.orders.create_index([("order_number", ASCENDING)], unique=True)
    await db.orders.create_index([("client_ref", ASCENDING)], unique=True, sparse=True)
    await db.notifications.create_index([("customer_id", ASCENDING)])

    # Seed admin
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing:
        await db.users.insert_one({
            "email": ADMIN_EMAIL,
            "password_hash": password_hash.hash(ADMIN_PASSWORD),
            "role": "admin",
            "name": "Admin",
            "company": "The Kitchen Atelier",
            "phone": "",
            "address": "",
            "delivery_instructions": "",
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded admin user")

    # Seed demo customer
    demo_email = "customer@demo.com"
    if not await db.users.find_one({"email": demo_email}):
        await db.users.insert_one({
            "email": demo_email,
            "password_hash": password_hash.hash("Customer@2026"),
            "role": "customer",
            "name": "Demo Chef",
            "company": "Demo Restaurant Sdn Bhd",
            "phone": "+60123456789",
            "address": "12 Jalan Demo, Kuala Lumpur 50000",
            "delivery_instructions": "Please call before delivery",
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded demo customer")

    # Seed settings
    if not await db.settings.find_one({"_id": "app"}):
        await db.settings.insert_one({
            "_id": "app",
            "show_prices_to_customers": True,
            "company_contact": "The Kitchen Atelier",
            "company_phone": "+60 3-1234 5678",
            "company_email": "sales@kitchenatelier.com",
        })

    # Seed demo products (idempotent by SKU)
    demo_products = [
        {
            "sku": "SS-PLATE-01", "name": "[DEMO] Stainless Steel Food Plate",
            "description": "Heavy-duty 304 stainless food plate. Restaurant grade.",
            "category": "Plates & Trays",
            "image_url": "https://images.unsplash.com/photo-1584990347193-6bebebfeaeee?w=600",
            "unit": "pc", "price": 12.50,
            "variations": [
                {"name": "16cm", "price": 10.00, "available": True},
                {"name": "18cm", "price": 11.00, "available": True},
                {"name": "20cm", "price": 12.50, "available": True},
                {"name": "22cm", "price": 14.00, "available": True},
                {"name": "24cm", "price": 16.00, "available": True},
            ],
        },
        {
            "sku": "SS-POT-01", "name": "[DEMO] Commercial Stock Pot",
            "description": "Induction-ready stainless stock pot with lid.",
            "category": "Pots & Pans",
            "image_url": "https://images.unsplash.com/photo-1584990347193-6bebebfeaeee?w=600",
            "unit": "pc", "price": 89.00,
            "variations": [
                {"name": "20L", "price": 89.00, "available": True},
                {"name": "30L", "price": 129.00, "available": True},
                {"name": "50L", "price": 199.00, "available": True},
            ],
        },
        {
            "sku": "KN-CHEF-01", "name": "[DEMO] Chef's Knife",
            "description": "8-inch high-carbon chef's knife.",
            "category": "Knives & Cutlery",
            "image_url": "https://images.unsplash.com/photo-1593618998160-e34014e67546?w=600",
            "unit": "pc", "price": 45.00,
            "variations": [],
        },
        {
            "sku": "GL-CUP-01", "name": "[DEMO] Tempered Glass Cup",
            "description": "Stackable tempered drinking glass.",
            "category": "Glassware",
            "image_url": "https://images.unsplash.com/photo-1544145945-f90425340c7e?w=600",
            "unit": "dozen", "price": 24.00,
            "variations": [
                {"name": "250ml", "price": 24.00, "available": True},
                {"name": "350ml", "price": 30.00, "available": True},
            ],
        },
        {
            "sku": "AP-APR-01", "name": "[DEMO] Chef Apron",
            "description": "Water-resistant canvas apron with adjustable strap.",
            "category": "Apparel",
            "image_url": "https://images.unsplash.com/photo-1621252179027-94459d278660?w=600",
            "unit": "pc", "price": 28.00,
            "variations": [],
        },
    ]
    now = datetime.now(timezone.utc)
    for p in demo_products:
        exists = await db.products.find_one({"sku": p["sku"]})
        if not exists:
            await db.products.insert_one({
                **p, "available": True, "is_demo": True,
                "created_at": now, "updated_at": now,
            })
    logger.info("Startup complete")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# -------- Auth --------
@api.post("/auth/register", response_model=TokenOut)
async def register(body: RegisterIn):
    email = str(body.email).lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    doc = {
        "email": email,
        "password_hash": password_hash.hash(body.password),
        "role": "customer",
        "name": body.name, "company": body.company, "phone": body.phone,
        "address": body.address, "delivery_instructions": body.delivery_instructions,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.users.insert_one(doc)
    user = await db.users.find_one({"_id": result.inserted_id})
    return TokenOut(access_token=_make_token(str(user["_id"]), user["role"]), user=_user_public(user))


@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    email = str(body.email).lower()
    user = await db.users.find_one({"email": email})
    valid = False
    if user:
        try:
            valid = password_hash.verify(body.password, user["password_hash"])
        except Exception:
            valid = False
    if not user or not valid:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenOut(access_token=_make_token(str(user["_id"]), user["role"]), user=_user_public(user))


@api.get("/auth/me", response_model=UserOut)
async def get_me(user: Annotated[dict, Depends(current_user)]):
    return _user_public(user)


@api.put("/auth/me", response_model=UserOut)
async def update_me(body: UserUpdateIn, user: Annotated[dict, Depends(current_user)]):
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if updates:
        await db.users.update_one({"_id": user["_id"]}, {"$set": updates})
    fresh = await db.users.find_one({"_id": user["_id"]})
    return _user_public(fresh)


# -------- Products --------
@api.get("/products", response_model=List[ProductOut])
async def list_products(
    q: str = "", category: str = "", user: Annotated[dict, Depends(current_user)] = None,
):
    query: dict = {}
    if user["role"] == "customer":
        # customers cannot see inactive; but out of stock still visible
        query["available"] = True
    if category:
        query["category"] = category
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"sku": {"$regex": q, "$options": "i"}},
            {"category": {"$regex": q, "$options": "i"}},
        ]
    cursor = db.products.find(query).sort("name", 1)
    return [_product_dto(p) async for p in cursor]


@api.get("/products/categories", response_model=List[str])
async def list_categories(user: Annotated[dict, Depends(current_user)]):
    cats = await db.products.distinct("category", {"available": True} if user["role"] == "customer" else {})
    return sorted([c for c in cats if c])


@api.get("/products/{product_id}", response_model=ProductOut)
async def get_product(product_id: str, user: Annotated[dict, Depends(current_user)]):
    if not ObjectId.is_valid(product_id):
        raise HTTPException(status_code=404, detail="Product not found")
    p = await db.products.find_one({"_id": ObjectId(product_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_dto(p)


@api.post("/products", response_model=ProductOut)
async def create_product(body: ProductIn, admin: Annotated[dict, Depends(require_admin)]):
    now = datetime.now(timezone.utc)
    doc = body.dict()
    doc.update({"created_at": now, "updated_at": now})
    result = await db.products.insert_one(doc)
    p = await db.products.find_one({"_id": result.inserted_id})
    return _product_dto(p)


@api.put("/products/{product_id}", response_model=ProductOut)
async def update_product(product_id: str, body: ProductIn, admin: Annotated[dict, Depends(require_admin)]):
    if not ObjectId.is_valid(product_id):
        raise HTTPException(status_code=404, detail="Product not found")
    updates = body.dict()
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await db.products.update_one({"_id": ObjectId(product_id)}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    p = await db.products.find_one({"_id": ObjectId(product_id)})
    return _product_dto(p)


@api.delete("/products/{product_id}")
async def delete_product(product_id: str, admin: Annotated[dict, Depends(require_admin)]):
    if not ObjectId.is_valid(product_id):
        raise HTTPException(status_code=404, detail="Product not found")
    result = await db.products.delete_one({"_id": ObjectId(product_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True}


# -------- Product image upload --------
@api.post("/products/upload-image")
async def upload_product_image(
    file: UploadFile = File(...),
    admin: Annotated[dict, Depends(require_admin)] = None,
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "webp", "gif"}:
        ext = "jpg"
    obj_path = f"{APP_NAME}/products/{uuid.uuid4().hex}.{ext}"
    try:
        result = await run_in_threadpool(_put_object_sync, obj_path, data, file.content_type or "image/jpeg")
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 500
        raise HTTPException(status_code=502 if code >= 500 else code, detail=f"Storage error: {code}")
    # Return a URL to fetch via backend proxy
    return {"path": result["path"], "url": f"/api/files/{result['path']}"}


@api.get("/files/{path:path}")
async def get_file(path: str):
    try:
        content, ctype = await run_in_threadpool(_get_object_sync, path)
    except requests.HTTPError:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=content, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})


# -------- Orders --------
async def _validate_and_build_items(items_in: List[OrderItemIn]) -> List[dict]:
    built: List[dict] = []
    for it in items_in:
        if it.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be positive")
        if not ObjectId.is_valid(it.product_id):
            raise HTTPException(status_code=400, detail=f"Invalid product id: {it.product_id}")
        p = await db.products.find_one({"_id": ObjectId(it.product_id)})
        if not p:
            raise HTTPException(status_code=400, detail=f"Product not found: {it.product_id}")
        if not p.get("available", True):
            raise HTTPException(status_code=400, detail=f"Product unavailable: {p['name']}")
        # Resolve price
        unit_price = float(p.get("price", 0.0))
        var_name = ""
        if it.variation:
            var = next((v for v in p.get("variations", []) if v.get("name") == it.variation), None)
            if not var:
                raise HTTPException(status_code=400, detail=f"Variation not found: {it.variation}")
            if not var.get("available", True):
                raise HTTPException(status_code=400, detail=f"Variation unavailable: {it.variation}")
            unit_price = float(var.get("price", unit_price))
            var_name = var["name"]
        built.append({
            "product_id": str(p["_id"]),
            "product_name": p["name"], "sku": p.get("sku", ""),
            "variation": var_name, "quantity": int(it.quantity),
            "unit": p.get("unit", "pcs"),
            "unit_price": unit_price,
            "line_total": round(unit_price * int(it.quantity), 2),
        })
    return built


@api.post("/orders", response_model=OrderOut)
async def create_order(body: OrderCreateIn, cust: Annotated[dict, Depends(require_customer)]):
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")
    if not body.client_ref:
        raise HTTPException(status_code=400, detail="client_ref required")

    # idempotency: return existing order if the same client_ref was already used
    existing = await db.orders.find_one({"client_ref": body.client_ref, "customer_id": cust["_id"]})
    if existing:
        return _order_dto(existing)

    items = await _validate_and_build_items(body.items)
    total = round(sum(i["line_total"] for i in items), 2)
    now = datetime.now(timezone.utc)
    order_number = await _next_order_number()

    doc = {
        "order_number": order_number,
        "client_ref": body.client_ref,
        "customer_id": cust["_id"],
        "customer_email": cust["email"],
        "customer_name": cust.get("name", ""),
        "customer_company": cust.get("company", ""),
        "customer_phone": cust.get("phone", ""),
        "customer_address": cust.get("address", ""),
        "items": items,
        "total_amount": total,
        "notes": body.notes,
        "admin_notes": "",
        "customer_facing_notes": "",
        "status": "Order Received",
        "status_history": [{
            "from": None, "to": "Order Received",
            "at": now.isoformat(), "by": "system", "by_email": cust["email"],
            "note": "Order submitted",
        }],
        "created_at": now, "updated_at": now,
    }
    try:
        result = await db.orders.insert_one(doc)
    except Exception:
        # duplicate client_ref race
        existing = await db.orders.find_one({"client_ref": body.client_ref, "customer_id": cust["_id"]})
        if existing:
            return _order_dto(existing)
        raise
    fresh = await db.orders.find_one({"_id": result.inserted_id})
    await _create_notification(
        fresh, f"Your order {order_number} has been received. We'll update you when there is progress.",
    )
    return _order_dto(fresh)


@api.get("/orders", response_model=List[OrderOut])
async def list_orders(
    user: Annotated[dict, Depends(current_user)],
    status_filter: Optional[str] = None,
    q: Optional[str] = None,
):
    query: dict = {}
    if user["role"] == "customer":
        query["customer_id"] = user["_id"]
    if status_filter:
        query["status"] = status_filter
    if q:
        query["$or"] = [
            {"order_number": {"$regex": q, "$options": "i"}},
            {"customer_name": {"$regex": q, "$options": "i"}},
            {"customer_company": {"$regex": q, "$options": "i"}},
        ]
    cursor = db.orders.find(query).sort("created_at", -1)
    return [_order_dto(o) async for o in cursor]


@api.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: str, user: Annotated[dict, Depends(current_user)]):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if user["role"] == "customer" and o["customer_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    return _order_dto(o)


@api.put("/orders/{order_id}/status", response_model=OrderOut)
async def update_status(order_id: str, body: StatusUpdateIn, admin: Annotated[dict, Depends(require_admin)]):
    if body.status not in ORDER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    prev = o.get("status")
    if prev == body.status:
        return _order_dto(o)
    now = datetime.now(timezone.utc)
    history_entry = {
        "from": prev, "to": body.status,
        "at": now.isoformat(), "by": "admin", "by_email": admin["email"],
        "note": body.customer_facing_note,
    }
    updates: dict = {
        "status": body.status,
        "updated_at": now,
    }
    if body.customer_facing_note:
        updates["customer_facing_notes"] = body.customer_facing_note
    await db.orders.update_one(
        {"_id": o["_id"]},
        {"$set": updates, "$push": {"status_history": history_entry}},
    )
    fresh = await db.orders.find_one({"_id": o["_id"]})
    msg = f"Your order {fresh['order_number']} is now: {body.status}."
    if body.customer_facing_note:
        msg += f" Note: {body.customer_facing_note}"
    await _create_notification(fresh, msg)
    return _order_dto(fresh)


@api.put("/orders/{order_id}/notes", response_model=OrderOut)
async def update_order_notes(order_id: str, body: AdminNoteIn, admin: Annotated[dict, Depends(require_admin)]):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await db.orders.update_one({"_id": ObjectId(order_id)}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    return _order_dto(o)


@api.get("/orders/dashboard/summary")
async def dashboard_summary(admin: Annotated[dict, Depends(require_admin)]):
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    counts = {}
    async for row in db.orders.aggregate(pipeline):
        counts[row["_id"]] = row["count"]
    return {"counts": counts, "total": sum(counts.values())}


# -------- Customers (admin) --------
class CustomerCreateIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str
    company: str = ""
    phone: str = ""
    address: str = ""
    delivery_instructions: str = ""


@api.post("/customers", response_model=UserOut)
async def admin_create_customer(body: CustomerCreateIn, admin: Annotated[dict, Depends(require_admin)]):
    email = str(body.email).lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    doc = {
        "email": email,
        "password_hash": password_hash.hash(body.password),
        "role": "customer",
        "name": body.name, "company": body.company, "phone": body.phone,
        "address": body.address, "delivery_instructions": body.delivery_instructions,
        "created_at": datetime.now(timezone.utc),
        "created_by_admin": admin["email"],
    }
    result = await db.users.insert_one(doc)
    user = await db.users.find_one({"_id": result.inserted_id})
    return _user_public(user)


@api.get("/customers")
async def list_customers(admin: Annotated[dict, Depends(require_admin)], q: str = ""):
    query: dict = {"role": "customer"}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"company": {"$regex": q, "$options": "i"}},
        ]
    out = []
    async for u in db.users.find(query).sort("created_at", -1):
        out.append({
            "id": str(u["_id"]), "email": u["email"], "name": u.get("name", ""),
            "company": u.get("company", ""), "phone": u.get("phone", ""),
            "address": u.get("address", ""),
        })
    return out


# -------- Notifications --------
@api.get("/notifications", response_model=List[NotificationOut])
async def list_notifications(user: Annotated[dict, Depends(current_user)]):
    query = {"customer_id": user["_id"]} if user["role"] == "customer" else {}
    out = []
    async for n in db.notifications.find(query).sort("created_at", -1).limit(100):
        out.append(NotificationOut(
            id=str(n["_id"]), order_id=str(n["order_id"]),
            order_number=n["order_number"], status=n["status"],
            message=n["message"], created_at=n["created_at"], read=n.get("read", False),
        ))
    return out


@api.post("/notifications/{nid}/read")
async def mark_read(nid: str, user: Annotated[dict, Depends(current_user)]):
    if not ObjectId.is_valid(nid):
        raise HTTPException(status_code=404, detail="Notification not found")
    query: dict = {"_id": ObjectId(nid)}
    if user["role"] == "customer":
        query["customer_id"] = user["_id"]
    result = await db.notifications.update_one(query, {"$set": {"read": True}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


# -------- Settings --------
@api.get("/settings", response_model=SettingsOut)
async def get_settings(user: Annotated[dict, Depends(current_user)]):
    s = await db.settings.find_one({"_id": "app"}) or {}
    return SettingsOut(
        show_prices_to_customers=s.get("show_prices_to_customers", True),
        company_contact=s.get("company_contact", ""),
        company_phone=s.get("company_phone", ""),
        company_email=s.get("company_email", ""),
    )


@api.put("/settings", response_model=SettingsOut)
async def update_settings(body: SettingsIn, admin: Annotated[dict, Depends(require_admin)]):
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if updates:
        await db.settings.update_one({"_id": "app"}, {"$set": updates}, upsert=True)
    s = await db.settings.find_one({"_id": "app"}) or {}
    return SettingsOut(
        show_prices_to_customers=s.get("show_prices_to_customers", True),
        company_contact=s.get("company_contact", ""),
        company_phone=s.get("company_phone", ""),
        company_email=s.get("company_email", ""),
    )


@api.get("/order-statuses", response_model=List[str])
async def order_statuses(user: Annotated[dict, Depends(current_user)]):
    return ORDER_STATUSES


@api.get("/")
async def root():
    return {"message": "The Kitchen Atelier API", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
