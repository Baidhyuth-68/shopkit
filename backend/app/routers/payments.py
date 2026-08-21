"""Taking payments.

Keys live in Admin -> Payments, encrypted at rest. The storefront only ever
receives a publishable key.

Flow the frontend follows:
    1. GET  /api/payments/methods                   which methods to show
    2. POST /api/orders                             creates the order
    3. POST /api/payments/{number}/initiate         creates the gateway object
    4. gateway SDK runs in the browser
    5. POST /api/payments/{number}/confirm          records the outcome
    6. the gateway also calls /api/payments/webhook/{provider} — trust this one

With no live keys saved, initiate returns a sandbox reference so the whole
checkout can be tested before you open a merchant account.
"""
import base64
import hashlib
import hmac
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .. import site_settings
from ..crypto import decrypt
from ..database import get_db
from ..deps import get_current_user_optional
from ..models import Order, PaymentAttempt, PaymentGateway
from ..schemas import PaymentConfirmIn, PaymentIntentOut, PaymentMethodOut

router = APIRouter(prefix="/api/payments", tags=["Payments"])

# Providers you settle yourself — no API call, no keys.
OFFLINE = {"cod", "bank_transfer"}


def _enabled(db: Session, provider: str) -> PaymentGateway:
    gateway = (
        db.query(PaymentGateway)
        .filter(PaymentGateway.provider == provider, PaymentGateway.is_enabled.is_(True))
        .first()
    )
    if not gateway:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That payment method is not switched on for this shop.",
        )
    return gateway


def _find_order(db: Session, order_number: str, user) -> Order:
    order = db.query(Order).filter(Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No order with that number.")
    # A guest checkout has no user_id, so the order number itself is the key.
    if order.user_id and (not user or (user.id != order.user_id and user.role != "admin")):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No order with that number.")
    return order


@router.get("/methods", response_model=list[PaymentMethodOut], summary="Methods to show at checkout")
def methods(db: Session = Depends(get_db)):
    rows = (
        db.query(PaymentGateway)
        .filter(PaymentGateway.is_enabled.is_(True))
        .order_by(PaymentGateway.sort_order, PaymentGateway.provider)
        .all()
    )
    return [
        PaymentMethodOut(
            provider=row.provider,
            label=row.label or row.provider.replace("_", " ").title(),
            # "Test mode" is meaningless for cash on delivery.
            test_mode=row.test_mode and row.provider not in OFFLINE,
            publishable_key=row.publishable_key,
            instructions=row.instructions,
        )
        for row in rows
    ]


@router.post(
    "/{order_number}/initiate",
    response_model=PaymentIntentOut,
    summary="Start paying for an order",
)
def initiate(
    order_number: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_optional),
):
    order = _find_order(db, order_number, user)
    if order.status in ("paid", "shipped", "delivered"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This order is already paid.")

    gateway = _enabled(db, order.payment_method)
    currency = site_settings.get(db, "currency_code", "INR")
    minor_units = int(round(order.total * 100))

    def record(reference: str, note: str = "") -> PaymentAttempt:
        attempt = PaymentAttempt(
            order_id=order.id, provider=gateway.provider, reference=reference,
            status="pending", amount=order.total, currency=currency, note=note,
        )
        db.add(attempt)
        db.commit()
        return attempt

    # ---- pay offline -----------------------------------------------------
    if gateway.provider in OFFLINE:
        return PaymentIntentOut(
            provider=gateway.provider, order_number=order.order_number,
            amount=order.total, currency=currency, next_action="none",
            checkout_payload={"instructions": gateway.instructions},
        )

    secret = decrypt(gateway.secret_key_enc)

    # ---- Stripe ----------------------------------------------------------
    if gateway.provider == "stripe" and secret:
        import httpx

        try:
            response = httpx.post(
                "https://api.stripe.com/v1/payment_intents",
                headers={"Authorization": f"Bearer {secret}"},
                data={
                    "amount": minor_units,
                    "currency": currency.lower(),
                    "metadata[order_number]": order.order_number,
                    "automatic_payment_methods[enabled]": "true",
                },
                timeout=20,
            )
            response.raise_for_status()
            intent = response.json()
        except httpx.HTTPError as error:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Stripe refused the request: {error}")

        record(intent["id"])
        return PaymentIntentOut(
            provider="stripe", order_number=order.order_number, amount=order.total,
            currency=currency, reference=intent["id"],
            publishable_key=gateway.publishable_key,
            next_action="confirm_stripe_payment_intent",
            checkout_payload={"client_secret": intent.get("client_secret", "")},
        )

    # ---- Razorpay --------------------------------------------------------
    if gateway.provider == "razorpay" and gateway.publishable_key and secret:
        import httpx

        auth = base64.b64encode(f"{gateway.publishable_key}:{secret}".encode()).decode()
        try:
            response = httpx.post(
                "https://api.razorpay.com/v1/orders",
                headers={"Authorization": f"Basic {auth}"},
                json={"amount": minor_units, "currency": currency, "receipt": order.order_number},
                timeout=20,
            )
            response.raise_for_status()
            rzp = response.json()
        except httpx.HTTPError as error:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Razorpay refused the request: {error}")

        record(rzp["id"])
        return PaymentIntentOut(
            provider="razorpay", order_number=order.order_number, amount=order.total,
            currency=currency, reference=rzp["id"],
            publishable_key=gateway.publishable_key,
            next_action="open_razorpay_checkout",
            checkout_payload={
                "key": gateway.publishable_key, "order_id": rzp["id"],
                "amount": minor_units, "currency": currency,
            },
        )

    # ---- no live keys yet: let the merchant test the whole flow ----------
    reference = f"sandbox_{order.order_number}"
    record(reference, "No live keys saved for this gateway.")
    return PaymentIntentOut(
        provider=gateway.provider, order_number=order.order_number, amount=order.total,
        currency=currency, reference=reference, next_action="sandbox_confirm",
        checkout_payload={
            "note": "This is a sandbox reference. Add live keys in Admin → Payments to charge for real."
        },
    )


@router.post("/{order_number}/confirm", summary="Record the outcome of a payment")
def confirm(
    order_number: str,
    payload: PaymentConfirmIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_optional),
):
    """Called by the storefront once the gateway's SDK returns, and by an admin
    to record an offline payment. For real money the webhook below is the one
    to trust — a browser can lie about this call, a signed webhook cannot."""
    order = _find_order(db, order_number, user)
    attempt = (
        db.query(PaymentAttempt)
        .filter(PaymentAttempt.order_id == order.id)
        .order_by(PaymentAttempt.id.desc())
        .first()
    )
    if attempt:
        attempt.status = payload.status
        if payload.reference:
            attempt.reference = payload.reference
        if payload.note:
            attempt.note = payload.note
    if payload.status == "paid" and order.status == "pending":
        order.status = "paid"
    db.commit()
    return {
        "order_number": order.order_number,
        "order_status": order.status,
        "payment_status": payload.status,
        "reference": attempt.reference if attempt else payload.reference,
    }


