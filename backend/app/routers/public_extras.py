"""Public endpoints for language packs and promo code checking.

No authentication: the storefront calls these before anyone signs in.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import i18n, promos, site_settings
from ..database import get_db
from ..models import Language
from ..schemas import LanguageOut, PromoCheckIn, PromoCheckOut
from ..utils import money, price_order

router = APIRouter(prefix="/api", tags=["Languages & promos"])


@router.get("/languages", response_model=list[LanguageOut], summary="Languages a shopper can pick")
def languages(db: Session = Depends(get_db)):
    """Only the enabled ones. If a single language is enabled the storefront
    hides the picker, so a one-language shop shows no clutter."""
    return i18n.enabled_languages(db)


@router.get("/i18n/{code}", response_model=dict[str, str], summary="One language pack")
def language_pack(code: str, db: Session = Depends(get_db)):
    """English defaults with the translations laid over the top, so every key
    always has a value. An unknown code returns plain English rather than an
    error — a stale bookmark should not break the shop."""
    return i18n.pack(db, code)


@router.post("/promo/check", response_model=PromoCheckOut, summary="Check a promo code")
def check_promo(payload: PromoCheckIn, db: Session = Depends(get_db)):
    """What the Apply button calls. Nothing is reserved or counted here — the
    code is checked again when the order is placed."""
    subtotal = money(payload.subtotal)
    try:
        promo = promos.validate(db, payload.code, subtotal)
    except promos.PromoError as error:
        return PromoCheckOut(valid=False, code=payload.code.strip().upper(), message=str(error))

    base = price_order(db, subtotal)
    discount, _ = promos.discount_for(promo, subtotal, base["shipping_fee"])
    free_shipping = promo.kind == "free_shipping"
    totals = price_order(db, subtotal, discount, free_shipping)

    if free_shipping:
        saved = base["shipping_fee"]
        message = "Delivery is on us." if saved else "Delivery was already free."
    else:
        saved = totals["discount"]
        message = promo.description or "Code applied."

    return PromoCheckOut(
        valid=True,
        code=promo.code,
        kind=promo.kind,
        message=message,
        discount=totals["discount"],
        saved=money(saved),
        shipping_fee=totals["shipping_fee"],
        total=totals["total"],
        currency_symbol=site_settings.get(db, "currency_symbol", "₹"),
    )
