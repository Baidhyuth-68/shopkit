"""Every endpoint the admin panel uses. All of them require an admin token.

Sections, in order:
  1. Dashboard        4. Orders
  2. Products         5. Customers & staff
  3. Categories       6. Storefront settings + image uploads
"""
import math
import secrets
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import (
    APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request,
    UploadFile, status,
)
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import i18n, mailer, site_settings
from ..config import MEDIA_DIR, settings as app_settings
from ..database import SessionLocal, get_db
from ..deps import require_admin
from ..crypto import decrypt, encrypt, hash_secret, mask, new_key_pair
from ..models import (
    ApiKey, Category, EmailLog, EmailSettings, EmailTemplate, Language, Order,
    OrderItem, PaymentAttempt, PaymentGateway, Product, ProductImage, PromoCode, User,
)
from ..schemas import (
    AdminUserIn, AdminUserUpdate, CategoryIn, CategoryOut, DashboardOut, OrderOut,
    OrderPage, OrderStatusUpdate, ProductIn, ProductOut, ProductPage, ProductUpdate,
    SettingsUpdate, UploadOut, UserOut, UserPage,
)
from ..schemas import (
    ApiKeyCreatedOut, ApiKeyIn, ApiKeyOut, GatewayIn, GatewayOut, PaymentAttemptOut,
)
from ..schemas import (
    LanguageIn, LanguageOut, LanguagePackIn, LanguagePackOut, LanguageUpdate,
    PromoIn, PromoOut,
)
from ..schemas import (
    EmailLogOut, EmailSendResult, EmailSettingsIn, EmailSettingsOut, EmailTemplateDetail,
    EmailTemplateIn, EmailTemplateOut, EmailTestIn,
)
from ..security import hash_password
from ..serializers import category_out, product_out
from ..utils import money, unique_slug

router = APIRouter(prefix="/api/admin", tags=["Admin"], dependencies=[Depends(require_admin)])

PAID_STATUSES = ("paid", "shipped", "delivered")


# ------------------------------------------------------------ 1. dashboard
@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db)):
    since_30 = datetime.utcnow() - timedelta(days=30)
    since_14 = datetime.utcnow() - timedelta(days=14)
    earning = db.query(Order).filter(Order.status.in_(PAID_STATUSES))

    revenue_total = money(earning.with_entities(func.sum(Order.total)).scalar() or 0)
    revenue_30d = money(
        earning.filter(Order.created_at >= since_30)
        .with_entities(func.sum(Order.total)).scalar() or 0
    )

    # Aggregated in Python so the same code runs on SQLite and Postgres.
    buckets = {(since_14 + timedelta(days=i)).date().isoformat(): 0.0 for i in range(15)}
    for created_at, total in (
        db.query(Order.created_at, Order.total)
        .filter(Order.created_at >= since_14, Order.status.in_(PAID_STATUSES)).all()
    ):
        key = created_at.date().isoformat()
        if key in buckets:
            buckets[key] += total or 0
    revenue_series = [{"date": d, "value": money(v)} for d, v in sorted(buckets.items())]

    top = (
        db.query(OrderItem.product_name,
                 func.sum(OrderItem.quantity).label("units"),
                 func.sum(OrderItem.line_total).label("revenue"))
        .join(Order).filter(Order.status.in_(PAID_STATUSES))
        .group_by(OrderItem.product_name)
        .order_by(func.sum(OrderItem.line_total).desc()).limit(5).all()
    )

    threshold = int(site_settings.get_float(db, "low_stock_threshold", 5))
    low_stock = (
        db.query(Product).filter(Product.is_active.is_(True), Product.stock <= threshold)
        .order_by(Product.stock.asc()).limit(6).all()
    )

    return DashboardOut(
        revenue_total=revenue_total,
        revenue_30d=revenue_30d,
        orders_total=db.query(Order).count(),
        orders_pending=db.query(Order).filter(Order.status == "pending").count(),
        customers_total=db.query(User).filter(User.role == "customer").count(),
        products_total=db.query(Product).count(),
        products_out_of_stock=db.query(Product).filter(Product.stock == 0).count(),
        currency_symbol=site_settings.get(db, "currency_symbol", "₹"),
        revenue_series=revenue_series,
        top_products=[{"name": n, "units": int(u or 0), "revenue": money(r)} for n, u, r in top],
        low_stock=[{"id": p.id, "name": p.name, "stock": p.stock} for p in low_stock],
        recent_orders=db.query(Order).order_by(Order.created_at.desc()).limit(6).all(),
    )


