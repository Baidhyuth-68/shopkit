"""Language packs.

CATALOGUE is the list of every string the storefront can translate, with its
English wording. Add a key here and it appears in the dashboard editor for
every language, and becomes available to the frontend as `t("your.key")`.

Anything a translator has not filled in falls back to English, so a
half-finished pack never shows a customer a blank label.

Note on scope: this translates the shop's *interface*. Product names and
descriptions stay in whatever language you typed them, because those live in
the products table. docs/CODE_MAP.md explains how to extend it if you need
translated product copy too.
"""
from sqlalchemy.orm import Session

from .models import Language, Translation

# group -> {key: English default}
CATALOGUE: dict[str, dict[str, str]] = {
    "Navigation": {
        "nav.home": "Home",
        "nav.shop": "Shop",
        "nav.cart": "Cart",
        "nav.account": "Account",
        "nav.profile": "Profile",
        "nav.about": "About",
        "nav.search": "Search products",
        "nav.menu": "Menu",
    },
    "Buttons": {
        "action.add_to_cart": "Add to cart",
        "action.buy_now": "Buy now",
        "action.checkout": "Checkout",
        "action.place_order": "Place order",
        "action.continue_shopping": "Continue shopping",
        "action.apply": "Apply",
        "action.remove": "Remove",
        "action.save": "Save",
        "action.cancel": "Cancel",
    },
    "Products": {
        "product.in_stock": "In stock",
        "product.out_of_stock": "Out of stock",
        "product.low_stock": "Only a few left",
        "product.quantity": "Quantity",
        "product.description": "Description",
        "product.no_results": "Nothing matched that search",
        "product.all": "Everything",
        "product.sort": "Sort",
    },
    "Cart and checkout": {
        "cart.title": "Your cart",
        "cart.empty": "Your cart is empty",
        "cart.subtotal": "Subtotal",
        "cart.shipping": "Delivery",
        "cart.tax": "Tax",
        "cart.discount": "Discount",
        "cart.total": "Total",
        "cart.free_shipping": "Free",
        "checkout.title": "Checkout",
        "checkout.delivery_details": "Where should it go?",
        "checkout.payment": "How would you like to pay?",
        "checkout.summary": "Order summary",
        "checkout.name": "Full name",
        "checkout.email": "Email",
        "checkout.phone": "Phone",
        "checkout.address": "Address",
        "checkout.city": "City",
        "checkout.postal_code": "Postal code",
        "checkout.country": "Country",
        "checkout.note": "Anything we should know?",
    },
    "Promo codes": {
        "promo.label": "Promo code",
        "promo.placeholder": "Enter a code",
        "promo.applied": "Code applied",
        "promo.remove": "Remove code",
        "promo.invalid": "That code is not valid",
    },
    "Account": {
        "auth.sign_in": "Sign in",
        "auth.sign_out": "Sign out",
        "auth.create_account": "Create account",
        "auth.email": "Email",
        "auth.password": "Password",
        "account.my_orders": "My orders",
        "account.profile": "Your details",
        "account.no_orders": "No orders yet",
        "order.number": "Order",
        "order.status": "Status",
        "order.placed_on": "Placed on",
        "order.thanks": "Thank you for your order",
    },
}


def all_keys() -> dict[str, str]:
    """Flat {key: English default} across every group."""
    flat: dict[str, str] = {}
    for group in CATALOGUE.values():
        flat.update(group)
    return flat


def enabled_languages(db: Session) -> list[Language]:
    return (
        db.query(Language)
        .filter(Language.is_enabled.is_(True))
        .order_by(Language.sort_order, Language.name)
        .all()
    )


def default_language(db: Session) -> Language | None:
    return (
        db.query(Language).filter(Language.is_default.is_(True)).first()
        or db.query(Language).filter(Language.is_enabled.is_(True)).first()
    )


def pack(db: Session, code: str) -> dict[str, str]:
    """English defaults with this language's translations laid over the top."""
    strings = all_keys()
    language = db.query(Language).filter(Language.code == code).first()
    if not language:
        return strings
    for row in language.strings:
        if row.key in strings and row.value.strip():
            strings[row.key] = row.value
    return strings


def raw_pack(db: Session, language: Language) -> dict[str, str]:
    """Only what a translator actually typed — blanks mean 'not translated'."""
    return {row.key: row.value for row in language.strings}


def save_pack(db: Session, language: Language, values: dict[str, str]) -> dict[str, str]:
    """Writes only known keys. An empty value deletes the row, so the string
    goes back to falling through to English."""
    known = all_keys()
    existing = {row.key: row for row in language.strings}

    for key, value in values.items():
        if key not in known:
            continue
        text = (value or "").strip()
        row = existing.get(key)
        if not text:
            if row:
                db.delete(row)
        elif row:
            row.value = text
        else:
            db.add(Translation(language_id=language.id, key=key, value=text))

    db.commit()
    db.refresh(language)
    return raw_pack(db, language)
