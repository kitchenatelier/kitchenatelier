"""
The Kitchen Atelier - Backend API
FastAPI + MongoDB + JWT Auth + Emergent Object Storage
"""
import os
import csv
import io
import uuid
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Literal, Annotated, Any, Dict

import jwt
import requests
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from pwdlib import PasswordHash
from pydantic import BaseModel, EmailStr, Field
from pymongo import ASCENDING
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors as rlcolors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
)

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
ORDER_STATUSES: List[str] = [
    "Order Received", "Under Review", "Confirmed", "Preparing",
    "Ready for Delivery", "Dispatched", "Delivered", "Completed", "Cancelled",
]
FINAL_OR_CANCELLED = {"Cancelled"}
POST_DELIVERY_STATUSES = {"Delivered", "Completed"}

DEFAULT_EDO_TERMS = (
    "By signing this Electronic Delivery Order, the customer confirms receipt of the goods "
    "listed in this order. Signing this document — even without the company name written on "
    "the outer packaging — is treated as full and unconditional acknowledgement that all "
    "items have been received in acceptable condition. This signed E-DO may be used as "
    "evidence in any court or dispute-resolution proceeding, including in cases where the "
    "invoice for this order is not paid on or before the due date."
)

# ---------------------------------------------------------------------------
# Storage helpers
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


async def _upload_bytes(prefix: str, data: bytes, content_type: str, ext: str) -> str:
    """Uploads bytes to object storage, returns /api/files/{path} URL."""
    obj_path = f"{APP_NAME}/{prefix}/{uuid.uuid4().hex}.{ext}"
    result = await run_in_threadpool(_put_object_sync, obj_path, data, content_type)
    return f"/api/files/{result['path']}"


# ---------------------------------------------------------------------------
# Pydantic Models
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
    payment_terms_days: int = 30


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


class CustomerCreateIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str
    company: str = ""
    phone: str = ""
    address: str = ""
    delivery_instructions: str = ""
    payment_terms_days: int = 30


class CustomerAdminUpdateIn(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    delivery_instructions: Optional[str] = None
    payment_terms_days: Optional[int] = None


class Variation(BaseModel):
    name: str
    price: float = 0.0
    available: bool = True
    stock: int = 0  # ignored when track_stock=False


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
    track_stock: bool = False
    stock: int = 0  # base stock when there are no variations


class ProductOut(ProductIn):
    id: str
    created_at: datetime
    updated_at: datetime


class OrderItemIn(BaseModel):
    product_id: str
    variation: str = ""
    quantity: int = Field(ge=1)


class OrderCreateIn(BaseModel):
    items: List[OrderItemIn]
    notes: str = ""
    client_ref: str


class OrderItemOut(BaseModel):
    product_id: str
    product_name: str
    sku: str
    variation: str
    quantity: int
    unit: str
    unit_price: float
    line_total: float


class EdoOut(BaseModel):
    signed: bool = False
    signed_at: Optional[datetime] = None
    signer_name: str = ""
    signature_url: str = ""
    photo_urls: List[str] = []
    terms_text: str = ""


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
    payment_terms_days: int = 30
    invoice_issued_at: Optional[datetime] = None
    invoice_due_at: Optional[datetime] = None
    paid: bool = False
    edo: EdoOut = EdoOut()


class StatusUpdateIn(BaseModel):
    status: str
    customer_facing_note: str = ""


class AdminNoteIn(BaseModel):
    admin_notes: Optional[str] = None
    customer_facing_notes: Optional[str] = None


class PaidUpdateIn(BaseModel):
    paid: bool


class OrderItemsUpdateIn(BaseModel):
    items: List[OrderItemIn]  # replaces items; stock adjusted


class EdoSubmitIn(BaseModel):
    signer_name: str
    signature_data_url: str  # base64 data URL, PNG
    photo_urls: List[str]  # previously uploaded via /edo/photo
    accepted_terms: bool


class CustomerPriceIn(BaseModel):
    product_id: str
    variation: str = ""
    price: float


class CustomerPricesUpdateIn(BaseModel):
    prices: List[CustomerPriceIn]


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
    company_address: str
    edo_terms_text: str


class SettingsIn(BaseModel):
    show_prices_to_customers: Optional[bool] = None
    company_contact: Optional[str] = None
    company_phone: Optional[str] = None
    company_email: Optional[str] = None
    company_address: Optional[str] = None
    edo_terms_text: Optional[str] = None


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
        payment_terms_days=int(doc.get("payment_terms_days", 30)),
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
# DTO builders
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
        track_stock=p.get("track_stock", False),
        stock=int(p.get("stock", 0)),
        created_at=p.get("created_at", datetime.now(timezone.utc)),
        updated_at=p.get("updated_at", datetime.now(timezone.utc)),
    )


