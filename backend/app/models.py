"""Database tables. Add a column here, then see docs/CODE_MAP.md for the
other three files you need to touch to make it show up in the UI.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    role: Mapped[str] = mapped_column(String(20), default="customer")  # customer | admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Default shipping address, reused to prefill checkout
    address_line: Mapped[str] = mapped_column(String(255), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    postal_code: Mapped[str] = mapped_column(String(20), default="")
    country: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    orders: Mapped[list["Order"]] = relationship(back_populates="user")

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    products: Mapped[list["Product"]] = relationship(back_populates="category")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    slug: Mapped[str] = mapped_column(String(220), unique=True, index=True)
    sku: Mapped[str] = mapped_column(String(64), default="")
    short_description: Mapped[str] = mapped_column(String(300), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[float] = mapped_column(Float, default=0.0)
    compare_at_price: Mapped[float | None] = mapped_column(Float, nullable=True)  # struck-through "was" price
    stock: Mapped[int] = mapped_column(Integer, default=0)
    image_url: Mapped[str] = mapped_column(String(500), default="")
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    category: Mapped["Category | None"] = relationship(back_populates="products")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product", cascade="all, delete-orphan", order_by="ProductImage.position"
    )


class ProductImage(Base):
    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(String(500))
    position: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped["Product"] = relationship(back_populates="images")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # pending -> paid -> shipped -> delivered  (or cancelled at any point)
    payment_method: Mapped[str] = mapped_column(String(30), default="cod")

    subtotal: Mapped[float] = mapped_column(Float, default=0.0)
    shipping_fee: Mapped[float] = mapped_column(Float, default=0.0)
    tax: Mapped[float] = mapped_column(Float, default=0.0)
    discount: Mapped[float] = mapped_column(Float, default=0.0)
    promo_code: Mapped[str] = mapped_column(String(40), default="")
    total: Mapped[float] = mapped_column(Float, default=0.0)

    customer_name: Mapped[str] = mapped_column(String(120), default="")
    customer_email: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    address_line: Mapped[str] = mapped_column(String(255), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    postal_code: Mapped[str] = mapped_column(String(20), default="")
    country: Mapped[str] = mapped_column(String(80), default="")
    note: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    user: Mapped["User | None"] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    """Prices and names are copied in, so an order never changes when a
    product is later edited or deleted."""
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    product_name: Mapped[str] = mapped_column(String(200))
    unit_price: Mapped[float] = mapped_column(Float)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    line_total: Mapped[float] = mapped_column(Float)
    image_url: Mapped[str] = mapped_column(String(500), default="")

    order: Mapped["Order"] = relationship(back_populates="items")


class SiteSetting(Base):
    """Key/value store powering the storefront look and shop rules.
    Editable from Admin -> Appearance."""
    __tablename__ = "site_settings"
    __table_args__ = (UniqueConstraint("key", name="uq_site_setting_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(80), index=True)
    value: Mapped[str] = mapped_column(Text, default="")


class PaymentGateway(Base):
    """One row per payment provider, configured from Admin -> Payments.

    Secrets are stored encrypted (see crypto.py) and are never returned by any
    endpoint — the admin panel only ever receives a masked version.
    """
    __tablename__ = "payment_gateways"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    # stripe | razorpay | cod | bank_transfer
    label: Mapped[str] = mapped_column(String(80), default="")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    test_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    publishable_key: Mapped[str] = mapped_column(String(255), default="")
    secret_key_enc: Mapped[str] = mapped_column(Text, default="")
    webhook_secret_enc: Mapped[str] = mapped_column(Text, default="")
    instructions: Mapped[str] = mapped_column(Text, default="")  # shown at checkout
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class PaymentAttempt(Base):
    """A record of each time a customer tried to pay for an order.

    Deliberately a separate table rather than columns on Order, so adding
    payments to an existing shop needs no migration — this table is simply
    created on the next boot.
    """
    __tablename__ = "payment_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40), default="")
    reference: Mapped[str] = mapped_column(String(160), default="", index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # pending | paid | failed | refunded
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    order: Mapped["Order"] = relationship()


class ApiKey(Base):
    """A credential for Postman, a script, or a partner system.

    Sent as a single header:  X-API-Key: <key_id>.<secret>
    Only the hash of the secret is kept, so a leaked database cannot be
    replayed against the API.
    """
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    key_id: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    # Indexed because a caller may present the secret alone, which is
    # looked up by hash. See deps._lookup_api_key.
    secret_hash: Mapped[str] = mapped_column(String(80), index=True)
    secret_hint: Mapped[str] = mapped_column(String(12), default="")
    scopes: Mapped[str] = mapped_column(String(300), default="catalog:read")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def scope_list(self) -> list[str]:
        return [s.strip() for s in (self.scopes or "").split(",") if s.strip()]


class Language(Base):
    """A language the shop can be shown in. Enable it in Admin → Languages and
    a picker appears in the storefront header."""
    __tablename__ = "languages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)  # en, hi, te, ar
    name: Mapped[str] = mapped_column(String(80))          # shown in the dashboard
    native_name: Mapped[str] = mapped_column(String(80))   # shown in the picker
    direction: Mapped[str] = mapped_column(String(3), default="ltr")  # ltr | rtl
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    strings: Mapped[list["Translation"]] = relationship(
        back_populates="language", cascade="all, delete-orphan"
    )


class Translation(Base):
    """One translated string. Anything missing falls back to English, so a
    half-finished pack never shows blanks to a customer."""
    __tablename__ = "translations"
    __table_args__ = (UniqueConstraint("language_id", "key", name="uq_translation_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    language_id: Mapped[int] = mapped_column(ForeignKey("languages.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(80), index=True)
    value: Mapped[str] = mapped_column(Text, default="")

    language: Mapped["Language"] = relationship(back_populates="strings")


class PromoCode(Base):
    """A discount customers type in at checkout.

    The maths is done on the server every time — the browser only ever says
    which code was typed, never what it is worth.
    """
    __tablename__ = "promo_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)  # stored upper case
    description: Mapped[str] = mapped_column(String(200), default="")
    kind: Mapped[str] = mapped_column(String(20), default="percent")
    # percent | fixed | free_shipping
    value: Mapped[float] = mapped_column(Float, default=0.0)      # 10 = 10% or 10 currency units
    min_order_total: Mapped[float] = mapped_column(Float, default=0.0)
    max_discount: Mapped[float] = mapped_column(Float, default=0.0)  # 0 = uncapped
    usage_limit: Mapped[int] = mapped_column(Integer, default=0)     # 0 = unlimited
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    per_customer_limit: Mapped[int] = mapped_column(Integer, default=0)  # 0 = unlimited
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    redemptions: Mapped[list["PromoRedemption"]] = relationship(
        back_populates="promo", cascade="all, delete-orphan"
    )


class PromoRedemption(Base):
    """Written when an order actually uses a code, so usage limits are counted
    against real orders rather than against people clicking Apply."""
    __tablename__ = "promo_redemptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    promo_id: Mapped[int] = mapped_column(ForeignKey("promo_codes.id", ondelete="CASCADE"))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    customer_email: Mapped[str] = mapped_column(String(255), default="")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    promo: Mapped["PromoCode"] = relationship(back_populates="redemptions")


class EmailSettings(Base):
    """SMTP configuration. A single row, id = 1.

    Deliberately its own table rather than a few keys in site_settings:
    `GET /api/settings` is a public endpoint, and an SMTP password has no
    business being one fetch away from anyone on the internet.
    """
    __tablename__ = "email_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    host: Mapped[str] = mapped_column(String(200), default="")
    port: Mapped[int] = mapped_column(Integer, default=587)
    username: Mapped[str] = mapped_column(String(200), default="")
    password_enc: Mapped[str] = mapped_column(Text, default="")
    use_tls: Mapped[bool] = mapped_column(Boolean, default=True)   # STARTTLS on 587
    use_ssl: Mapped[bool] = mapped_column(Boolean, default=False)  # implicit TLS on 465
    from_name: Mapped[str] = mapped_column(String(120), default="")
    from_email: Mapped[str] = mapped_column(String(255), default="")
    reply_to: Mapped[str] = mapped_column(String(255), default="")
    bcc_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class EmailTemplate(Base):
    """One message the shop sends automatically.

    `key` is what the code looks up, and is fixed. Subject and body are yours.
    """
    __tablename__ = "email_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(String(300), default="")
    subject: Mapped[str] = mapped_column(String(300), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class EmailLog(Base):
    """Every send attempt, so 'did the customer get it?' has an answer."""
    __tablename__ = "email_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_key: Mapped[str] = mapped_column(String(60), default="", index=True)
    to_email: Mapped[str] = mapped_column(String(255), default="")
    subject: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(20), default="sent")  # sent | failed | skipped
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