@router.post("/webhook/{provider}", summary="Gateway webhook receiver")
async def webhook(provider: str, request: Request, db: Session = Depends(get_db)):
    """Register in your gateway dashboard:

        https://your-domain.com/api/payments/webhook/stripe
        https://your-domain.com/api/payments/webhook/razorpay

    The signing secret comes from Admin → Payments → Webhook signing secret.
    Razorpay signatures are checked here; Stripe's scheme needs the `stripe`
    package, so verify there before going live with large volumes.
    """
    gateway = db.query(PaymentGateway).filter(PaymentGateway.provider == provider).first()
    if not gateway:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown gateway.")

    raw = await request.body()
    signing_secret = decrypt(gateway.webhook_secret_enc)

    if provider == "razorpay" and signing_secret:
        sent = request.headers.get("x-razorpay-signature", "")
        expected = hmac.new(signing_secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sent, expected):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Signature check failed.")

    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Body was not valid JSON.")

    reference, paid = "", False
    if provider == "razorpay":
        entity = body.get("payload", {}).get("payment", {}).get("entity", {})
        reference = entity.get("order_id", "")
        paid = body.get("event") in ("payment.captured", "order.paid")
    elif provider == "stripe":
        obj = body.get("data", {}).get("object", {})
        reference = obj.get("id", "")
        paid = body.get("type") == "payment_intent.succeeded"

    if reference:
        attempt = db.query(PaymentAttempt).filter(PaymentAttempt.reference == reference).first()
        if attempt:
            attempt.status = "paid" if paid else "failed"
            order = db.get(Order, attempt.order_id)
            if paid and order and order.status == "pending":
                order.status = "paid"
            db.commit()

    # Always 200 for anything we simply do not handle — gateways retry on errors.
    return {"received": True}