def _edo_dto(o: dict) -> EdoOut:
    e = o.get("edo") or {}
    return EdoOut(
        signed=bool(e.get("signed", False)),
        signed_at=e.get("signed_at"),
        signer_name=e.get("signer_name", ""),
        signature_url=e.get("signature_url", ""),
        photo_urls=e.get("photo_urls", []),
        terms_text=e.get("terms_text", ""),
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
        payment_terms_days=int(o.get("payment_terms_days", 30)),
        invoice_issued_at=o.get("invoice_issued_at"),
        invoice_due_at=o.get("invoice_due_at"),
        paid=bool(o.get("paid", False)),
        edo=_edo_dto(o),
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
# Stock helpers
# ---------------------------------------------------------------------------
async def _get_stock(product: dict, variation: str) -> Optional[int]:
    """Returns available stock or None if not tracked."""
    if not product.get("track_stock", False):
        return None
    if variation:
        for v in product.get("variations", []):
            if v.get("name") == variation:
                return int(v.get("stock", 0))
        return 0
    return int(product.get("stock", 0))


async def _adjust_stock(product_id: str, variation: str, delta: int) -> None:
    """Adjust stock by delta (positive to restock, negative to consume). Only applies if tracked."""
    prod = await db.products.find_one({"_id": ObjectId(product_id)})
    if not prod or not prod.get("track_stock", False):
        return
    if variation:
        variations = prod.get("variations", [])
        for v in variations:
            if v.get("name") == variation:
                v["stock"] = max(0, int(v.get("stock", 0)) + delta)
        await db.products.update_one(
            {"_id": ObjectId(product_id)}, {"$set": {"variations": variations}},
        )
    else:
        new_stock = max(0, int(prod.get("stock", 0)) + delta)
        await db.products.update_one(
            {"_id": ObjectId(product_id)}, {"$set": {"stock": new_stock}},
        )


async def _resolve_price(customer_id: ObjectId, product: dict, variation: str) -> float:
    """Returns the resolved unit price for a customer + product/variation combo."""
    cp = await db.customer_prices.find_one({
        "customer_id": customer_id,
        "product_id": product["_id"],
        "variation": variation or "",
    })
    if cp and cp.get("price") is not None:
        return float(cp["price"])
    if variation:
        for v in product.get("variations", []):
            if v.get("name") == variation:
                return float(v.get("price", product.get("price", 0.0)))
    return float(product.get("price", 0.0))


async def _validate_and_build_items(customer_id: ObjectId, items_in: List[OrderItemIn]) -> List[dict]:
    built: List[dict] = []
    for it in items_in:
        if not ObjectId.is_valid(it.product_id):
            raise HTTPException(status_code=400, detail=f"Invalid product id: {it.product_id}")
        p = await db.products.find_one({"_id": ObjectId(it.product_id)})
        if not p:
            raise HTTPException(status_code=400, detail=f"Product not found: {it.product_id}")
        if not p.get("available", True):
            raise HTTPException(status_code=400, detail=f"Product unavailable: {p['name']}")
        var_name = ""
        if it.variation:
            var = next((v for v in p.get("variations", []) if v.get("name") == it.variation), None)
            if not var:
                raise HTTPException(status_code=400, detail=f"Variation not found: {it.variation}")
            if not var.get("available", True):
                raise HTTPException(status_code=400, detail=f"Variation unavailable: {it.variation}")
            var_name = var["name"]
        # Stock check
        stock = await _get_stock(p, var_name)
        if stock is not None and stock < it.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Only {stock} in stock for {p['name']}{' (' + var_name + ')' if var_name else ''}",
            )
        unit_price = await _resolve_price(customer_id, p, var_name)
        built.append({
            "product_id": str(p["_id"]),
            "product_name": p["name"],
            "sku": p.get("sku", ""),
            "variation": var_name,
            "quantity": int(it.quantity),
            "unit": p.get("unit", "pcs"),
            "unit_price": unit_price,
            "line_total": round(unit_price * int(it.quantity), 2),
        })
    return built


# ---------------------------------------------------------------------------
# App / Router
# ---------------------------------------------------------------------------
app = FastAPI(title="The Kitchen Atelier API")
api = APIRouter(prefix="/api")


