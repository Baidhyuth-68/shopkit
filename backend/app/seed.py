"""First-run data.

Runs automatically on startup. It is safe to run repeatedly: it only ever
creates things that are missing. Set SEED_DEMO_DATA=false in .env once you
start adding your own products.
"""
import random
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .config import settings
from .database import SessionLocal
from .models import Category, Order, OrderItem, Product, User
from .security import hash_password
from .utils import money, new_order_number, slugify

DEMO_CATEGORIES = [
    ("Kitchen", "Things that get used every day and wear in, not out.", 1),
    ("Home", "Quiet objects for rooms you actually live in.", 2),
    ("Carry", "Bags and cases stitched to outlast their contents.", 3),
]

DEMO_PRODUCTS = [
    ("Brass measuring spoons", "Kitchen", 890, 1190, 24, True,
     "A nested set of four, turned from solid brass.",
     "Four spoons — tablespoon down to quarter teaspoon — turned from solid brass and left unlacquered so they darken with use. Held on a leather loop. Hand wash."),
    ("Cast iron skillet, 10\"", "Kitchen", 2450, None, 12, True,
     "Sand-cast, pre-seasoned, one piece.",
     "Cast in a single piece so there is no handle to work loose. Pre-seasoned with flaxseed oil three times before it ships. Gets better every time you cook in it."),
    ("Stoneware pour-over", "Kitchen", 1650, None, 8, False,
     "Throws a clean 300ml brew.",
     "Wheel-thrown stoneware with a matte glaze inside and raw clay outside. Fits a standard #2 paper filter. Dishwasher safe, though it will not thank you."),
    ("Block-print napkins, set of 4", "Home", 1200, 1500, 30, True,
     "Hand-printed on washed cotton.",
     "Printed one block at a time on heavy washed cotton, so no two are identical. They soften after the first wash and keep softening."),
    ("Beeswax candles, pair", "Home", 640, None, 46, False,
     "Nine hours of warm, quiet light.",
     "Poured from unfiltered local beeswax with a cotton wick. Burns roughly nine hours per candle with almost no smoke."),
    ("Linen apron", "Home", 1890, None, 0, False,
     "Cross-back, no neck strain.",
     "Cut from mid-weight linen with a cross-back strap so the weight sits on your shoulders. Two deep pockets. Currently between batches."),
    ("Waxed canvas tote", "Carry", 2790, 3200, 9, True,
     "Holds a week of groceries, or a laptop and lunch.",
     "12oz canvas, hot-waxed by hand, with leather-reinforced handles and a flat base that lets it stand up on its own."),
    ("Jute market bag", "Carry", 750, None, 38, False,
     "Folds down to a fist.",
     "Loosely woven jute with a long shoulder strap. Folds small enough to live in a coat pocket until you need it."),
]


def ensure_admin(db: Session) -> None:
    email = settings.ADMIN_EMAIL.lower()
    if db.query(User).filter(User.role == "admin").first():
        return
    db.add(User(
        email=email,
        password_hash=hash_password(settings.ADMIN_PASSWORD),
        full_name=settings.ADMIN_NAME,
        role="admin",
    ))
    db.commit()
    print(f"  ✓ admin account created: {email} / {settings.ADMIN_PASSWORD}")


