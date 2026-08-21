"""Central configuration. Everything tunable lives here or in .env."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # dotenv is optional
    load_dotenv = None

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
PROJECT_DIR = BASE_DIR.parent                              # shopkit/
FRONTEND_DIR = PROJECT_DIR / "frontend"
STORE_DIR = FRONTEND_DIR / "store"        # the built React storefront
MEDIA_DIR = BASE_DIR / "media"
STATIC_DIR = BASE_DIR / "static"          # Swagger UI assets, served at /static

if load_dotenv:
    load_dotenv(BASE_DIR / ".env")


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_db_url(url: str) -> str:
    """Accept the shorthand URLs hosting providers hand out."""
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


class Settings:
    APP_NAME = os.getenv("APP_NAME", "ShopKit API")
    API_VERSION = "1.0.0"

    DATABASE_URL = _normalize_db_url(
        os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'shop.db'}")
    )

    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    JWT_ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@myshop.com")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin12345")
    ADMIN_NAME = os.getenv("ADMIN_NAME", "Store Owner")

    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    SEED_DEMO_DATA = _bool(os.getenv("SEED_DEMO_DATA"), True)

    # The API reference at /docs asks for an API credential before it opens.
    # Set DOCS_PUBLIC=true to let anyone read it (the endpoints themselves stay
    # protected either way — this only controls who can see the documentation).
    DOCS_PUBLIC = _bool(os.getenv("DOCS_PUBLIC"), False)
    MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "5"))
    ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"}


settings = Settings()
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
