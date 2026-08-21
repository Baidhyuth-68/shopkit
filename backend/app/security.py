"""Password hashing + JSON Web Tokens.

Hashing uses PBKDF2-SHA256 from the standard library so there are no
compiled dependencies. To switch to bcrypt or argon2 later, replace only
hash_password/verify_password — nothing else calls into this file.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from .config import settings

_ALGO = "pbkdf2_sha256"
_ROUNDS = 260_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ROUNDS)
    return f"{_ALGO}${_ROUNDS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt, digest = stored.split("$")
        if algo != _ALGO:
            return False
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(rounds))
        return hmac.compare_digest(expected.hex(), digest)
    except (ValueError, AttributeError):
        return False


def create_access_token(user_id: int, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
