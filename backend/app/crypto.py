"""Secret storage for payment keys, and credential generation for API keys.

Gateway secrets are encrypted at rest with a key derived from SECRET_KEY, so a
stolen database dump does not hand over your Stripe account. API key secrets are
never stored at all — only a SHA-256 hash, the same way a password is handled.

Consequence worth knowing: change SECRET_KEY and previously saved gateway
secrets become unreadable. Re-enter them in Admin -> Payments.
"""
import base64
import hashlib
import secrets

from cryptography.fernet import Fernet, InvalidToken

from .config import settings


def _cipher() -> Fernet:
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    if not value:
        return ""
    return _cipher().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value:
        return ""
    try:
        return _cipher().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        return ""


def mask(value: str, keep: int = 4) -> str:
    """Render a secret for display: ••••••••4242. Empty stays empty."""
    if not value:
        return ""
    return "•" * 8 + value[-keep:]


def new_key_pair() -> tuple[str, str]:
    """Returns (key_id, secret). The secret is shown once and never stored raw."""
    return "sk_id_" + secrets.token_hex(8), "sk_secret_" + secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def secrets_match(secret: str, stored_hash: str) -> bool:
    return secrets.compare_digest(hash_secret(secret), stored_hash)