@app.on_event("startup")
async def on_startup():
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.products.create_index([("sku", ASCENDING)])
    await db.orders.create_index([("customer_id", ASCENDING)])
    await db.orders.create_index([("order_number", ASCENDING)], unique=True)
    await db.orders.create_index([("client_ref", ASCENDING)], unique=True, sparse=True)
    await db.notifications.create_index([("customer_id", ASCENDING)])
    await db.customer_prices.create_index(
        [("customer_id", ASCENDING), ("product_id", ASCENDING), ("variation", ASCENDING)],
        unique=True,
    )

    # Seed admin
    if not await db.users.find_one({"email": ADMIN_EMAIL}):
        await db.users.insert_one({
            "email": ADMIN_EMAIL,
            "password_hash": password_hash.hash(ADMIN_PASSWORD),
            "role": "admin",
            "name": "Admin",
            "company": "The Kitchen Atelier",
            "phone": "", "address": "", "delivery_instructions": "",
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
            "payment_terms_days": 30,
            "created_at": datetime.now(timezone.utc),
        })
        logger.info("Seeded demo customer")

    # Ensure existing customers have payment_terms_days field
    await db.users.update_many(
        {"role": "customer", "payment_terms_days": {"$exists": False}},
        {"$set": {"payment_terms_days": 30}},
    )

    # Seed settings
    existing_settings = await db.settings.find_one({"_id": "app"})
    default_settings = {
        "_id": "app",
        "show_prices_to_customers": True,
        "company_contact": "The Kitchen Atelier",
        "company_phone": "+60 3-1234 5678",
        "company_email": "sales@kitchenatelier.com",
        "company_address": "",
        "edo_terms_text": DEFAULT_EDO_TERMS,
    }
    if not existing_settings:
        await db.settings.insert_one(default_settings)
    else:
        # Backfill any missing fields
        missing = {k: v for k, v in default_settings.items() if k != "_id" and k not in existing_settings}
        if missing:
            await db.settings.update_one({"_id": "app"}, {"$set": missing})

    # Seed demo products (idempotent by SKU)
    demo_products = [
        {
            "sku": "SS-PLATE-01", "name": "[DEMO] Stainless Steel Food Plate",
            "description": "Heavy-duty 304 stainless food plate. Restaurant grade.",
            "category": "Plates & Trays",
            "image_url": "https://images.unsplash.com/photo-1584990347193-6bebebfeaeee?w=600",
            "unit": "pc", "price": 12.50, "track_stock": True, "stock": 0,
            "variations": [
                {"name": "16cm", "price": 10.00, "available": True, "stock": 200},
                {"name": "18cm", "price": 11.00, "available": True, "stock": 150},
                {"name": "20cm", "price": 12.50, "available": True, "stock": 100},
                {"name": "22cm", "price": 14.00, "available": True, "stock": 80},
                {"name": "24cm", "price": 16.00, "available": True, "stock": 50},
            ],
        },
        {
            "sku": "SS-POT-01", "name": "[DEMO] Commercial Stock Pot",
            "description": "Induction-ready stainless stock pot with lid.",
            "category": "Pots & Pans",
            "image_url": "https://images.unsplash.com/photo-1584990347193-6bebebfeaeee?w=600",
            "unit": "pc", "price": 89.00, "track_stock": True, "stock": 0,
            "variations": [
                {"name": "20L", "price": 89.00, "available": True, "stock": 40},
                {"name": "30L", "price": 129.00, "available": True, "stock": 25},
                {"name": "50L", "price": 199.00, "available": True, "stock": 10},
            ],
        },
        {
            "sku": "KN-CHEF-01", "name": "[DEMO] Chef's Knife",
            "description": "8-inch high-carbon chef's knife.",
            "category": "Knives & Cutlery",
            "image_url": "https://images.unsplash.com/photo-1593618998160-e34014e67546?w=600",
            "unit": "pc", "price": 45.00, "track_stock": True, "stock": 60,
            "variations": [],
        },
        {
            "sku": "GL-CUP-01", "name": "[DEMO] Tempered Glass Cup",
            "description": "Stackable tempered drinking glass.",
            "category": "Glassware",
            "image_url": "https://images.unsplash.com/photo-1544145945-f90425340c7e?w=600",
            "unit": "dozen", "price": 24.00, "track_stock": True, "stock": 0,
            "variations": [
                {"name": "250ml", "price": 24.00, "available": True, "stock": 100},
                {"name": "350ml", "price": 30.00, "available": True, "stock": 100},
            ],
        },
        {
            "sku": "AP-APR-01", "name": "[DEMO] Chef Apron",
            "description": "Water-resistant canvas apron with adjustable strap.",
            "category": "Apparel",
            "image_url": "https://images.unsplash.com/photo-1621252179027-94459d278660?w=600",
            "unit": "pc", "price": 28.00, "track_stock": False, "stock": 0,
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
        else:
            # Backfill new fields on existing seeds without overwriting user edits
            updates: Dict[str, Any] = {}
            if "track_stock" not in exists:
                updates["track_stock"] = p["track_stock"]
                updates["stock"] = p["stock"]
                if p["variations"] and exists.get("variations"):
                    # add stock to variations if missing
                    new_vars = []
                    for existing_v in exists["variations"]:
                        match = next((sv for sv in p["variations"] if sv["name"] == existing_v.get("name")), None)
                        if match and "stock" not in existing_v:
                            existing_v["stock"] = match["stock"]
                        new_vars.append(existing_v)
                    updates["variations"] = new_vars
            if updates:
                await db.products.update_one({"_id": exists["_id"]}, {"$set": updates})

    logger.info("Startup complete")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# ============================================================================
# Auth
# ============================================================================
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
        "payment_terms_days": 30,
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


# ============================================================================
# Products
# ============================================================================
@api.get("/products", response_model=List[ProductOut])
async def list_products(
    q: str = "", category: str = "",
    user: Annotated[dict, Depends(current_user)] = None,
):
    query: dict = {}
    if user["role"] == "customer":
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
    cats = await db.products.distinct(
        "category", {"available": True} if user["role"] == "customer" else {},
    )
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
    try:
        url = await _upload_bytes("products", data, file.content_type or "image/jpeg", ext)
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 500
        raise HTTPException(status_code=502 if code >= 500 else code, detail=f"Storage error: {code}")
    return {"url": url}


@api.get("/files/{path:path}")
async def get_file(path: str):
    try:
        content, ctype = await run_in_threadpool(_get_object_sync, path)
    except requests.HTTPError:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=content, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})


# ============================================================================
# Orders
# ============================================================================
async def _restock_items(items: List[dict]) -> None:
    for it in items:
        await _adjust_stock(it["product_id"], it.get("variation", ""), int(it["quantity"]))


async def _consume_items(items: List[dict]) -> None:
    for it in items:
        await _adjust_stock(it["product_id"], it.get("variation", ""), -int(it["quantity"]))


