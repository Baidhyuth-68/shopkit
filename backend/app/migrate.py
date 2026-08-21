"""Additive schema migration, run once on every boot.

`Base.metadata.create_all` creates missing *tables* but never adds a missing
*column* to a table that already exists. So when a new feature needs a column
on an old table, an existing shop would break with "no such column".

This closes that gap for the simple case: adding a nullable column with a
default. It never drops, renames or retypes anything, so it cannot lose data.

To add a column safely:
    1. add it to models.py
    2. add one line to ADDED_COLUMNS below
    3. restart

Anything more involved than that — renames, type changes, backfills — deserves
a real migration tool. See docs/CODE_MAP.md.
"""
import time

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError, ProgrammingError

# table -> column -> the SQL type and default used in the ALTER statement.
ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "orders": {
        "discount": "FLOAT DEFAULT 0",
        "promo_code": "VARCHAR(40) DEFAULT ''",
    },
}


def prepare_database(engine: Engine, base, attempts: int = 5) -> None:
    """Create any missing tables, safely under several worker processes.

    `create_all` checks what exists and then creates what does not, and those
    are two separate steps. In production the app boots several workers at
    once: they all look at an empty database, they all decide to create the
    same tables, and the losers get "table already exists" and exit. Gunicorn
    sees a worker fail to boot and takes the whole app down with it — so the
    very first deploy of a new database dies, and the second one works, which
    is a horrible thing to debug.

    Losing that race is harmless: the table the worker wanted now exists. So
    the error is absorbed, with a short pause to let the winner finish the
    rest of the schema.
    """
    for attempt in range(attempts):
        try:
            base.metadata.create_all(bind=engine)
            return
        except (OperationalError, ProgrammingError) as error:
            if "already exists" not in str(error).lower():
                raise
            time.sleep(0.25 * (attempt + 1))

    # Last look: if the tables are there, another worker did the job.
    if not inspect(engine).get_table_names():
        raise RuntimeError("Could not create the database schema.")


def run(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    added: list[str] = []

    for table, columns in ADDED_COLUMNS.items():
        if table not in existing_tables:
            continue  # create_all will build it complete
        present = {c["name"] for c in inspector.get_columns(table)}
        for column, definition in columns.items():
            if column in present:
                continue
            # Its own transaction per column: under several worker processes
            # two can reach this at once, and the loser must not take the
            # whole migration down with it.
            try:
                with engine.begin() as connection:
                    connection.execute(
                        text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                    )
                added.append(f"{table}.{column}")
            except Exception as error:  # noqa: BLE001
                if "duplicate column" in str(error).lower() or "already exists" in str(error).lower():
                    continue        # another worker won the race
                raise

    if added:
        print(f"  ✓ schema updated: added {', '.join(added)}")
