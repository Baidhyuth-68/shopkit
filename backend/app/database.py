"""SQLAlchemy engine, session, and the declarative Base.

Swapping SQLite for a hosted Postgres is a one-line change in .env —
nothing in this file needs editing.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

is_sqlite = settings.DATABASE_URL.startswith("sqlite")

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if is_sqlite else {},
    pool_pre_ping=not is_sqlite,   # keeps hosted DB connections from going stale
    # Free Postgres tiers suspend when idle and drop the connection with it.
    # Recycling well before that turns a confusing "server closed the
    # connection" error into a silent reconnect.
    pool_recycle=280 if not is_sqlite else -1,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: one session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