@api.post("/orders", response_model=OrderOut)
async def create_order(body: OrderCreateIn, cust: Annotated[dict, Depends(require_customer)]):
    if not body.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")
    if not body.client_ref:
        raise HTTPException(status_code=400, detail="client_ref required")

    existing = await db.orders.find_one({"client_ref": body.client_ref, "customer_id": cust["_id"]})
    if existing:
        return _order_dto(existing)

    items = await _validate_and_build_items(cust["_id"], body.items)
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
        "payment_terms_days": int(cust.get("payment_terms_days", 30)),
        "invoice_issued_at": None,
        "invoice_due_at": None,
        "paid": False,
        "edo": {"signed": False, "photo_urls": [], "signature_url": "", "signer_name": "", "terms_text": ""},
    }
    try:
        result = await db.orders.insert_one(doc)
    except Exception:
        existing = await db.orders.find_one({"client_ref": body.client_ref, "customer_id": cust["_id"]})
        if existing:
            return _order_dto(existing)
        raise
    # Consume stock only after successful insert
    await _consume_items(items)
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
    updates: dict = {"status": body.status, "updated_at": now}

    # Cancelled → restock. Reversing from cancelled back → do NOT re-consume (data integrity).
    if body.status == "Cancelled" and prev != "Cancelled":
        await _restock_items(o.get("items", []))

    # On Confirmed → set invoice issuance/due
    if body.status == "Confirmed" and not o.get("invoice_issued_at"):
        terms_days = int(o.get("payment_terms_days", 30))
        updates["invoice_issued_at"] = now
        updates["invoice_due_at"] = now + timedelta(days=terms_days)

    history_entry = {
        "from": prev, "to": body.status,
        "at": now.isoformat(), "by": "admin", "by_email": admin["email"],
        "note": body.customer_facing_note,
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
    if body.status == "Confirmed" and fresh.get("invoice_due_at"):
        due = fresh["invoice_due_at"].strftime("%d %b %Y")
        msg += f" Invoice due: {due}."
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


@api.put("/orders/{order_id}/paid", response_model=OrderOut)
async def mark_order_paid(order_id: str, body: PaidUpdateIn, admin: Annotated[dict, Depends(require_admin)]):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    now = datetime.now(timezone.utc)
    result = await db.orders.update_one(
        {"_id": ObjectId(order_id)},
        {"$set": {"paid": body.paid, "updated_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    return _order_dto(o)


@api.put("/orders/{order_id}/items", response_model=OrderOut)
async def edit_order_items(order_id: str, body: OrderItemsUpdateIn, admin: Annotated[dict, Depends(require_admin)]):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if o.get("status") == "Cancelled":
        raise HTTPException(status_code=400, detail="Cannot edit a cancelled order")
    if o.get("edo", {}).get("signed"):
        raise HTTPException(status_code=400, detail="Cannot edit an order whose E-DO has been signed")

    # Restock previous items, then re-validate new items (this will re-check stock and consume it)
    await _restock_items(o.get("items", []))
    try:
        new_items = await _validate_and_build_items(o["customer_id"], body.items)
    except HTTPException:
        # Re-consume what we restocked to keep stock consistent
        await _consume_items(o.get("items", []))
        raise

    await _consume_items(new_items)
    total = round(sum(i["line_total"] for i in new_items), 2)
    now = datetime.now(timezone.utc)
    history_entry = {
        "from": o.get("status"), "to": o.get("status"),
        "at": now.isoformat(), "by": "admin", "by_email": admin["email"],
        "note": "Order items updated by admin",
    }
    await db.orders.update_one(
        {"_id": o["_id"]},
        {
            "$set": {"items": new_items, "total_amount": total, "updated_at": now},
            "$push": {"status_history": history_entry},
        },
    )
    fresh = await db.orders.find_one({"_id": o["_id"]})
    await _create_notification(
        fresh,
        f"Your order {fresh['order_number']} was updated by The Kitchen Atelier. New total: RM {total:.2f}.",
    )
    return _order_dto(fresh)


@api.get("/orders/dashboard/summary")
async def dashboard_summary(admin: Annotated[dict, Depends(require_admin)]):
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    counts: Dict[str, int] = {}
    async for row in db.orders.aggregate(pipeline):
        counts[row["_id"]] = row["count"]
    # overdue invoices
    now = datetime.now(timezone.utc)
    overdue = await db.orders.count_documents({
        "paid": False,
        "invoice_due_at": {"$ne": None, "$lt": now},
        "status": {"$nin": ["Cancelled"]},
    })
    unpaid_total_pipeline = [
        {"$match": {"paid": False, "invoice_issued_at": {"$ne": None}, "status": {"$nin": ["Cancelled"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}}},
    ]
    unpaid_total = 0.0
    async for row in db.orders.aggregate(unpaid_total_pipeline):
        unpaid_total = float(row["total"])
    return {
        "counts": counts,
        "total": sum(counts.values()),
        "overdue_count": overdue,
        "unpaid_total": round(unpaid_total, 2),
    }


# ============================================================================
# E-DO (Electronic Delivery Order)
# ============================================================================
@api.post("/orders/{order_id}/edo/photo")
async def upload_edo_photo(
    order_id: str,
    file: UploadFile = File(...),
    user: Annotated[dict, Depends(current_user)] = None,
):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if user["role"] == "customer" and o["customer_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "webp"}:
        ext = "jpg"
    try:
        url = await _upload_bytes(
            f"edo/{order_id}/photos", data, file.content_type or "image/jpeg", ext,
        )
    except requests.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Storage error")
    return {"url": url}


def _decode_data_url(data_url: str) -> tuple[bytes, str, str]:
    """Parse data:image/png;base64,XXXX. Returns (bytes, content_type, ext)."""
    import base64
    if not data_url.startswith("data:"):
        raise HTTPException(status_code=400, detail="Signature must be a data URL")
    try:
        header, b64 = data_url.split(",", 1)
        content_type = header.split(":", 1)[1].split(";", 1)[0]
        ext = content_type.split("/", 1)[1]
        data = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature data URL")
    if ext not in {"png", "jpeg", "jpg"}:
        raise HTTPException(status_code=400, detail="Unsupported signature format")
    return data, content_type, ext


@api.post("/orders/{order_id}/edo", response_model=OrderOut)
async def submit_edo(order_id: str, body: EdoSubmitIn, cust: Annotated[dict, Depends(require_customer)]):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if o["customer_id"] != cust["_id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    if o.get("edo", {}).get("signed"):
        raise HTTPException(status_code=400, detail="This E-DO has already been signed")
    if o.get("status") not in POST_DELIVERY_STATUSES and o.get("status") not in {"Dispatched", "Ready for Delivery"}:
        # Allow signing once the goods are on the way / delivered
        raise HTTPException(status_code=400, detail="Order is not yet ready to be signed")
    if not body.accepted_terms:
        raise HTTPException(status_code=400, detail="You must accept the terms")
    if not body.signer_name.strip():
        raise HTTPException(status_code=400, detail="Signer name is required")
    if not body.photo_urls:
        raise HTTPException(status_code=400, detail="Please upload at least one photo of the received goods")

    sig_bytes, sig_ct, sig_ext = _decode_data_url(body.signature_data_url)
    try:
        sig_url = await _upload_bytes(f"edo/{order_id}/signature", sig_bytes, sig_ct, sig_ext)
    except requests.HTTPError:
        raise HTTPException(status_code=502, detail="Signature upload failed")

    settings = await db.settings.find_one({"_id": "app"}) or {}
    terms_text = settings.get("edo_terms_text", DEFAULT_EDO_TERMS)
    now = datetime.now(timezone.utc)
    edo_doc = {
        "signed": True, "signed_at": now,
        "signer_name": body.signer_name.strip(),
        "signature_url": sig_url,
        "photo_urls": body.photo_urls,
        "terms_text": terms_text,
    }
    status_update: dict = {"edo": edo_doc, "updated_at": now}
    # Auto-advance status to Delivered if not yet
    if o.get("status") not in POST_DELIVERY_STATUSES:
        status_update["status"] = "Delivered"
    history_entry = {
        "from": o.get("status"),
        "to": status_update.get("status", o.get("status")),
        "at": now.isoformat(), "by": "customer", "by_email": cust["email"],
        "note": f"E-DO signed by {body.signer_name.strip()}",
    }
    await db.orders.update_one(
        {"_id": o["_id"]},
        {"$set": status_update, "$push": {"status_history": history_entry}},
    )
    fresh = await db.orders.find_one({"_id": o["_id"]})
    return _order_dto(fresh)


# ============================================================================
# Invoice PDF
# ============================================================================
def _build_invoice_pdf(order: dict, customer: dict, settings: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=15 * mm, leftMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Invoice {order['order_number']}",
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=20, textColor=rlcolors.HexColor("#BF5D39"), alignment=0)
    normal = styles["Normal"]
    small = ParagraphStyle("small", parent=normal, fontSize=9, textColor=rlcolors.HexColor("#666666"))
    body: List[Any] = []

    body.append(Paragraph("The Kitchen Atelier", h1))
    body.append(Paragraph(settings.get("company_contact", ""), small))
    if settings.get("company_phone"):
        body.append(Paragraph(settings["company_phone"], small))
    if settings.get("company_email"):
        body.append(Paragraph(settings["company_email"], small))
    if settings.get("company_address"):
        body.append(Paragraph(settings["company_address"], small))
    body.append(Spacer(1, 8 * mm))

    body.append(Paragraph(f"<b>INVOICE / ORDER {order['order_number']}</b>", normal))
    issued = order.get("invoice_issued_at")
    due = order.get("invoice_due_at")
    created = order.get("created_at")
    body.append(Paragraph(f"Order date: {created.strftime('%d %b %Y') if created else '-'}", small))
    if issued:
        body.append(Paragraph(f"Invoice issued: {issued.strftime('%d %b %Y')}", small))
    if due:
        body.append(Paragraph(f"Payment due: {due.strftime('%d %b %Y')} ({order.get('payment_terms_days', 30)} days)", small))
    body.append(Paragraph(f"Status: {order.get('status')}  •  Paid: {'Yes' if order.get('paid') else 'No'}", small))
    body.append(Spacer(1, 6 * mm))

    body.append(Paragraph("<b>Bill to</b>", normal))
    body.append(Paragraph(customer.get("name", "") or "-", small))
    if customer.get("company"):
        body.append(Paragraph(customer["company"], small))
    if customer.get("phone"):
        body.append(Paragraph(customer["phone"], small))
    if customer.get("address"):
        body.append(Paragraph(customer["address"], small))
    body.append(Spacer(1, 6 * mm))

    # Items table
    data = [["#", "SKU", "Description", "Qty", "Unit", "Price", "Total"]]
    for idx, it in enumerate(order.get("items", []), start=1):
        desc = it["product_name"] + (f" — {it['variation']}" if it.get("variation") else "")
        data.append([
            str(idx),
            it["sku"],
            desc,
            str(it["quantity"]),
            it["unit"],
            f"RM {it['unit_price']:.2f}",
            f"RM {it['line_total']:.2f}",
        ])
    data.append(["", "", "", "", "", "TOTAL", f"RM {order.get('total_amount', 0.0):.2f}"])

    tbl = Table(data, colWidths=[10 * mm, 25 * mm, 60 * mm, 15 * mm, 15 * mm, 25 * mm, 30 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rlcolors.HexColor("#F2EFE9")),
        ("TEXTCOLOR", (0, 0), (-1, 0), rlcolors.HexColor("#262422")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("GRID", (0, 0), (-1, -2), 0.25, rlcolors.HexColor("#D6CEC3")),
        ("ALIGN", (3, 1), (6, -1), "RIGHT"),
        ("BACKGROUND", (0, -1), (-1, -1), rlcolors.HexColor("#F4DFD7")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ]))
    body.append(tbl)
    body.append(Spacer(1, 6 * mm))

    if order.get("notes"):
        body.append(Paragraph(f"<b>Customer notes:</b> {order['notes']}", small))
    if order.get("customer_facing_notes"):
        body.append(Paragraph(f"<b>From The Kitchen Atelier:</b> {order['customer_facing_notes']}", small))

    body.append(Spacer(1, 8 * mm))
    body.append(Paragraph(
        "Thank you for your business. Please make payment before the due date.",
        small,
    ))

    doc.build(body)
    return buf.getvalue()


@api.get("/orders/{order_id}/invoice.pdf")
async def get_invoice_pdf(order_id: str, user: Annotated[dict, Depends(current_user)]):
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    o = await db.orders.find_one({"_id": ObjectId(order_id)})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if user["role"] == "customer" and o["customer_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    settings = await db.settings.find_one({"_id": "app"}) or {}
    customer = await db.users.find_one({"_id": o["customer_id"]}) or {}
    pdf_bytes = await run_in_threadpool(_build_invoice_pdf, o, customer, settings)
    filename = f"Invoice-{o['order_number']}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ============================================================================
# Customers (admin)
# ============================================================================
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
        "payment_terms_days": int(body.payment_terms_days or 30),
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
            "id": str(u["_id"]),
            "email": u["email"],
            "name": u.get("name", ""),
            "company": u.get("company", ""),
            "phone": u.get("phone", ""),
            "address": u.get("address", ""),
            "delivery_instructions": u.get("delivery_instructions", ""),
            "payment_terms_days": int(u.get("payment_terms_days", 30)),
        })
    return out


@api.get("/customers/{customer_id}")
async def get_customer(customer_id: str, admin: Annotated[dict, Depends(require_admin)]):
    if not ObjectId.is_valid(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")
    u = await db.users.find_one({"_id": ObjectId(customer_id), "role": "customer"})
    if not u:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {
        "id": str(u["_id"]), "email": u["email"], "name": u.get("name", ""),
        "company": u.get("company", ""), "phone": u.get("phone", ""),
        "address": u.get("address", ""), "delivery_instructions": u.get("delivery_instructions", ""),
        "payment_terms_days": int(u.get("payment_terms_days", 30)),
    }


@api.put("/customers/{customer_id}")
async def admin_update_customer(
    customer_id: str, body: CustomerAdminUpdateIn,
    admin: Annotated[dict, Depends(require_admin)],
):
    if not ObjectId.is_valid(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if updates:
        await db.users.update_one(
            {"_id": ObjectId(customer_id), "role": "customer"}, {"$set": updates},
        )
    return await get_customer(customer_id, admin)


@api.get("/customers/{customer_id}/prices")
async def get_customer_prices(customer_id: str, admin: Annotated[dict, Depends(require_admin)]):
    if not ObjectId.is_valid(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")
    out = []
    async for cp in db.customer_prices.find({"customer_id": ObjectId(customer_id)}):
        out.append({
            "product_id": str(cp["product_id"]),
            "variation": cp.get("variation", ""),
            "price": float(cp["price"]),
        })
    return out


@api.put("/customers/{customer_id}/prices")
async def set_customer_prices(
    customer_id: str, body: CustomerPricesUpdateIn,
    admin: Annotated[dict, Depends(require_admin)],
):
    if not ObjectId.is_valid(customer_id):
        raise HTTPException(status_code=404, detail="Customer not found")
    cust_oid = ObjectId(customer_id)
    # Replace strategy: delete all then re-insert to keep it simple
    await db.customer_prices.delete_many({"customer_id": cust_oid})
    docs = []
    for p in body.prices:
        if not ObjectId.is_valid(p.product_id):
            continue
        if p.price is None or p.price < 0:
            continue
        docs.append({
            "customer_id": cust_oid,
            "product_id": ObjectId(p.product_id),
            "variation": (p.variation or "").strip(),
            "price": float(p.price),
        })
    if docs:
        await db.customer_prices.insert_many(docs)
    return {"count": len(docs)}


# ============================================================================
# CSV Import (admin)
# ============================================================================
async def _read_csv(file: UploadFile) -> List[Dict[str, str]]:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    rows: List[Dict[str, str]] = []
    for r in reader:
        clean: Dict[str, str] = {}
        for k, v in r.items():
            if k is None:
                continue
            if isinstance(v, list):
                v = ",".join(str(x) for x in v)
            clean[str(k).strip()] = (str(v) if v is not None else "").strip()
        rows.append(clean)
    return rows


@api.post("/admin/import/products")
async def import_products_csv(
    file: UploadFile = File(...),
    admin: Annotated[dict, Depends(require_admin)] = None,
):
    """
    CSV columns:
      sku, name, description, category, unit, price, image_url,
      track_stock (true/false), stock,
      variation, variation_price, variation_stock

    A product with multiple variations occupies multiple rows sharing the same SKU;
    fill product fields on the first row only (they are inherited if blank).
    """
    rows = await _read_csv(file)
    ok, failed = 0, 0
    errors: List[str] = []
    now = datetime.now(timezone.utc)
    grouped: Dict[str, Dict[str, Any]] = {}
    for i, r in enumerate(rows, start=2):  # header is row 1
        sku = (r.get("sku") or "").strip()
        if not sku:
            failed += 1
            errors.append(f"Row {i}: missing sku")
            continue
        prod = grouped.setdefault(sku, {
            "sku": sku, "name": "", "description": "", "category": "",
            "unit": "pcs", "price": 0.0, "image_url": "",
            "track_stock": False, "stock": 0, "variations": [],
        })
        if r.get("name"):
            prod["name"] = r["name"]
        if r.get("description"):
            prod["description"] = r["description"]
        if r.get("category"):
            prod["category"] = r["category"]
        if r.get("unit"):
            prod["unit"] = r["unit"]
        if r.get("image_url"):
            prod["image_url"] = r["image_url"]
        try:
            if r.get("price"):
                prod["price"] = float(r["price"])
        except ValueError:
            pass
        if r.get("track_stock"):
            prod["track_stock"] = str(r["track_stock"]).lower() in {"true", "yes", "1", "y"}
        try:
            if r.get("stock"):
                prod["stock"] = int(float(r["stock"]))
        except ValueError:
            pass
        if r.get("variation"):
            try:
                vprice = float(r.get("variation_price") or prod["price"] or 0)
            except ValueError:
                vprice = prod["price"] or 0
            try:
                vstock = int(float(r.get("variation_stock") or 0))
            except ValueError:
                vstock = 0
            prod["variations"].append({
                "name": r["variation"], "price": vprice, "available": True, "stock": vstock,
            })

    for sku, p in grouped.items():
        if not p["name"]:
            failed += 1
            errors.append(f"SKU {sku}: missing name")
            continue
        existing = await db.products.find_one({"sku": sku})
        payload = {
            **p, "available": True,
            "updated_at": now,
        }
        if existing:
            await db.products.update_one({"_id": existing["_id"]}, {"$set": payload})
        else:
            payload["created_at"] = now
            payload["is_demo"] = False
            await db.products.insert_one(payload)
        ok += 1
    return {"imported": ok, "failed": failed, "errors": errors[:20]}


@api.post("/admin/import/customers")
async def import_customers_csv(
    file: UploadFile = File(...),
    admin: Annotated[dict, Depends(require_admin)] = None,
):
    """
    CSV columns: email, password, name, company, phone, address, payment_terms_days
    - existing emails are updated (name/company/phone/address/payment_terms_days)
    - password is set only for NEW users (or when password is provided and non-empty).
    """
    rows = await _read_csv(file)
    ok, failed = 0, 0
    errors: List[str] = []
    now = datetime.now(timezone.utc)
    for i, r in enumerate(rows, start=2):
        email = (r.get("email") or "").strip().lower()
        if not email or "@" not in email:
            failed += 1
            errors.append(f"Row {i}: invalid email")
            continue
        name = (r.get("name") or "").strip()
        if not name:
            failed += 1
            errors.append(f"Row {i}: missing name")
            continue
        password = (r.get("password") or "").strip()
        try:
            terms = int(r.get("payment_terms_days") or 30)
        except ValueError:
            terms = 30
        existing = await db.users.find_one({"email": email})
        update_doc: Dict[str, Any] = {
            "name": name, "company": r.get("company", ""), "phone": r.get("phone", ""),
            "address": r.get("address", ""), "payment_terms_days": terms,
        }
        if existing:
            if existing.get("role") != "customer":
                failed += 1
                errors.append(f"Row {i}: {email} is not a customer account")
                continue
            if password:
                update_doc["password_hash"] = password_hash.hash(password)
            await db.users.update_one({"_id": existing["_id"]}, {"$set": update_doc})
        else:
            if not password:
                failed += 1
                errors.append(f"Row {i}: password required for new customer {email}")
                continue
            if len(password) < 6:
                failed += 1
                errors.append(f"Row {i}: password too short for {email}")
                continue
            await db.users.insert_one({
                "email": email, "role": "customer",
                "password_hash": password_hash.hash(password),
                "delivery_instructions": r.get("delivery_instructions", ""),
                "created_at": now, "created_by_admin": admin["email"],
                **update_doc,
            })
        ok += 1
    return {"imported": ok, "failed": failed, "errors": errors[:20]}


# ============================================================================
# Admin: Exports & Insights
# ============================================================================
def _parse_range(from_: Optional[str], to_: Optional[str]) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    if from_:
        try:
            start = datetime.strptime(from_, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'from' (YYYY-MM-DD)")
    else:
        start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    if to_:
        try:
            end = datetime.strptime(to_, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'to' (YYYY-MM-DD)")
    else:
        end = start + timedelta(days=1)
    if end <= start:
        raise HTTPException(status_code=400, detail="'to' must be on/after 'from'")
    return start, end


@api.get("/admin/export/orders.csv")
async def export_orders_csv(
    admin: Annotated[dict, Depends(require_admin)],
    from_: Optional[str] = Query(None, alias="from"),
    to_: Optional[str] = Query(None, alias="to"),
):
    """CSV export: one row per order line. Default range = today (UTC)."""
    start, end = _parse_range(from_, to_)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "order_number", "order_date", "status", "paid",
        "customer_company", "customer_name", "customer_email",
        "customer_phone", "customer_address",
        "sku", "product_name", "variation", "quantity", "unit",
        "unit_price", "line_total", "order_total",
        "invoice_issued_at", "invoice_due_at", "payment_terms_days",
        "customer_notes", "admin_customer_note",
    ])
    cursor = db.orders.find({"created_at": {"$gte": start, "$lt": end}}).sort("created_at", 1)
    async for o in cursor:
        common = [
            o.get("order_number", ""),
            o.get("created_at").isoformat() if o.get("created_at") else "",
            o.get("status", ""),
            "Yes" if o.get("paid") else "No",
            o.get("customer_company", ""),
            o.get("customer_name", ""),
            o.get("customer_email", ""),
            o.get("customer_phone", ""),
            o.get("customer_address", "").replace("\n", " "),
        ]
        trailing = [
            f"{float(o.get('total_amount', 0.0)):.2f}",
            o.get("invoice_issued_at").isoformat() if o.get("invoice_issued_at") else "",
            o.get("invoice_due_at").isoformat() if o.get("invoice_due_at") else "",
            str(o.get("payment_terms_days", 30)),
            (o.get("notes") or "").replace("\n", " "),
            (o.get("customer_facing_notes") or "").replace("\n", " "),
        ]
        items = o.get("items") or [{}]
        for it in items:
            row = common + [
                it.get("sku", ""),
                it.get("product_name", ""),
                it.get("variation", ""),
                str(it.get("quantity", "")),
                it.get("unit", ""),
                f"{float(it.get('unit_price', 0.0)):.2f}" if it else "",
                f"{float(it.get('line_total', 0.0)):.2f}" if it else "",
            ] + trailing
            writer.writerow(row)
    data = buf.getvalue().encode("utf-8-sig")  # BOM so Excel recognises UTF-8
    filename = f"orders-{start.date().isoformat()}_{(end - timedelta(days=1)).date().isoformat()}.csv"
    return Response(
        content=data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api.get("/admin/insights/top-customers")
async def top_customers(
    admin: Annotated[dict, Depends(require_admin)],
    months: int = 1, limit: int = 10,
):
    if months < 1: months = 1
    if months > 24: months = 24
    if limit < 1: limit = 1
    if limit > 100: limit = 100
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30 * months)
    pipeline = [
        {"$match": {"created_at": {"$gte": since}, "status": {"$ne": "Cancelled"}}},
        {"$group": {
            "_id": "$customer_id",
            "orders_count": {"$sum": 1},
            "total_amount": {"$sum": "$total_amount"},
            "total_units": {"$sum": {"$sum": "$items.quantity"}},
            "last_order_at": {"$max": "$created_at"},
        }},
        {"$sort": {"total_amount": -1}},
        {"$limit": limit},
    ]
    out = []
    async for row in db.orders.aggregate(pipeline):
        cust = await db.users.find_one({"_id": row["_id"]}) or {}
        out.append({
            "customer_id": str(row["_id"]),
            "name": cust.get("name", ""),
            "company": cust.get("company", ""),
            "email": cust.get("email", ""),
            "orders_count": int(row.get("orders_count", 0)),
            "total_units": int(row.get("total_units", 0) or 0),
            "total_amount": round(float(row.get("total_amount", 0.0)), 2),
            "last_order_at": row.get("last_order_at").isoformat() if row.get("last_order_at") else None,
        })
    return {"since": since.isoformat(), "months": months, "customers": out}


# ============================================================================
# Notifications
# ============================================================================
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


# ============================================================================
# Settings
# ============================================================================
@api.get("/settings", response_model=SettingsOut)
async def get_settings(user: Annotated[dict, Depends(current_user)]):
    s = await db.settings.find_one({"_id": "app"}) or {}
    return SettingsOut(
        show_prices_to_customers=s.get("show_prices_to_customers", True),
        company_contact=s.get("company_contact", ""),
        company_phone=s.get("company_phone", ""),
        company_email=s.get("company_email", ""),
        company_address=s.get("company_address", ""),
        edo_terms_text=s.get("edo_terms_text", DEFAULT_EDO_TERMS),
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
        company_address=s.get("company_address", ""),
        edo_terms_text=s.get("edo_terms_text", DEFAULT_EDO_TERMS),
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