def seed_demo(db: Session) -> None:
    if db.query(Product).count():
        return

    categories: dict[str, Category] = {}
    for name, description, order in DEMO_CATEGORIES:
        category = Category(name=name, slug=slugify(name), description=description, sort_order=order)
        db.add(category)
        categories[name] = category
    db.flush()

    products = []
    for name, cat, price, compare, stock, featured, short, long in DEMO_PRODUCTS:
        product = Product(
            name=name, slug=slugify(name),
            sku=f"MS-{slugify(name)[:8].upper()}",
            short_description=short, description=long,
            price=price, compare_at_price=compare, stock=stock,
            category_id=categories[cat].id, is_featured=featured,
            created_at=datetime.utcnow() - timedelta(days=random.randint(1, 60)),
        )
        db.add(product)
        products.append(product)
    db.flush()

    customer = db.query(User).filter(User.email == "asha@example.org").first()
    if not customer:
        customer = User(email="asha@example.org", password_hash=hash_password("customer123"),
                        full_name="Asha Rao", phone="+91 90000 00000",
                        address_line="12 Beach Road", city="Visakhapatnam",
                        postal_code="530003", country="India")
        db.add(customer)
        db.flush()

    # A little order history so the dashboard is not an empty page.
    for days_ago, status in [(1, "pending"), (3, "paid"), (5, "shipped"),
                             (8, "delivered"), (11, "delivered"), (16, "cancelled")]:
        chosen = random.sample(products, k=random.randint(1, 3))
        order = Order(
            order_number=new_order_number(), user_id=customer.id, status=status,
            payment_method="cod", customer_name=customer.full_name,
            customer_email=customer.email, phone=customer.phone,
            address_line=customer.address_line, city=customer.city,
            postal_code=customer.postal_code, country=customer.country,
            created_at=datetime.utcnow() - timedelta(days=days_ago),
        )
        subtotal = 0.0
        for product in chosen:
            quantity = random.randint(1, 2)
            line_total = money(product.price * quantity)
            subtotal += line_total
            order.items.append(OrderItem(
                product_id=product.id, product_name=product.name,
                unit_price=product.price, quantity=quantity, line_total=line_total,
            ))
        order.subtotal = money(subtotal)
        order.shipping_fee = 0.0 if subtotal >= 1500 else 80.0
        order.total = money(order.subtotal + order.shipping_fee)
        db.add(order)

    db.commit()
    print(f"  ✓ demo catalogue: {len(products)} products, 6 orders")


def ensure_payment_gateways(db) -> None:
    """One row per provider so Admin -> Payments is never an empty screen.
    Cash on delivery starts switched on; everything else waits for keys."""
    from .models import PaymentGateway

    defaults = [
        ("stripe", "Card payment (Stripe)", "Secure card payment, processed by Stripe.", 1, False),
        ("razorpay", "UPI, cards and netbanking (Razorpay)", "You will be taken to Razorpay to pay.", 2, False),
        ("bank_transfer", "Bank transfer", "Transfer to the account shown, then reply with the reference.", 3, False),
        ("cod", "Cash on delivery", "Pay the courier when your parcel arrives.", 4, True),
    ]
    existing = {row.provider for row in db.query(PaymentGateway).all()}
    added = 0
    for provider, label, instructions, order, enabled in defaults:
        if provider in existing:
            continue
        db.add(PaymentGateway(
            provider=provider, label=label, instructions=instructions,
            sort_order=order, is_enabled=enabled,
        ))
        added += 1
    if added:
        db.commit()
        print(f"  \u2713 payment gateways: {added} ready to configure")


