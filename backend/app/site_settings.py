"""Storefront settings: branding, copy, and shop rules.

DEFAULTS is the single source of truth. Add a key here and it is instantly
readable at GET /api/settings, writable at PUT /api/admin/settings, and
available to the frontend as `Site.get("your_key")`.
"""
from sqlalchemy.orm import Session

from .models import SiteSetting

DEFAULTS: dict[str, str] = {
    # --- Identity ---
    "site_name": "Marigold Supply",
    "tagline": "Small-batch goods, made to be used",
    "logo_text": "MS",
    "logo_image": "",
    "contact_email": "hello@marigold.co",
    "contact_phone": "+91 00000 00000",
    # Your public address, used in emails where a link has to be absolute.
    "shop_url": "http://127.0.0.1:8000",

    # --- Shop look ---
    "color_ink": "#0E1726",
    "color_accent": "#A65323",
    "color_paper": "#F5F6F8",
    "corner_radius": "10",

    # --- Dashboard look. Separate on purpose: the panel you work in all day
    # does not have to follow the shop's brand. Blank falls back to the shop
    # value above, so upgrading changes nothing until you edit something.
    "admin_color_ink": "#0E1726",
    "admin_color_accent": "#A65323",
    "admin_color_paper": "#F5F6F8",
    "admin_corner_radius": "10",

    # --- Type. Storefront and dashboard are set separately on purpose:
    # a shop can be playful while the panel you work in all day stays plain.
    # Shop: Work Sans headings are confident without being loud, and Inter
    # underneath keeps long copy and small labels legible.
    "font_store_display": "Work Sans",
    "font_store_body": "Inter",
    # Dashboard: Inter, drawn for dense screen UI. Stays legible in a table of
    # numbers at 13px. Plain on purpose.
    "font_admin_display": "Inter",
    "font_admin_body": "Inter",

    # --- Home page copy ---
    "announcement": "Free delivery on orders over 1500",
    "hero_title": "Everything here was made by hand, in small numbers",
    "hero_subtitle": "One workshop, a short list of products, and no plans to grow out of it.",
    "hero_image": "",
    "hero_cta": "Browse the shop",
    "about_title": "Made in one room",
    "about_text": "We keep the catalogue short on purpose. Each batch is finished, checked and packed by the same two people, which is why some things sell out and stay out for a while.",
    "footer_text": "© Marigold Supply. Built with ShopKit.",

    # --- Shop rules (money math lives on the server) ---
    "currency_symbol": "₹",
    "currency_code": "INR",
    "shipping_flat_rate": "80",
    "free_shipping_threshold": "1500",
    "tax_percent": "0",
    "low_stock_threshold": "5",
    "allow_registration": "true",
    "payment_methods": "cod,bank_transfer",
    "maintenance_mode": "false",
    "default_language": "en",
}


def get_all(db: Session) -> dict[str, str]:
    """Defaults overlaid with whatever is stored in the database."""
    values = dict(DEFAULTS)
    for row in db.query(SiteSetting).all():
        if row.key in DEFAULTS:
            values[row.key] = row.value
    return values


def get(db: Session, key: str, default: str = "") -> str:
    row = db.query(SiteSetting).filter(SiteSetting.key == key).first()
    if row:
        return row.value
    return DEFAULTS.get(key, default)


def get_float(db: Session, key: str, default: float = 0.0) -> float:
    try:
        return float(get(db, key) or default)
    except ValueError:
        return default


def update(db: Session, changes: dict[str, str]) -> dict[str, str]:
    """Writes only known keys; unknown keys are ignored on purpose."""
    for key, value in changes.items():
        if key not in DEFAULTS:
            continue
        row = db.query(SiteSetting).filter(SiteSetting.key == key).first()
        if row:
            row.value = str(value)
        else:
            db.add(SiteSetting(key=key, value=str(value)))
    db.commit()
    return get_all(db)
