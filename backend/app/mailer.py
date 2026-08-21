"""Sending the shop's automatic emails.

Two rules shape this file:

1. **Sending never breaks a request.** A customer's order must not fail
   because a mail server is slow or misconfigured. Every send is wrapped, and
   the outcome goes to the email log instead of to the customer as a 500.
2. **Templates are text, not code.** Placeholders are `{{name}}` and are
   replaced by plain string substitution. There is no expression evaluation,
   so a template can never be turned into a way to run something on the server.
"""
from __future__ import annotations

import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from sqlalchemy.orm import Session

from . import site_settings
from .crypto import decrypt
from .models import EmailLog, EmailSettings, EmailTemplate

PLACEHOLDER = re.compile(r"\{\{\s*([a-z0-9_]+)\s*\}\}", re.IGNORECASE)

# Every template starts from one of these. Editable afterwards in
# Admin -> System email; the `variables` list is what the editor offers.
DEFAULT_TEMPLATES: list[dict] = [
    {
        "key": "account_created",
        "name": "Welcome, new account",
        "description": "Sent the moment someone finishes signing up.",
        "variables": ["site_name", "customer_name", "customer_email", "shop_url", "contact_email"],
        "subject": "Welcome to {{site_name}}",
        "body": (
            "Hello {{customer_name}},\n\n"
            "Your {{site_name}} account is ready. You can now check out faster and "
            "see all your past orders in one place.\n\n"
            "Have a look around: {{shop_url}}\n\n"
            "Any questions, just reply to this email.\n\n"
            "— {{site_name}}"
        ),
    },
    {
        "key": "password_reset",
        "name": "Password reset",
        "description": "Sent when a new password is issued for an account.",
        "variables": ["site_name", "customer_name", "temporary_password", "shop_url", "contact_email"],
        "subject": "Your new {{site_name}} password",
        "body": (
            "Hello {{customer_name}},\n\n"
            "Here is a temporary password for your {{site_name}} account:\n\n"
            "    {{temporary_password}}\n\n"
            "Sign in with it, then change it straight away under Your details.\n\n"
            "If you did not ask for this, tell us at {{contact_email}}.\n\n"
            "— {{site_name}}"
        ),
    },
    {
        "key": "order_placed",
        "name": "Order received",
        "description": "The confirmation a customer gets right after checkout.",
        "variables": [
            "site_name", "customer_name", "order_number", "order_items", "subtotal",
            "discount", "shipping_fee", "tax", "total", "payment_method",
            "shipping_address", "contact_email",
        ],
        "subject": "We have your order {{order_number}}",
        "body": (
            "Hello {{customer_name}},\n\n"
            "Thank you — your order is in. Here is what we are packing:\n\n"
            "{{order_items}}\n"
            "Subtotal: {{subtotal}}\n"
            "Discount: {{discount}}\n"
            "Delivery: {{shipping_fee}}\n"
            "Total: {{total}}\n\n"
            "Paying by: {{payment_method}}\n\n"
            "Sending it to:\n{{shipping_address}}\n\n"
            "We will email again the moment it ships.\n\n"
            "— {{site_name}}"
        ),
    },
    {
        "key": "order_shipped",
        "name": "Order shipped",
        "description": "Sent when you move an order to Shipped.",
        "variables": ["site_name", "customer_name", "order_number", "order_items",
                      "total", "shipping_address", "contact_email"],
        "subject": "Order {{order_number}} is on its way",
        "body": (
            "Hello {{customer_name}},\n\n"
            "Your order has left us and is on its way to:\n\n"
            "{{shipping_address}}\n\n"
            "What is in the parcel:\n\n{{order_items}}\n"
            "If it has not arrived in a few days, reply to this email and we will chase it.\n\n"
            "— {{site_name}}"
        ),
    },
    {
        "key": "order_delivered",
        "name": "Order delivered",
        "description": "Sent when you mark an order Delivered.",
        "variables": ["site_name", "customer_name", "order_number", "order_items",
                      "total", "shop_url", "contact_email"],
        "subject": "Order {{order_number}} has arrived",
        "body": (
            "Hello {{customer_name}},\n\n"
            "Our records say your order was delivered. We hope it is everything you wanted.\n\n"
            "If anything is wrong with it, reply to this email — we would rather hear about "
            "it than not.\n\n"
            "— {{site_name}}"
        ),
    },
    {
        "key": "order_returned",
        "name": "Return accepted",
        "description": "Sent when you mark an order Returned.",
        "variables": ["site_name", "customer_name", "order_number", "total", "contact_email"],
        "subject": "We have your return for {{order_number}}",
        "body": (
            "Hello {{customer_name}},\n\n"
            "Your return has been logged against order {{order_number}}.\n\n"
            "The refund of {{total}} goes back the way you paid. Depending on your bank "
            "it can take a few working days to appear.\n\n"
            "— {{site_name}}"
        ),
    },
    {
        "key": "order_cancelled",
        "name": "Order cancelled",
        "description": "Sent when an order is cancelled.",
        "variables": ["site_name", "customer_name", "order_number", "total", "contact_email"],
        "subject": "Order {{order_number}} has been cancelled",
        "body": (
            "Hello {{customer_name}},\n\n"
            "Order {{order_number}} has been cancelled and nothing further will be charged.\n\n"
            "If this is a surprise, tell us at {{contact_email}} and we will sort it out.\n\n"
            "— {{site_name}}"
        ),
    },
]