# Starter language packs. These cover the most common shop words only, and are
# a head start for a translator rather than a finished job — review them in
# Admin -> Languages before switching a language on.
STARTER_PACKS = {
    "hi": {
        "nav.home": "\u0939\u094b\u092e", "nav.shop": "\u0926\u0941\u0915\u093e\u0928", "nav.cart": "\u0915\u093e\u0930\u094d\u091f",
        "nav.account": "\u0916\u093e\u0924\u093e", "nav.profile": "\u092a\u094d\u0930\u094b\u092b\u093c\u093e\u0907\u0932", "nav.about": "\u0939\u092e\u093e\u0930\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902",
        "action.add_to_cart": "\u0915\u093e\u0930\u094d\u091f \u092e\u0947\u0902 \u0921\u093e\u0932\u0947\u0902",
        "action.checkout": "\u091a\u0947\u0915\u0906\u0909\u091f", "action.apply": "\u0932\u093e\u0917\u0942 \u0915\u0930\u0947\u0902",
        "action.remove": "\u0939\u091f\u093e\u090f\u0901", "action.cancel": "\u0930\u0926\u094d\u0926 \u0915\u0930\u0947\u0902",
        "cart.title": "\u0906\u092a\u0915\u093e \u0915\u093e\u0930\u094d\u091f", "cart.empty": "\u0906\u092a\u0915\u093e \u0915\u093e\u0930\u094d\u091f \u0916\u093e\u0932\u0940 \u0939\u0948",
        "cart.subtotal": "\u0909\u092a-\u092f\u094b\u0917", "cart.shipping": "\u0921\u093f\u0932\u0940\u0935\u0930\u0940",
        "cart.tax": "\u0915\u0930", "cart.discount": "\u091b\u0942\u091f", "cart.total": "\u0915\u0941\u0932",
        "checkout.title": "\u091a\u0947\u0915\u0906\u0909\u091f", "promo.label": "\u092a\u094d\u0930\u094b\u092e\u094b \u0915\u094b\u0921",
        "product.out_of_stock": "\u0938\u094d\u091f\u0949\u0915 \u092e\u0947\u0902 \u0928\u0939\u0940\u0902", "product.in_stock": "\u0938\u094d\u091f\u0949\u0915 \u092e\u0947\u0902",
        "auth.sign_in": "\u0938\u093e\u0907\u0928 \u0907\u0928", "auth.sign_out": "\u0938\u093e\u0907\u0928 \u0906\u0909\u091f",
        "account.my_orders": "\u092e\u0947\u0930\u0947 \u0911\u0930\u094d\u0921\u0930",
    },
    "te": {
        "nav.home": "\u0c39\u0c4b\u0c2e\u0c4d", "nav.shop": "\u0c26\u0c41\u0c15\u0c3e\u0c23\u0c02", "nav.cart": "\u0c15\u0c3e\u0c30\u0c4d\u0c1f\u0c4d",
        "nav.account": "\u0c16\u0c3e\u0c24\u0c3e", "nav.profile": "\u0c2a\u0c4d\u0c30\u0c4a\u0c2b\u0c48\u0c32\u0c4d", "nav.about": "\u0c2e\u0c3e \u0c17\u0c41\u0c30\u0c3f\u0c02\u0c1a\u0c3f",
        "action.add_to_cart": "\u0c15\u0c3e\u0c30\u0c4d\u0c1f\u0c4d\u200c\u0c32\u0c4b \u0c1a\u0c47\u0c30\u0c4d\u0c1a\u0c41",
        "action.checkout": "\u0c1a\u0c46\u0c15\u0c4d\u0c05\u0c35\u0c41\u0c1f\u0c4d", "action.apply": "\u0c35\u0c30\u0c4d\u0c24\u0c3f\u0c02\u0c2a\u0c1c\u0c47\u0c2f\u0c3f",
        "cart.title": "\u0c2e\u0c40 \u0c15\u0c3e\u0c30\u0c4d\u0c1f\u0c4d", "cart.empty": "\u0c2e\u0c40 \u0c15\u0c3e\u0c30\u0c4d\u0c1f\u0c4d \u0c16\u0c3e\u0c33\u0c40\u0c17\u0c3e \u0c09\u0c02\u0c26\u0c3f",
        "cart.subtotal": "\u0c09\u0c2a \u0c2e\u0c4a\u0c24\u0c4d\u0c24\u0c02", "cart.shipping": "\u0c21\u0c46\u0c32\u0c3f\u0c35\u0c30\u0c40",
        "cart.tax": "\u0c2a\u0c28\u0c4d\u0c28\u0c41", "cart.discount": "\u0c24\u0c17\u0c4d\u0c17\u0c3f\u0c02\u0c2a\u0c41", "cart.total": "\u0c2e\u0c4a\u0c24\u0c4d\u0c24\u0c02",
        "product.out_of_stock": "\u0c38\u0c4d\u0c1f\u0c3e\u0c15\u0c4d \u0c32\u0c47\u0c26\u0c41", "product.in_stock": "\u0c38\u0c4d\u0c1f\u0c3e\u0c15\u0c4d\u200c\u0c32\u0c4b \u0c09\u0c02\u0c26\u0c3f",
        "auth.sign_in": "\u0c38\u0c48\u0c28\u0c4d \u0c07\u0c28\u0c4d", "auth.sign_out": "\u0c38\u0c48\u0c28\u0c4d \u0c05\u0c35\u0c41\u0c1f\u0c4d",
        "account.my_orders": "\u0c28\u0c3e \u0c06\u0c30\u0c4d\u0c21\u0c30\u0c4d\u0c32\u0c41",
    },
}


