"""Small shared helpers."""
import random
import re
import string
from datetime import datetime

from sqlalchemy.orm import Session

from . import site_settings


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug or "item"


def unique_slug(db: Session, model, text: str, ignore_id: int | None = None) -> str:
    base = slugify(text)
    slug = base
    n = 2
    while True:
        q = db.query(model).filter(model.slug == slug)
        if ignore_id:
            q = q.filter(model.id != ignore_id)
        if not q.first():
            return slug
        slug = f"{base}-{n}"
        n += 1


def new_order_number() -> str:
    stamp = datetime.utcnow().strftime("%y%m%d")
    tail = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"ORD-{stamp}-{tail}"


def money(value: float) -> float:
    return round(float(value or 0), 2)


def price_order(
    db: Session,
    subtotal: float,
    discount: float = 0.0,
    free_shipping: bool = False,
) -> dict:
    """Shipping and tax are derived from site settings, never from the client.

    A discount comes off the goods first, then delivery and tax are worked out
    on what is left — so a code can also tip an order over the free-delivery
    threshold, or drop it back under.
    """
    flat = site_settings.get_float(db, "shipping_flat_rate", 0)
    threshold = site_settings.get_float(db, "free_shipping_threshold", 0)
    tax_percent = site_settings.get_float(db, "tax_percent", 0)

    discount = money(min(max(discount, 0.0), subtotal))
    goods = money(subtotal - discount)

    shipping = 0.0 if (threshold > 0 and goods >= threshold) or goods <= 0 else flat
    if free_shipping:
        shipping = 0.0

    tax = money(goods * tax_percent / 100)
    return {
        "subtotal": money(subtotal),
        "discount": discount,
        "shipping_fee": money(shipping),
        "tax": tax,
        "total": money(goods + shipping + tax),
        "free_shipping_threshold": threshold,
    }
