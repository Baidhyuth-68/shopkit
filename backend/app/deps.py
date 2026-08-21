"""Reusable FastAPI dependencies for authentication and authorisation."""
from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import (
    APIKeyHeader, HTTPAuthorizationCredentials, HTTPBasic, HTTPBasicCredentials, HTTPBearer,
)
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import decode_access_token


# Declared as a real security scheme, which is what puts a **Login token** box
# in the Authorize dialog on /docs and a padlock on every endpoint that needs
# one. Reading the header by hand instead — as this file used to — works for
# the storefront but leaves those endpoints impossible to try from the docs:
# no box to paste into, and no padlock to hint that one is needed.
bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="Login token",
    description=(
        "For customer and admin endpoints. Run **POST /api/auth/login** with your "
        "email and password, copy `access_token` out of the response, and paste it "
        "here. Just the token — Swagger adds the word Bearer for you."
    ),
)


def _token_from_request(request: Request) -> str | None:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def _presented_token(
    request: Request, creds: HTTPAuthorizationCredentials | None
) -> str | None:
    """The scheme when the caller came through Swagger, the raw header
    otherwise. Both end up in the same place."""
    if creds and creds.scheme.lower() == "bearer":
        return creds.credentials
    return _token_from_request(request)


def get_current_user_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    token = _presented_token(request, creds)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    user = db.get(User, int(payload.get("sub", 0)))
    if not user or not user.is_active:
        return None
    return user


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = _presented_token(request, creds)
    if not token:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session expired. Sign in again.")
    user = db.get(User, int(payload.get("sub", 0)))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is disabled.")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access only.")
    return user


# --------------------------------------------------------------------------
# API key authentication, used by /api/integration/* for Postman and scripts.
#
#   X-API-Key: <key_id>.<secret>
#
# Keys are separate from user logins on purpose: they never expire on their
# own, they carry scopes, and they cannot reach /api/admin/*.
# --------------------------------------------------------------------------
# Declared as real security schemes so they show up in the Authorize dialog on
# /docs. Two ways in, both accepting the same credential:
#
#   1. ApiKeyHeader — one box. Paste  <key_id>.<secret>
#   2. HTTPBasic    — username is the credential, password left empty
#
# auto_error=False on both so a missing one falls through to the other instead
# of failing outright.
api_key_scheme = APIKeyHeader(
    name="X-API-Key",
    auto_error=False,
    scheme_name="API key",
    description=(
        "Paste **either** the whole credential (`sk_id_….sk_secret_…`) **or** just "
        "the secret (`sk_secret_…`) — both work. Create one in Admin → API keys, "
        "then click Authorize below. Nothing else to fill in."
    ),
)

basic_scheme = HTTPBasic(
    auto_error=False,
    scheme_name="API key as username",
    description=(
        "For `curl -u` and tools that only speak Basic auth. Put the secret "
        "(or the whole credential) in **Username** and leave **Password** empty. "
        "Key id in Username with the secret in Password works too."
    ),
)


def _lookup_api_key(db: Session, presented: str):
    """Find the key from whatever the caller pasted.

    People paste all sorts of things into an Authorize box, and every shape
    below identifies exactly one credential, so all of them are accepted:

        sk_id_abc123.sk_secret_xyz    the whole credential
        sk_secret_xyz                 the secret on its own
        sk_id_abc123                  the key id alone — rejected, see below

    The secret alone is enough because it is 32 random bytes; matching on its
    hash is the same check as matching the pair. The key id alone is *not*
    accepted: it is not a secret, it is printed in the dashboard list, and
    treating it as one would make every key public.
    """
    from .crypto import hash_secret, secrets_match
    from .models import ApiKey

    presented = presented.strip()
    if not presented:
        return None, "No credential sent."

    if "." in presented:
        key_id, _, secret = presented.partition(".")
        record = db.query(ApiKey).filter(ApiKey.key_id == key_id).first()
        if not record:
            return None, "No credential with that key id. Check Admin → API keys."
        if not secrets_match(secret, record.secret_hash):
            return None, "The secret does not match that key id."
        if not record.is_active:
            return None, "That credential has been revoked."
        return record, ""

    if presented.startswith("sk_id_"):
        return None, (
            "That is the key id, not the secret. Paste the secret "
            "(sk_secret_…) or the whole credential (key id, a dot, then the secret)."
        )

    record = db.query(ApiKey).filter(ApiKey.secret_hash == hash_secret(presented)).first()
    if not record:
        return None, (
            "That credential is not valid. The secret is shown only once, when you "
            "create it — if it was lost, make a new one in Admin → API keys."
        )
    if not record.is_active:
        return None, "That credential has been revoked."
    return record, ""


def require_api_key(
    request: Request,
    header_key: str | None = Security(api_key_scheme),
    basic: HTTPBasicCredentials | None = Security(basic_scheme),
    db: Session = Depends(get_db),
):
    from datetime import datetime

    raw = (header_key or "").strip()

    if not raw and basic:
        username = (basic.username or "").strip()
        password = (basic.password or "").strip()
        # Key id in the username with the secret in the password is the classic
        # Basic split; anything else means the username already holds it all.
        raw = f"{username}.{password}" if password and "." not in username else username

    if not raw:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "No credential sent. On /docs click Authorize and paste your API key; "
            "elsewhere send it as the X-API-Key header.",
            headers={"WWW-Authenticate": "Basic"},
        )

    record, problem = _lookup_api_key(db, raw)
    if not record:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, problem, headers={"WWW-Authenticate": "Basic"}
        )

    record.last_used_at = datetime.utcnow()
    db.commit()
    return record


def require_scope(scope: str):
    """Usage:  key = Depends(require_scope("catalog:write"))"""

    def checker(key=Depends(require_api_key)):
        if scope not in key.scope_list and "*" not in key.scope_list:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"This credential is missing the '{scope}' scope. Add it in Admin → API keys.",
            )
        return key

    return checker
