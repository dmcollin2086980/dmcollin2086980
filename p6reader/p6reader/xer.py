"""XER file parser.

An .xer file is tab-delimited text with a line-oriented grammar:

- Line 1: ``ERMHDR\\t<version>\\t<date>\\t<...>`` -- file header.
- ``%T\\t<table_name>``: begins a table.
- ``%F\\t<field1>\\t<field2>...``: column names for the current table.
- ``%R\\t<value1>\\t<value2>...``: one data row for the current table.
- ``%E``: end of file marker.

This parser is intentionally lossless: every table and field is preserved as
raw strings. It never raises on a malformed row; it records a warning and
skips that row instead.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class XerTable:
    """One parsed XER table: its declared fields and raw string rows."""

    name: str
    fields: list[str] = field(default_factory=list)
    rows: list[dict[str, str]] = field(default_factory=list)


@dataclass
class XerHeader:
    """Parsed ERMHDR line. All fields are optional/best-effort."""

    raw: str = ""
    version: str | None = None
    export_date: str | None = None
    project_name: str | None = None
    exported_by: str | None = None
    user: str | None = None
    app_name: str | None = None
    currency: str | None = None


@dataclass
class ParsedXer:
    header: XerHeader
    tables: dict[str, XerTable] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    encoding_used: str = "cp1252"


def _decode_bytes(raw: bytes, encoding: str | None) -> tuple[str, str, list[str]]:
    warnings: list[str] = []
    encodings_to_try = [encoding] if encoding else ["cp1252", "latin-1"]
    last_exc: Exception | None = None
    for enc in encodings_to_try:
        try:
            return raw.decode(enc), enc, warnings
        except (UnicodeDecodeError, LookupError) as exc:  # pragma: no cover - fallback path
            last_exc = exc
            warnings.append(f"failed to decode with {enc!r}: {exc}")
    # Last resort: latin-1 never fails (1 byte -> 1 codepoint).
    warnings.append("falling back to latin-1 with errors='replace'")
    return raw.decode("latin-1", errors="replace"), "latin-1", warnings


def _parse_header(line: str) -> XerHeader:
    parts = line.rstrip("\r\n").split("\t")
    hdr = XerHeader(raw=line.rstrip("\r\n"))
    # ERMHDR  version  date  project_name  exported_by  user  app_name  ??  currency
    if len(parts) > 1:
        hdr.version = parts[1] or None
    if len(parts) > 2:
        hdr.export_date = parts[2] or None
    if len(parts) > 3:
        hdr.project_name = parts[3] or None
    if len(parts) > 4:
        hdr.exported_by = parts[4] or None
    if len(parts) > 5:
        hdr.user = parts[5] or None
    if len(parts) > 6:
        hdr.app_name = parts[6] or None
    if len(parts) > 0:
        hdr.currency = parts[-1] or None
    return hdr


def parse_xer_bytes(raw: bytes, encoding: str | None = None) -> ParsedXer:
    """Parse raw .xer file bytes into a :class:`ParsedXer`.

    ``encoding`` overrides auto-detection (default: try cp1252, then
    latin-1). Malformed rows are recorded as warnings and skipped; the
    parser never raises for data-quality issues.
    """
    text, encoding_used, decode_warnings = _decode_bytes(raw, encoding)
    warnings = list(decode_warnings)

    lines = text.split("\n")
    if not lines:
        warnings.append("file is empty")
        return ParsedXer(header=XerHeader(), tables={}, warnings=warnings, encoding_used=encoding_used)

    header_line = lines[0]
    if not header_line.startswith("ERMHDR"):
        warnings.append(
            f"first line does not start with ERMHDR (found: {header_line[:40]!r}); "
            "continuing anyway"
        )
    header = _parse_header(header_line)

    tables: dict[str, XerTable] = {}
    current: XerTable | None = None
    saw_end_marker = False

    for lineno, raw_line in enumerate(lines[1:], start=2):
        line = raw_line.rstrip("\r\n")
        if not line:
            continue
        # Fields are tab-delimited; the leading token is the record marker.
        parts = line.split("\t")
        marker = parts[0]

        if marker == "%T":
            table_name = parts[1].strip() if len(parts) > 1 else ""
            if not table_name:
                warnings.append(f"line {lineno}: %T with no table name; skipping table")
                current = None
                continue
            current = tables.get(table_name)
            if current is None:
                current = XerTable(name=table_name)
                tables[table_name] = current
        elif marker == "%F":
            if current is None:
                warnings.append(f"line {lineno}: %F outside of a %T block; ignoring")
                continue
            current.fields = [p.strip() for p in parts[1:]]
        elif marker == "%R":
            if current is None:
                warnings.append(f"line {lineno}: %R outside of a %T block; ignoring")
                continue
            if not current.fields:
                warnings.append(
                    f"line {lineno}: data row for table {current.name!r} before "
                    "%F fields were declared; skipping row"
                )
                continue
            values = parts[1:]
            if len(values) == 0:
                warnings.append(
                    f"line {lineno}: empty data row for table {current.name!r}; skipping"
                )
                continue
            if len(values) > len(current.fields):
                warnings.append(
                    f"line {lineno}: row in {current.name!r} has more values "
                    f"({len(values)}) than declared fields ({len(current.fields)}); "
                    "extra values dropped"
                )
                values = values[: len(current.fields)]
            elif len(values) < len(current.fields):
                # P6 omits trailing empty fields; pad with empty strings.
                values = values + [""] * (len(current.fields) - len(values))
            current.rows.append(dict(zip(current.fields, values)))
        elif marker == "%E":
            saw_end_marker = True
        else:
            warnings.append(f"line {lineno}: unrecognized record marker {marker!r}; skipping line")

    if not saw_end_marker:
        warnings.append("no %E end-of-file marker found; file may be truncated")

    return ParsedXer(header=header, tables=tables, warnings=warnings, encoding_used=encoding_used)


def parse_xer_file(path: str, encoding: str | None = None) -> ParsedXer:
    """Parse an .xer file from disk."""
    with open(path, "rb") as f:
        raw = f.read()
    return parse_xer_bytes(raw, encoding=encoding)
