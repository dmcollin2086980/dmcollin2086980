"""SQLite-backed store for parsed schedule data.

One SQL table is created per source table (XER table name, or the XML
loader's XER-equivalent table name), with every column stored as TEXT so no
raw value is ever lost. Typed conversion happens later, in ``model.py``,
when data is read back out.

Two bookkeeping tables are always present:

- ``_meta``: key/value pairs describing the source file (path, format,
  ERMHDR fields, load timestamp).
- ``_warnings``: every non-fatal warning collected while loading.
"""

from __future__ import annotations

import datetime
import sqlite3
from dataclasses import dataclass


def _quote_ident(name: str) -> str:
    """Quote a SQL identifier, escaping embedded double quotes."""
    return '"' + name.replace('"', '""') + '"'


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_meta_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        'CREATE TABLE IF NOT EXISTS "_meta" (key TEXT PRIMARY KEY, value TEXT)'
    )
    conn.execute(
        'CREATE TABLE IF NOT EXISTS "_warnings" (id INTEGER PRIMARY KEY AUTOINCREMENT, '
        "message TEXT)"
    )
    conn.commit()


def set_meta(conn: sqlite3.Connection, key: str, value: str | None) -> None:
    conn.execute(
        'INSERT INTO "_meta" (key, value) VALUES (?, ?) '
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def get_meta(conn: sqlite3.Connection) -> dict[str, str]:
    try:
        rows = conn.execute('SELECT key, value FROM "_meta"').fetchall()
    except sqlite3.OperationalError:
        return {}
    return {r["key"]: r["value"] for r in rows}


def add_warning(conn: sqlite3.Connection, message: str) -> None:
    conn.execute('INSERT INTO "_warnings" (message) VALUES (?)', (message,))


def add_warnings(conn: sqlite3.Connection, messages: list[str]) -> None:
    for m in messages:
        add_warning(conn, m)


def get_warnings(conn: sqlite3.Connection) -> list[str]:
    try:
        rows = conn.execute('SELECT message FROM "_warnings" ORDER BY id').fetchall()
    except sqlite3.OperationalError:
        return []
    return [r["message"] for r in rows]


def write_table(
    conn: sqlite3.Connection,
    table_name: str,
    fields: list[str],
    rows: list[dict[str, str]],
    replace: bool = True,
) -> None:
    """Create (or replace) a table with TEXT columns and insert raw rows.

    Every column is TEXT -- this store keeps raw string values. Typed
    conversion happens in model.py.
    """
    qname = _quote_ident(table_name)
    if replace:
        conn.execute(f"DROP TABLE IF EXISTS {qname}")
    if not fields:
        # Table declared with no fields (shouldn't normally happen) -- skip.
        return
    cols_sql = ", ".join(f"{_quote_ident(f)} TEXT" for f in fields)
    conn.execute(f"CREATE TABLE IF NOT EXISTS {qname} ({cols_sql})")
    if rows:
        placeholders = ", ".join("?" for _ in fields)
        col_list = ", ".join(_quote_ident(f) for f in fields)
        conn.executemany(
            f"INSERT INTO {qname} ({col_list}) VALUES ({placeholders})",
            [tuple(r.get(f, "") for f in fields) for r in rows],
        )


def read_table(conn: sqlite3.Connection, table_name: str) -> list[dict[str, str]]:
    qname = _quote_ident(table_name)
    try:
        cur = conn.execute(f"SELECT * FROM {qname}")
    except sqlite3.OperationalError:
        return []
    return [dict(row) for row in cur.fetchall()]


def list_data_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name"
    ).fetchall()
    return [r["name"] for r in rows]


@dataclass
class LoadResult:
    db_path: str
    tables_loaded: list[str]
    warning_count: int


def build_store(
    db_path: str,
    source_path: str,
    source_format: str,
    tables: dict[str, "TableData"],
    warnings: list[str],
    header_fields: dict[str, str | None] | None = None,
) -> LoadResult:
    """Write parsed tables + metadata + warnings into a fresh SQLite file.

    ``tables`` maps table name -> object with ``.fields`` and ``.rows``
    (either an ``XerTable`` or an equivalent produced by the XML loader).
    """
    conn = connect(db_path)
    try:
        init_meta_tables(conn)
        for name, table in tables.items():
            write_table(conn, name, table.fields, table.rows)

        set_meta(conn, "source_file", source_path)
        set_meta(conn, "source_format", source_format)
        set_meta(conn, "loaded_at", datetime.datetime.now().isoformat())
        for key, value in (header_fields or {}).items():
            set_meta(conn, f"header.{key}", value)

        add_warnings(conn, warnings)
        conn.commit()
    finally:
        conn.close()

    return LoadResult(db_path=db_path, tables_loaded=sorted(tables.keys()), warning_count=len(warnings))
