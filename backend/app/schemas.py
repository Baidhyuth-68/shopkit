"""Request and response shapes. These are what the API docs describe and
what FastAPI validates against — if a field is not here, it will not reach
the database.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

ORM = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ auth
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(default="", max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    model_config = ORM
    id: int
    email: EmailStr
    full_name: str
    phone: str
    role: str
    is_active: bool
    address_line: str
    city: str
    postal_code: str
    country: str
    created_at: datetime


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    address_line: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=80)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


# ------------------------------------------------------------- catalogue
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    sort_order: int = 0
    is_active: bool = True


class CategoryOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    slug: str
    description: str
    sort_order: int
    is_active: bool
    product_count: int = 0


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sku: str = Field(default="", max_length=64)
    short_description: str = Field(default="", max_length=300)
    description: str = ""
    price: float = Field(ge=0)
    compare_at_price: float | None = Field(default=None, ge=0)
    stock: int = Field(default=0, ge=0)
    image_url: str = ""
    gallery: list[str] = []
    category_id: int | None = None
    is_active: bool = True
    is_featured: bool = False


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    sku: str | None = None
    short_description: str | None = None
    description: str | None = None
    price: float | None = Field(default=None, ge=0)
    compare_at_price: float | None = None
    stock: int | None = Field(default=None, ge=0)
    image_url: str | None = None
    gallery: list[str] | None = None
    category_id: int | None = None
    is_active: bool | None = None
    is_featured: bool | None = None


class ProductOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    slug: str
    sku: str
    short_description: str
    description: str
    price: float
    compare_at_price: float | None
    stock: int
    image_url: str
    gallery: list[str] = []
    category_id: int | None
    category_name: str | None = None
    is_active: bool
    is_featured: bool
    in_stock: bool = True
    created_at: datetime


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int
    pages: int


# ------------------------------------------------------------------ cart
class CartLineIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1, le=999)


class CartIn(BaseModel):
    items: list[CartLineIn] = []
    promo_code: str = ""


class CartLineOut(BaseModel):
    product_id: int
    name: str
    slug: str
    image_url: str
    unit_price: float
    quantity: int
    line_total: float
    stock: int
    available: bool
    message: str = ""


class CartOut(BaseModel):
    items: list[CartLineOut]
    subtotal: float
    discount: float = 0.0
    promo_code: str = ""
    promo_message: str = ""
    promo_ok: bool = False
    shipping_fee: float
    tax: float
    total: float
    free_shipping_threshold: float
    currency_symbol: str
    has_problems: bool = False


# ---------------------------------------------------------------- orders
class OrderIn(BaseModel):
    items: list[CartLineIn] = Field(min_length=1)
    customer_name: str = Field(min_length=1, max_length=120)
    customer_email: EmailStr
    phone: str = Field(default="", max_length=40)
    address_line: str = Field(min_length=1, max_length=255)
    city: str = Field(min_length=1, max_length=120)
    postal_code: str = Field(default="", max_length=20)
    country: str = Field(default="", max_length=80)
    note: str = ""
    payment_method: str = "cod"
    promo_code: str = ""


class OrderItemOut(BaseModel):
    model_config = ORM
    product_id: int | None
    product_name: str
    unit_price: float
    quantity: int
    line_total: float
    image_url: str


class OrderOut(BaseModel):
    model_config = ORM
    id: int
    order_number: str
    status: str
    payment_method: str
    subtotal: float
    discount: float = 0.0
    promo_code: str = ""
    shipping_fee: float
    tax: float
    total: float
    customer_name: str
    customer_email: str
    phone: str
    address_line: str
    city: str
    postal_code: str
    country: str
    note: str
    created_at: datetime
    items: list[OrderItemOut] = []


class OrderPage(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
    pages: int


class OrderStatusUpdate(BaseModel):
    status: str = Field(pattern="^(pending|paid|shipped|delivered|returned|cancelled)$")


# ----------------------------------------------------------------- admin
class AdminUserIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = ""
    role: str = Field(default="customer", pattern="^(customer|admin)$")


class AdminUserUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    role: str | None = Field(default=None, pattern="^(customer|admin)$")
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


class UserPage(BaseModel):
    items: list[UserOut]
    total: int
    page: int
    page_size: int
    pages: int


class DashboardOut(BaseModel):
    revenue_total: float
    revenue_30d: float
    orders_total: int
    orders_pending: int
    customers_total: int
    products_total: int
    products_out_of_stock: int
    currency_symbol: str
    revenue_series: list[dict]
    top_products: list[dict]
    low_stock: list[dict]
    recent_orders: list[OrderOut]


class SettingsUpdate(BaseModel):
    values: dict[str, str]


class UploadOut(BaseModel):
    url: str
    filename: str


# ---------------------------------------------------------------- payments
class GatewayIn(BaseModel):
    """Saving a gateway. Leave a secret out (or send null) to keep the stored
    one — that way you can toggle a gateway on and off without re-typing keys."""
    label: str = ""
    is_enabled: bool = False
    test_mode: bool = True
    publishable_key: str = ""
    secret_key: str | None = None
    webhook_secret: str | None = None
    instructions: str = ""


class GatewayOut(BaseModel):
    provider: str
    label: str
    is_enabled: bool
    test_mode: bool
    publishable_key: str
    secret_key_masked: str
    webhook_secret_masked: str
    instructions: str
    needs_keys: bool
    has_secret: bool
    webhook_url: str = ""


class PaymentMethodOut(BaseModel):
    """The safe subset the storefront is allowed to see. No secrets, ever."""
    provider: str
    label: str
    test_mode: bool
    publishable_key: str
    instructions: str


class PaymentIntentOut(BaseModel):
    provider: str
    order_number: str
    amount: float
    currency: str
    reference: str = ""
    publishable_key: str = ""
    next_action: str = "none"
    checkout_payload: dict = {}


class PaymentConfirmIn(BaseModel):
    reference: str = ""
    status: str = Field(default="paid", pattern="^(paid|failed|pending)$")
    note: str = ""


class PaymentAttemptOut(BaseModel):
    id: int
    order_id: int
    provider: str
    reference: str
    status: str
    amount: float
    currency: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# -------------------------------------------------------------- api keys
class ApiKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = ["catalog:read"]


class ApiKeyOut(BaseModel):
    id: int
    name: str
    key_id: str
    secret_hint: str
    scopes: list[str]
    is_active: bool
    last_used_at: datetime | None
    created_at: datetime


class ApiKeyCreatedOut(BaseModel):
    key: ApiKeyOut
    secret: str
    header_name: str = "X-API-Key"
    header_value: str
    warning: str = "Copy this now. Only a hash is stored, so it cannot be shown again."


TokenOut.model_rebuild()


# ------------------------------------------------------------- languages
class LanguageIn(BaseModel):
    code: str = Field(min_length=2, max_length=12)
    name: str = Field(min_length=1, max_length=80)
    native_name: str = Field(default="", max_length=80)
    direction: str = Field(default="ltr", pattern="^(ltr|rtl)$")
    is_enabled: bool = False
    sort_order: int = 0


class LanguageUpdate(BaseModel):
    name: str | None = None
    native_name: str | None = None
    direction: str | None = Field(default=None, pattern="^(ltr|rtl)$")
    is_enabled: bool | None = None
    is_default: bool | None = None
    sort_order: int | None = None


class LanguageOut(BaseModel):
    model_config = ORM
    id: int
    code: str
    name: str
    native_name: str
    direction: str
    is_enabled: bool
    is_default: bool
    sort_order: int


class LanguagePackOut(BaseModel):
    """What the dashboard editor needs: the English source, what has been
    translated so far, and how far along it is."""
    language: LanguageOut
    catalogue: dict[str, dict[str, str]]
    translations: dict[str, str]
    translated: int
    total: int


class LanguagePackIn(BaseModel):
    values: dict[str, str]


# ----------------------------------------------------------- promo codes
class PromoIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    description: str = Field(default="", max_length=200)
    kind: str = Field(default="percent", pattern="^(percent|fixed|free_shipping)$")
    value: float = 0
    min_order_total: float = 0
    max_discount: float = 0
    usage_limit: int = 0
    per_customer_limit: int = 0
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool = True


class PromoOut(BaseModel):
    model_config = ORM
    id: int
    code: str
    description: str
    kind: str
    value: float
    min_order_total: float
    max_discount: float
    usage_limit: int
    used_count: int
    per_customer_limit: int
    starts_at: datetime | None
    ends_at: datetime | None
    is_active: bool
    created_at: datetime


class PromoCheckIn(BaseModel):
    code: str
    subtotal: float = 0


class PromoCheckOut(BaseModel):
    valid: bool
    code: str = ""
    kind: str = ""
    message: str = ""
    discount: float = 0
    saved: float = 0
    shipping_fee: float = 0
    total: float = 0
    currency_symbol: str = ""


# ---------------------------------------------------------- system email
class EmailSettingsIn(BaseModel):
    is_enabled: bool = False
    host: str = ""
    port: int = 587
    username: str = ""
    password: str | None = None      # blank keeps the stored one
    use_tls: bool = True
    use_ssl: bool = False
    from_name: str = ""
    from_email: str = ""
    reply_to: str = ""
    bcc_owner: bool = False


class EmailSettingsOut(BaseModel):
    is_enabled: bool
    host: str
    port: int
    username: str
    password_masked: str
    has_password: bool
    use_tls: bool
    use_ssl: bool
    from_name: str
    from_email: str
    reply_to: str
    bcc_owner: bool


class EmailTemplateIn(BaseModel):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)
    is_enabled: bool = True


class EmailTemplateOut(BaseModel):
    model_config = ORM
    id: int
    key: str
    name: str
    description: str
    subject: str
    body: str
    is_enabled: bool
    updated_at: datetime


class EmailTemplateDetail(EmailTemplateOut):
    variables: list[str] = []
    preview_subject: str = ""
    preview_body: str = ""
    # The stand-in content behind the preview, so the editor can re-render as
    # you type without asking the server on every keystroke.
    sample: dict[str, str] = {}


class EmailTestIn(BaseModel):
    to: EmailStr
    template_key: str = ""     # empty sends a plain check message


class EmailSendResult(BaseModel):
    sent: bool
    message: str


class EmailLogOut(BaseModel):
    model_config = ORM
    id: int
    template_key: str
    to_email: str
    subject: str
    status: str
    detail: str
    created_at: datetime