def ensure_languages(db) -> None:
    """English is created enabled and default. The others are listed but off,
    so you can look at them before any customer can."""
    from . import i18n
    from .models import Language, Translation

    defaults = [
        ("en", "English", "English", "ltr", True, True, 1),
        ("hi", "Hindi", "\u0939\u093f\u0928\u094d\u0926\u0940", "ltr", False, False, 2),
        ("te", "Telugu", "\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41", "ltr", False, False, 3),
        ("es", "Spanish", "Espa\u00f1ol", "ltr", False, False, 4),
        ("fr", "French", "Fran\u00e7ais", "ltr", False, False, 5),
        ("ar", "Arabic", "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", "rtl", False, False, 6),
    ]
    existing = {row.code for row in db.query(Language).all()}
    added = 0
    for code, name, native, direction, enabled, is_default, order in defaults:
        if code in existing:
            continue
        db.add(Language(
            code=code, name=name, native_name=native, direction=direction,
            is_enabled=enabled, is_default=is_default, sort_order=order,
        ))
        added += 1
    if added:
        db.commit()

    # Lay the starter packs down once, and never overwrite a human's edits.
    known = i18n.all_keys()
    for code, pack in STARTER_PACKS.items():
        language = db.query(Language).filter(Language.code == code).first()
        if not language or language.strings:
            continue
        for key, value in pack.items():
            if key in known:
                db.add(Translation(language_id=language.id, key=key, value=value))
    db.commit()
    if added:
        print(f"  \u2713 languages: {added} available, English on by default")


def ensure_promo_examples(db) -> None:
    """One switched-off example so the page explains itself."""
    from .models import PromoCode

    if db.query(PromoCode).first():
        return
    db.add(PromoCode(
        code="WELCOME10", description="10% off a first order",
        kind="percent", value=10, min_order_total=500, max_discount=300,
        per_customer_limit=1, is_active=False,
    ))
    db.commit()
    print("  \u2713 promo codes: one example added, switched off")


def ensure_email_templates(db) -> None:
    """Create any template that does not exist yet. Never overwrites wording
    you have edited — restoring the original is a button in the dashboard."""
    from . import mailer
    from .models import EmailTemplate

    existing = {row.key for row in db.query(EmailTemplate).all()}
    added = 0
    for spec in mailer.DEFAULT_TEMPLATES:
        if spec["key"] in existing:
            continue
        db.add(EmailTemplate(
            key=spec["key"], name=spec["name"], description=spec["description"],
            subject=spec["subject"], body=spec["body"], is_enabled=True,
        ))
        added += 1
    if added:
        db.commit()
        print(f"  \u2713 email templates: {added} ready to edit (sending is off until you add SMTP)")
    mailer.get_settings(db)   # make sure the single settings row exists


def run() -> None:
    """Seed whatever is missing.

    In production the app runs under several worker processes, and they all
    boot at once. Each step is written as "create it if it is not there", but
    two workers can pass that check at the same moment and both try to insert.
    The unique constraints catch it — this just makes the loser roll back and
    carry on instead of crashing the worker.
    """
    from sqlalchemy.exc import IntegrityError

    steps = [
        ensure_admin,
        ensure_payment_gateways,
        ensure_languages,
        ensure_promo_examples,
        ensure_email_templates,
    ]
    if settings.SEED_DEMO_DATA:
        steps.append(seed_demo)

    db = SessionLocal()
    try:
        for step in steps:
            try:
                step(db)
            except IntegrityError:
                db.rollback()   # another worker created it first, which is fine
            except Exception as error:  # noqa: BLE001 — never block start-up
                db.rollback()
                print(f"  ! seeding step {step.__name__} skipped: {error}")
    finally:
        db.close()