# Status -> template, for the automatic sends when an order moves along.
STATUS_TEMPLATES = {
    "shipped": "order_shipped",
    "delivered": "order_delivered",
    "returned": "order_returned",
    "cancelled": "order_cancelled",
}


def render(text: str, values: dict[str, str]) -> str:
    """Replace {{placeholders}}. An unknown name is left as it is, so a typo
    in a template shows up in the test email instead of silently vanishing."""
    def swap(match: re.Match) -> str:
        key = match.group(1).lower()
        return str(values[key]) if key in values else match.group(0)

    return PLACEHOLDER.sub(swap, text or "")


def get_settings(db: Session) -> EmailSettings:
    row = db.get(EmailSettings, 1)
    if not row:
        row = EmailSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def base_values(db: Session) -> dict[str, str]:
    """The placeholders every template can use."""
    shop = site_settings.get_all(db)
    return {
        "site_name": shop.get("site_name", "Shop"),
        "contact_email": shop.get("contact_email", ""),
        "contact_phone": shop.get("contact_phone", ""),
        "shop_url": shop.get("shop_url", "") or "/",
        "currency_symbol": shop.get("currency_symbol", ""),
    }


def _log(db: Session, key: str, to: str, subject: str, status: str, detail: str = "") -> None:
    db.add(EmailLog(
        template_key=key, to_email=to, subject=subject,
        status=status, detail=detail[:2000],
    ))
    db.commit()


def deliver(db: Session, to: str, subject: str, body: str, key: str = "") -> tuple[bool, str]:
    """Send one message. Returns (sent, message) and never raises."""
    config = get_settings(db)

    if not config.is_enabled:
        _log(db, key, to, subject, "skipped", "Email sending is switched off.")
        return False, "Email sending is switched off in Admin → System email."
    if not config.host or not config.from_email:
        _log(db, key, to, subject, "skipped", "SMTP host or sender address missing.")
        return False, "Add an SMTP host and a sender address first."
    if not to:
        _log(db, key, to, subject, "skipped", "No recipient.")
        return False, "No recipient address."

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((config.from_name or "", config.from_email))
    message["To"] = to
    if config.reply_to:
        message["Reply-To"] = config.reply_to
    if config.bcc_owner and config.from_email and config.from_email != to:
        message["Bcc"] = config.from_email
    message.set_content(body)

    password = decrypt(config.password_enc)

    try:
        if config.use_ssl:
            server = smtplib.SMTP_SSL(config.host, config.port, timeout=20,
                                      context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(config.host, config.port, timeout=20)
        with server:
            server.ehlo()
            if config.use_tls and not config.use_ssl:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            if config.username:
                server.login(config.username, password)
            server.send_message(message)
    except Exception as error:  # noqa: BLE001 — a bad mail server must not 500 a checkout
        reason = f"{type(error).__name__}: {error}"
        _log(db, key, to, subject, "failed", reason)
        return False, reason

    _log(db, key, to, subject, "sent")
    return True, "Sent."


def send_template(db: Session, key: str, to: str, values: dict[str, str]) -> tuple[bool, str]:
    """Look a template up, fill it in, send it. Safe to call from anywhere."""
    template = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    if not template:
        _log(db, key, to, "", "skipped", "No template with that key.")
        return False, "No template with that key."
    if not template.is_enabled:
        _log(db, key, to, template.subject, "skipped", "This template is switched off.")
        return False, "This template is switched off."

    merged = {**base_values(db), **values}
    return deliver(db, to, render(template.subject, merged), render(template.body, merged), key)


# --------------------------------------------------------------------------
# Order helpers — used by the checkout and the order status endpoints
# --------------------------------------------------------------------------
def order_values(db: Session, order) -> dict[str, str]:
    symbol = site_settings.get(db, "currency_symbol", "")

    def cash(amount: float) -> str:
        return f"{symbol}{amount:,.2f}"

    lines = "\n".join(
        f"  {item.product_name} x {item.quantity} — {cash(item.line_total)}"
        for item in order.items
    )
    address = "\n".join(filter(None, [
        order.customer_name, order.address_line, order.city,
        order.postal_code, order.country, order.phone,
    ]))

    return {
        "customer_name": order.customer_name or "there",
        "customer_email": order.customer_email,
        "order_number": order.order_number,
        "order_status": order.status,
        "order_items": lines,
        "subtotal": cash(order.subtotal),
        "discount": cash(order.discount) if order.discount else "—",
        "promo_code": order.promo_code or "—",
        "shipping_fee": cash(order.shipping_fee) if order.shipping_fee else "Free",
        "tax": cash(order.tax),
        "total": cash(order.total),
        "payment_method": (order.payment_method or "").replace("_", " ").title(),
        "shipping_address": address,
    }


def send_order_email(db: Session, key: str, order) -> tuple[bool, str]:
    return send_template(db, key, order.customer_email, order_values(db, order))