# ------------------------------------------------------------- 2. products
def _apply_gallery(db: Session, product: Product, gallery: list[str]) -> None:
    product.images.clear()
    db.flush()
    for i, url in enumerate([u for u in gallery if u.strip()]):
        product.images.append(ProductImage(url=url.strip(), position=i))


@router.get("/products", response_model=ProductPage)
def admin_list_products(
    db: Session = Depends(get_db),
    q: str | None = None,
    category_id: int | None = None,
    status_filter: str | None = Query(None, pattern="^(active|hidden|out_of_stock)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """Unlike the public list, this returns hidden and out-of-stock products too."""
    query = db.query(Product)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Product.name.ilike(like), Product.sku.ilike(like)))
    if category_id:
        query = query.filter(Product.category_id == category_id)
    if status_filter == "active":
        query = query.filter(Product.is_active.is_(True))
    elif status_filter == "hidden":
        query = query.filter(Product.is_active.is_(False))
    elif status_filter == "out_of_stock":
        query = query.filter(Product.stock == 0)

    total = query.count()
    items = (query.order_by(Product.created_at.desc())
             .offset((page - 1) * page_size).limit(page_size).all())
    return ProductPage(items=[product_out(p) for p in items], total=total, page=page,
                       page_size=page_size, pages=max(1, math.ceil(total / page_size)))


@router.get("/products/{product_id}", response_model=ProductOut)
def admin_get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    return product_out(product)


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    gallery = data.pop("gallery", [])
    product = Product(**data, slug=unique_slug(db, Product, payload.name))
    db.add(product)
    db.flush()
    _apply_gallery(db, product, gallery)
    db.commit()
    db.refresh(product)
    return product_out(product)


@router.patch("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")

    data = payload.model_dump(exclude_unset=True)
    gallery = data.pop("gallery", None)
    if "name" in data and data["name"] and data["name"] != product.name:
        product.slug = unique_slug(db, Product, data["name"], ignore_id=product.id)
    for field, value in data.items():
        setattr(product, field, value)
    if gallery is not None:
        _apply_gallery(db, product, gallery)

    db.commit()
    db.refresh(product)
    return product_out(product)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: Session = Depends(get_db)):
    """Products inside past orders are hidden instead of deleted, so order
    history stays intact."""
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    if db.query(OrderItem).filter(OrderItem.product_id == product_id).first():
        product.is_active = False
        db.commit()
        return
    db.delete(product)
    db.commit()


# ----------------------------------------------------------- 3. categories
@router.get("/categories", response_model=list[CategoryOut])
def admin_list_categories(db: Session = Depends(get_db)):
    rows = (db.query(Category, func.count(Product.id))
            .outerjoin(Product, Product.category_id == Category.id)
            .group_by(Category.id).order_by(Category.sort_order, Category.name).all())
    return [category_out(c, n) for c, n in rows]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryIn, db: Session = Depends(get_db)):
    category = Category(**payload.model_dump(), slug=unique_slug(db, Category, payload.name))
    db.add(category)
    db.commit()
    db.refresh(category)
    return category_out(category, 0)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, payload: CategoryIn, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found.")
    if payload.name != category.name:
        category.slug = unique_slug(db, Category, payload.name, ignore_id=category.id)
    for field, value in payload.model_dump().items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return category_out(category, len(category.products))


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found.")
    db.query(Product).filter(Product.category_id == category_id).update({"category_id": None})
    db.delete(category)
    db.commit()


# --------------------------------------------------------------- 4. orders
@router.get("/orders", response_model=OrderPage)
def admin_list_orders(
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="Order number, customer name or email"),
    order_status: str | None = Query(None, pattern="^(pending|paid|shipped|delivered|returned|cancelled)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = db.query(Order)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Order.order_number.ilike(like),
                                 Order.customer_name.ilike(like),
                                 Order.customer_email.ilike(like)))
    if order_status:
        query = query.filter(Order.status == order_status)

    total = query.count()
    items = (query.order_by(Order.created_at.desc())
             .offset((page - 1) * page_size).limit(page_size).all())
    return OrderPage(items=items, total=total, page=page, page_size=page_size,
                     pages=max(1, math.ceil(total / page_size)))


@router.get("/orders/{order_id}", response_model=OrderOut)
def admin_get_order(order_id: int, db: Session = Depends(get_db)):
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found.")
    return order


@router.patch("/orders/{order_id}/status", response_model=OrderOut)
def set_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Cancelling or accepting a return puts the reserved stock back, and the
    customer gets the matching email if that template is switched on."""
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found.")

    previous = order.status
    restocking = payload.status in ("cancelled", "returned")
    if restocking and previous not in ("cancelled", "returned"):
        for item in order.items:
            product = db.get(Product, item.product_id) if item.product_id else None
            if product:
                product.stock += item.quantity

    order.status = payload.status
    db.commit()
    db.refresh(order)

    # Only on an actual change, so re-saving the same status does not spam.
    template = mailer.STATUS_TEMPLATES.get(payload.status)
    if template and previous != payload.status:
        background.add_task(email_order_task, template, order.id)

    return order


# ---------------------------------------------------- 5. customers & staff
@router.get("/users", response_model=UserPage)
def list_users(
    db: Session = Depends(get_db),
    q: str | None = None,
    role: str | None = Query(None, pattern="^(customer|admin)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = db.query(User)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(User.email.ilike(like), User.full_name.ilike(like)))
    if role:
        query = query.filter(User.role == role)

    total = query.count()
    items = (query.order_by(User.created_at.desc())
             .offset((page - 1) * page_size).limit(page_size).all())
    return UserPage(items=items, total=total, page=page, page_size=page_size,
                    pages=max(1, math.ceil(total / page_size)))


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: AdminUserIn, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "That email already has an account.")
    user = User(email=email, password_hash=hash_password(payload.password),
                full_name=payload.full_name, role=payload.role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

    data = payload.model_dump(exclude_unset=True)
    if password := data.pop("password", None):
        user.password_hash = hash_password(password)

    demoting = data.get("role") == "customer" or data.get("is_active") is False
    if user.role == "admin" and demoting:
        if user.id == current.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own admin access.")
        if db.query(User).filter(User.role == "admin", User.is_active.is_(True)).count() <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The shop needs at least one active admin.")

    for field, value in data.items():
        if value is not None:
            setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    if user.id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account.")
    if user.role == "admin" and db.query(User).filter(User.role == "admin").count() <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The shop needs at least one admin.")
    db.query(Order).filter(Order.user_id == user_id).update({"user_id": None})
    db.delete(user)
    db.commit()


# --------------------------------------------------------------------------
# Background email tasks.
#
# These run after the response has gone out, so a slow mail server never keeps
# a customer waiting. Each opens its own session: the request's session is
# already closed by the time these run, and its objects are detached.
# --------------------------------------------------------------------------
def email_order_task(template_key: str, order_id: int) -> None:
    db = SessionLocal()
    try:
        order = db.get(Order, order_id)
        if order:
            mailer.send_order_email(db, template_key, order)
    finally:
        db.close()


def email_password_reset_task(email: str, name: str, temporary: str) -> None:
    db = SessionLocal()
    try:
        mailer.send_template(db, "password_reset", email, {
            "customer_name": name or "there",
            "customer_email": email,
            "temporary_password": temporary,
        })
    finally:
        db.close()


@router.post("/users/{user_id}/reset-password", summary="Issue a new password")
def reset_user_password(
    user_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Generates a temporary password, emails it to the account if the password
    reset template is switched on, and returns it too so you can read it out if
    the email cannot go."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No user with that id.")

    temporary = secrets.token_urlsafe(9)
    user.password_hash = hash_password(temporary)
    db.commit()
    background.add_task(email_password_reset_task, user.email, user.full_name, temporary)
    return {
        "temporary_password": temporary,
        "detail": "Share this once, then ask them to change it under Your details.",
    }


# ----------------------------------------------- 6. settings & image files
@router.get("/settings", response_model=dict)
def admin_read_settings(db: Session = Depends(get_db)):
    return site_settings.get_all(db)


@router.put("/settings", response_model=dict)
def write_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    """Send only the keys you want changed. Unknown keys are ignored."""
    return site_settings.update(db, payload.values)


@router.post("/uploads", response_model=UploadOut, status_code=status.HTTP_201_CREATED)
async def upload_image(file: UploadFile = File(...)):
    """Saves to backend/media/ and returns a URL you can paste into any
    image field. For production, swap this for S3 — see docs/CODE_MAP.md."""
    if file.content_type not in app_settings.ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Upload a JPG, PNG, WebP, GIF or SVG file.")
    body = await file.read()
    limit = app_settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(body) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Images must be under {app_settings.MAX_UPLOAD_MB} MB.")

    suffix = Path(file.filename or "").suffix.lower() or ".jpg"
    name = f"{uuid.uuid4().hex}{suffix}"
    (MEDIA_DIR / name).write_bytes(body)
    return UploadOut(url=f"/media/{name}", filename=name)


# =====================================================================
# Payment gateways  —  Admin → Payments
#
# Secrets go in encrypted and come back masked. There is no endpoint,
# anywhere, that returns a gateway secret in the clear.
# =====================================================================
NEEDS_KEYS = {"stripe", "razorpay"}

GATEWAY_DEFAULTS = [
    ("stripe", "Card payment (Stripe)", "Secure card payment, processed by Stripe.", 1),
    ("razorpay", "UPI, cards and netbanking (Razorpay)", "You will be taken to Razorpay to pay.", 2),
    ("bank_transfer", "Bank transfer", "Transfer to the account shown, then reply with the reference.", 3),
    ("cod", "Cash on delivery", "Pay the courier when your parcel arrives.", 4),
]


def _ensure_gateways(db: Session) -> None:
    """Create any missing provider rows, so the panel is never empty."""
    existing = {g.provider for g in db.query(PaymentGateway).all()}
    for provider, label, instructions, order in GATEWAY_DEFAULTS:
        if provider not in existing:
            db.add(PaymentGateway(
                provider=provider, label=label, instructions=instructions,
                sort_order=order, is_enabled=(provider == "cod"),
            ))
    db.commit()


def _gateway_out(row: PaymentGateway, base_url: str = "") -> GatewayOut:
    secret = decrypt(row.secret_key_enc)
    return GatewayOut(
        provider=row.provider,
        label=row.label,
        is_enabled=row.is_enabled,
        test_mode=row.test_mode,
        publishable_key=row.publishable_key,
        secret_key_masked=mask(secret),
        webhook_secret_masked=mask(decrypt(row.webhook_secret_enc)),
        instructions=row.instructions,
        needs_keys=row.provider in NEEDS_KEYS,
        has_secret=bool(secret),
        webhook_url=f"{base_url}/api/payments/webhook/{row.provider}" if row.provider in NEEDS_KEYS else "",
    )


def _sync_payment_methods_setting(db: Session) -> None:
    """Keep the older `payment_methods` setting in step with the gateway rows,
    so the storefront keeps working whichever one it reads."""
    enabled = [
        g.provider for g in
        db.query(PaymentGateway).filter(PaymentGateway.is_enabled.is_(True))
        .order_by(PaymentGateway.sort_order).all()
    ]
    site_settings.update(db, {"payment_methods": ",".join(enabled)})


@router.get("/payment-gateways", response_model=list[GatewayOut], summary="List payment gateways")
def list_gateways(request: Request, db: Session = Depends(get_db)):
    _ensure_gateways(db)
    base = str(request.base_url).rstrip("/")
    rows = db.query(PaymentGateway).order_by(PaymentGateway.sort_order, PaymentGateway.provider).all()
    return [_gateway_out(row, base) for row in rows]


@router.put("/payment-gateways/{provider}", response_model=GatewayOut, summary="Save a payment gateway")
def save_gateway(
    provider: str, payload: GatewayIn, request: Request, db: Session = Depends(get_db)
):
    row = db.query(PaymentGateway).filter(PaymentGateway.provider == provider).first()
    if not row:
        row = PaymentGateway(provider=provider)
        db.add(row)

    if payload.is_enabled and provider in NEEDS_KEYS:
        keeping_secret = bool(row.secret_key_enc) and not payload.secret_key
        if not (payload.secret_key or keeping_secret):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Add the {provider} secret key before switching it on.",
            )

    row.label = payload.label or row.label or provider.replace("_", " ").title()
    row.is_enabled = payload.is_enabled
    row.test_mode = payload.test_mode
    row.publishable_key = payload.publishable_key.strip()
    row.instructions = payload.instructions
    # An empty secret means "keep the one already saved".
    if payload.secret_key:
        row.secret_key_enc = encrypt(payload.secret_key.strip())
    if payload.webhook_secret:
        row.webhook_secret_enc = encrypt(payload.webhook_secret.strip())

    db.commit()
    db.refresh(row)
    _sync_payment_methods_setting(db)
    return _gateway_out(row, str(request.base_url).rstrip("/"))


@router.delete(
    "/payment-gateways/{provider}/secrets",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Forget a gateway's saved keys",
)
def clear_gateway_secrets(provider: str, db: Session = Depends(get_db)):
    row = db.query(PaymentGateway).filter(PaymentGateway.provider == provider).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown gateway.")
    row.secret_key_enc = ""
    row.webhook_secret_enc = ""
    row.publishable_key = ""
    row.is_enabled = False
    db.commit()
    _sync_payment_methods_setting(db)


@router.get(
    "/orders/{order_id}/payments",
    response_model=list[PaymentAttemptOut],
    summary="Payment attempts for an order",
)
def order_payments(order_id: int, db: Session = Depends(get_db)):
    return (
        db.query(PaymentAttempt)
        .filter(PaymentAttempt.order_id == order_id)
        .order_by(PaymentAttempt.id.desc())
        .all()
    )


# =====================================================================
# API credentials  —  Admin → API keys
# =====================================================================
VALID_SCOPES = {"catalog:read", "catalog:write", "orders:read", "orders:write"}


def _key_out(row: ApiKey) -> ApiKeyOut:
    return ApiKeyOut(
        id=row.id, name=row.name, key_id=row.key_id, secret_hint=row.secret_hint,
        scopes=row.scope_list, is_active=row.is_active,
        last_used_at=row.last_used_at, created_at=row.created_at,
    )


@router.get("/api-keys", response_model=list[ApiKeyOut], summary="List API credentials")
def list_api_keys(db: Session = Depends(get_db)):
    rows = db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()
    return [_key_out(row) for row in rows]


@router.post(
    "/api-keys",
    response_model=ApiKeyCreatedOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an API credential",
)
def create_api_key(payload: ApiKeyIn, db: Session = Depends(get_db)):
    """The only response that ever contains the secret. It is hashed on save."""
    scopes = [s for s in payload.scopes if s in VALID_SCOPES]
    if not scopes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Pick at least one scope from: {', '.join(sorted(VALID_SCOPES))}.",
        )
    key_id, secret = new_key_pair()
    row = ApiKey(
        name=payload.name.strip(), key_id=key_id, secret_hash=hash_secret(secret),
        secret_hint=secret[-4:], scopes=",".join(scopes),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ApiKeyCreatedOut(
        key=_key_out(row), secret=secret, header_value=f"{key_id}.{secret}"
    )


@router.post("/api-keys/{key_id}/revoke", response_model=ApiKeyOut, summary="Revoke a credential")
def revoke_api_key(key_id: int, db: Session = Depends(get_db)):
    """Stops the key working immediately but keeps the row, so you can still
    see it was used. Use DELETE to remove it entirely."""
    row = db.get(ApiKey, key_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No credential with that id.")
    row.is_active = False
    db.commit()
    db.refresh(row)
    return _key_out(row)


@router.delete("/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a credential")
def delete_api_key(key_id: int, db: Session = Depends(get_db)):
    row = db.get(ApiKey, key_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No credential with that id.")
    db.delete(row)
    db.commit()


# =====================================================================
# Languages  —  Admin → Languages
# =====================================================================
@router.get("/languages", response_model=list[LanguageOut], summary="List languages")
def list_languages(db: Session = Depends(get_db)):
    return db.query(Language).order_by(Language.sort_order, Language.name).all()


@router.post(
    "/languages", response_model=LanguageOut,
    status_code=status.HTTP_201_CREATED, summary="Add a language",
)
def create_language(payload: LanguageIn, db: Session = Depends(get_db)):
    code = payload.code.strip().lower()
    if db.query(Language).filter(Language.code == code).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "That language is already in the list.")
    row = Language(
        code=code, name=payload.name.strip(),
        native_name=(payload.native_name or payload.name).strip(),
        direction=payload.direction, is_enabled=payload.is_enabled,
        sort_order=payload.sort_order,
        is_default=not db.query(Language).first(),  # the very first one wins by default
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/languages/{language_id}", response_model=LanguageOut, summary="Edit a language")
def update_language(language_id: int, payload: LanguageUpdate, db: Session = Depends(get_db)):
    row = db.get(Language, language_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No language with that id.")

    data = payload.model_dump(exclude_none=True)

    if data.get("is_default"):
        # Exactly one default, and it has to be a language shoppers can pick.
        db.query(Language).update({Language.is_default: False})
        data["is_enabled"] = True
    if data.get("is_enabled") is False and row.is_default:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This is the shop's default language. Make another one the default first.",
        )

    for field, value in data.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    if row.is_default:
        site_settings.update(db, {"default_language": row.code})
    return row


@router.delete(
    "/languages/{language_id}",
    status_code=status.HTTP_204_NO_CONTENT, summary="Remove a language",
)
def delete_language(language_id: int, db: Session = Depends(get_db)):
    row = db.get(Language, language_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No language with that id.")
    if row.is_default:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This is the default language. Make another one the default first.",
        )
    db.delete(row)   # its translations go with it
    db.commit()


@router.get(
    "/languages/{language_id}/pack",
    response_model=LanguagePackOut, summary="Strings for one language",
)
def read_language_pack(language_id: int, db: Session = Depends(get_db)):
    row = db.get(Language, language_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No language with that id.")
    translations = i18n.raw_pack(db, row)
    return LanguagePackOut(
        language=row,
        catalogue=i18n.CATALOGUE,
        translations=translations,
        translated=sum(1 for v in translations.values() if v.strip()),
        total=len(i18n.all_keys()),
    )


@router.put(
    "/languages/{language_id}/pack",
    response_model=LanguagePackOut, summary="Save strings for one language",
)
def write_language_pack(language_id: int, payload: LanguagePackIn, db: Session = Depends(get_db)):
    row = db.get(Language, language_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No language with that id.")
    i18n.save_pack(db, row, payload.values)
    return read_language_pack(language_id, db)


# =====================================================================
# Promo codes  —  Admin → Promo codes
# =====================================================================
@router.get("/promos", response_model=list[PromoOut], summary="List promo codes")
def list_promos(db: Session = Depends(get_db)):
    return db.query(PromoCode).order_by(PromoCode.created_at.desc()).all()


@router.post(
    "/promos", response_model=PromoOut,
    status_code=status.HTTP_201_CREATED, summary="Create a promo code",
)
def create_promo(payload: PromoIn, db: Session = Depends(get_db)):
    code = payload.code.strip().upper()
    if db.query(PromoCode).filter(PromoCode.code == code).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "That code already exists.")
    _check_promo_values(payload)
    row = PromoCode(**{**payload.model_dump(), "code": code})
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/promos/{promo_id}", response_model=PromoOut, summary="Edit a promo code")
def update_promo(promo_id: int, payload: PromoIn, db: Session = Depends(get_db)):
    row = db.get(PromoCode, promo_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No code with that id.")
    _check_promo_values(payload)
    code = payload.code.strip().upper()
    clash = db.query(PromoCode).filter(PromoCode.code == code, PromoCode.id != row.id).first()
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, "Another code already uses that word.")
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    row.code = code
    db.commit()
    db.refresh(row)
    return row


@router.delete(
    "/promos/{promo_id}",
    status_code=status.HTTP_204_NO_CONTENT, summary="Delete a promo code",
)
def delete_promo(promo_id: int, db: Session = Depends(get_db)):
    row = db.get(PromoCode, promo_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No code with that id.")
    db.delete(row)
    db.commit()


def _check_promo_values(payload: PromoIn) -> None:
    """Catch the mistakes that would otherwise become a very expensive day."""
    if payload.kind == "percent":
        if not 0 < payload.value <= 100:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "A percentage code needs a value between 1 and 100."
            )
    elif payload.kind == "fixed":
        if payload.value <= 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "A fixed-amount code needs a value above zero."
            )
    if payload.starts_at and payload.ends_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The end date is before the start date.")


# =====================================================================
# System email  —  Admin → System email
# =====================================================================
def _email_settings_out(row: EmailSettings) -> EmailSettingsOut:
    password = decrypt(row.password_enc)
    return EmailSettingsOut(
        is_enabled=row.is_enabled, host=row.host, port=row.port, username=row.username,
        password_masked=mask(password), has_password=bool(password),
        use_tls=row.use_tls, use_ssl=row.use_ssl, from_name=row.from_name,
        from_email=row.from_email, reply_to=row.reply_to, bcc_owner=row.bcc_owner,
    )


@router.get("/email/settings", response_model=EmailSettingsOut, summary="Read SMTP settings")
def read_email_settings(db: Session = Depends(get_db)):
    """Admin only, and the password is masked. These deliberately do not live
    in site settings, which is a public endpoint."""
    return _email_settings_out(mailer.get_settings(db))


@router.put("/email/settings", response_model=EmailSettingsOut, summary="Save SMTP settings")
def write_email_settings(payload: EmailSettingsIn, db: Session = Depends(get_db)):
    row = mailer.get_settings(db)

    if payload.is_enabled and not (payload.host and payload.from_email):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Add an SMTP host and a sender address before switching sending on.",
        )
    if payload.use_ssl and payload.use_tls:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Pick one: STARTTLS (usually port 587) or SSL (usually port 465), not both.",
        )

    for field in ("is_enabled", "host", "port", "username", "use_tls", "use_ssl",
                  "from_name", "from_email", "reply_to", "bcc_owner"):
        setattr(row, field, getattr(payload, field))
    if payload.password:                       # blank keeps the stored one
        row.password_enc = encrypt(payload.password)
    db.commit()
    db.refresh(row)
    return _email_settings_out(row)


@router.get("/email/templates", response_model=list[EmailTemplateOut], summary="List templates")
def list_email_templates(db: Session = Depends(get_db)):
    return db.query(EmailTemplate).order_by(EmailTemplate.id).all()


@router.get(
    "/email/templates/{key}",
    response_model=EmailTemplateDetail,
    summary="One template, with its variables and a preview",
)
def read_email_template(key: str, db: Session = Depends(get_db)):
    row = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No template with that key.")

    spec = next((t for t in mailer.DEFAULT_TEMPLATES if t["key"] == key), {})
    sample = {**mailer.base_values(db), **_sample_values(db)}
    return EmailTemplateDetail(
        **EmailTemplateOut.model_validate(row).model_dump(),
        variables=spec.get("variables", []),
        preview_subject=mailer.render(row.subject, sample),
        preview_body=mailer.render(row.body, sample),
        sample={k: str(v) for k, v in sample.items()},
    )


@router.put("/email/templates/{key}", response_model=EmailTemplateDetail, summary="Save a template")
def write_email_template(key: str, payload: EmailTemplateIn, db: Session = Depends(get_db)):
    row = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No template with that key.")
    row.subject = payload.subject
    row.body = payload.body
    row.is_enabled = payload.is_enabled
    db.commit()
    return read_email_template(key, db)


@router.post("/email/templates/{key}/reset", response_model=EmailTemplateDetail, summary="Restore the original wording")
def reset_email_template(key: str, db: Session = Depends(get_db)):
    row = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    spec = next((t for t in mailer.DEFAULT_TEMPLATES if t["key"] == key), None)
    if not row or not spec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No template with that key.")
    row.subject, row.body = spec["subject"], spec["body"]
    db.commit()
    return read_email_template(key, db)


@router.post("/email/test", response_model=EmailSendResult, summary="Send a test email")
def send_test_email(payload: EmailTestIn, db: Session = Depends(get_db)):
    """Sent in the foreground on purpose — you want the real error, not a
    background task that fails quietly."""
    if payload.template_key:
        sent, message = mailer.send_template(
            db, payload.template_key, str(payload.to), _sample_values(db)
        )
    else:
        shop = mailer.base_values(db)
        sent, message = mailer.deliver(
            db, str(payload.to),
            f"Test from {shop['site_name']}",
            "If you are reading this, your shop can send email.\n\n"
            f"— {shop['site_name']}",
            key="test",
        )
    return EmailSendResult(sent=sent, message=message)


@router.get("/email/log", response_model=list[EmailLogOut], summary="Recent send attempts")
def email_log(
    db: Session = Depends(get_db),
    email_status: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
):
    query = db.query(EmailLog)
    if email_status:
        query = query.filter(EmailLog.status == email_status)
    return query.order_by(EmailLog.created_at.desc()).limit(limit).all()


def _sample_values(db: Session) -> dict[str, str]:
    """Stand-in content for previews and test sends, taken from a real order
    when there is one so the preview looks like the real thing."""
    symbol = site_settings.get(db, "currency_symbol", "")
    order = db.query(Order).order_by(Order.created_at.desc()).first()
    if order:
        return mailer.order_values(db, order)
    return {
        "customer_name": "Asha Rao",
        "customer_email": "asha@example.org",
        "order_number": "ORD-260821-4K2P",
        "order_items": f"  Beeswax candles, pair x 2 — {symbol}1,280.00",
        "subtotal": f"{symbol}1,280.00", "discount": "—", "promo_code": "—",
        "shipping_fee": "Free", "tax": f"{symbol}0.00", "total": f"{symbol}1,280.00",
        "payment_method": "Cash On Delivery",
        "shipping_address": "Asha Rao\n12 Market Road\nNizamabad\n503001",
        "temporary_password": "a-temporary-one",
    }
