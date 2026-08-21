"""Promo code rules.

All of it runs on the server. The browser only ever sends the code that was
typed; it never sends, and is never trusted about, what that code is worth.

A code passes every one of these before it discounts anything:
    active · within its dates · order big enough · under its total usage limit
    · under this customer's own limit
"""
from datetime import datetime

from sqlalchemy.orm import Session

from . import site_settings
from .models import PromoCode, PromoRedemption
from .utils import money


class PromoError(Exception):
    """Message is written to be shown to a shopper as-is."""


def find(db: Session, code: str) -> PromoCode | None:
    if not code:
        return None
    return db.query(PromoCode).filter(PromoCode.code == code.strip().upper()).first()


def discount_for(promo: PromoCode, subtotal: float, shipping: float) -> tuple[float, float]:
    """Returns (discount off the goods, shipping charge after the code)."""
    if promo.kind == "free_shipping":
        return 0.0, 0.0

    if promo.kind == "percent":
        amount = subtotal * (promo.value / 100)
    else:  # fixed
        amount = promo.value

    if promo.max_discount and promo.max_discount > 0:
        amount = min(amount, promo.max_discount)
    # Never discount below zero, and never turn a discount into store credit.
    return money(min(amount, subtotal)), shipping


def validate(
    db: Session,
    code: str,
    subtotal: float,
    *,
    user_id: int | None = None,
    email: str = "",
) -> PromoCode:
    """Raises PromoError with a shopper-friendly reason, or returns the code."""
    promo = find(db, code)
    if not promo:
        raise PromoError("We do not recognise that code.")
    if not promo.is_active:
        raise PromoError("That code is no longer active.")

    now = datetime.utcnow()
    if promo.starts_at and now < promo.starts_at:
        raise PromoError("That code is not live yet.")
    if promo.ends_at and now > promo.ends_at:
        raise PromoError("That code has expired.")

    if promo.min_order_total and subtotal < promo.min_order_total:
        short = money(promo.min_order_total - subtotal)
        symbol = site_settings.get(db, "currency_symbol", "")
        pretty = f"{short:,.0f}" if short == int(short) else f"{short:,.2f}"
        raise PromoError(f"Spend {symbol}{pretty} more to use this code.")

    if promo.usage_limit and promo.used_count >= promo.usage_limit:
        raise PromoError("That code has been fully claimed.")

    if promo.per_customer_limit:
        query = db.query(PromoRedemption).filter(PromoRedemption.promo_id == promo.id)
        if user_id:
            query = query.filter(PromoRedemption.user_id == user_id)
        elif email:
            query = query.filter(PromoRedemption.customer_email == email.lower())
        else:
            query = None  # a guest with no email — nothing to count against
        if query is not None and query.count() >= promo.per_customer_limit:
            raise PromoError("You have already used that code.")

    return promo


def redeem(
    db: Session,
    promo: PromoCode,
    *,
    order_id: int | None,
    user_id: int | None,
    email: str,
    amount: float,
) -> None:
    """Called once, when an order is actually placed — not when someone clicks
    Apply. Otherwise a limited code could be exhausted by window shoppers."""
    promo.used_count += 1
    db.add(PromoRedemption(
        promo_id=promo.id, order_id=order_id, user_id=user_id,
        customer_email=(email or "").lower(), amount=money(amount),
    ))
