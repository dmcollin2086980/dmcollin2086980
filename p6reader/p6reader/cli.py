"""Command-line interface for p6reader."""

from __future__ import annotations

import collections
import os
import sqlite3
import sys

import click

from . import model as model_mod
from . import store
from . import xer as xer_mod


def _detect_format(path: str) -> str:
    """Detect 'xer' or 'xml' by extension first, then by sniffing content."""
    lower = path.lower()
    if lower.endswith(".xer"):
        return "xer"
    if lower.endswith(".xml"):
        return "xml"
    # Sniff: XER files start with ERMHDR; XML files start with '<' after BOM/whitespace.
    with open(path, "rb") as f:
        head = f.read(4096)
    stripped = head.lstrip(b"\xef\xbb\xbf \t\r\n")
    if stripped.startswith(b"ERMHDR"):
        return "xer"
    if stripped.startswith(b"<"):
        return "xml"
    raise click.ClickException(
        f"cannot detect file format for {path!r}: expected .xer or .xml content"
    )


def _print_warnings_summary(warnings: list[str]) -> None:
    click.echo("")
    if not warnings:
        click.echo("Warnings: none")
        return
    click.echo(f"Warnings: {len(warnings)}")
    for w in warnings[:50]:
        click.echo(f"  - {w}")
    if len(warnings) > 50:
        click.echo(f"  ... and {len(warnings) - 50} more")


@click.group()
@click.version_option()
def main() -> None:
    """p6reader: read and audit Primavera P6 .xer and P6 XML exports."""


@main.command()
@click.argument("input_path", type=click.Path(exists=True, dir_okay=False))
@click.option("--out", "out_path", required=True, type=click.Path(), help="Output SQLite database path.")
@click.option("--encoding", default=None, help="Override text encoding for .xer input (default: cp1252, then latin-1).")
def load(input_path: str, out_path: str, encoding: str | None) -> None:
    """Load an .xer or P6 XML export into a SQLite database."""
    fmt = _detect_format(input_path)
    if fmt == "xer":
        parsed = xer_mod.parse_xer_file(input_path, encoding=encoding)
        tables = parsed.tables
        header_fields = {
            "version": parsed.header.version,
            "export_date": parsed.header.export_date,
            "project_name": parsed.header.project_name,
            "exported_by": parsed.header.exported_by,
            "user": parsed.header.user,
            "app_name": parsed.header.app_name,
            "currency": parsed.header.currency,
            "encoding_used": parsed.encoding_used,
        }
        warnings = parsed.warnings
    else:
        from . import p6xml

        parsed = p6xml.parse_xml_file(input_path)
        tables = parsed.tables
        header_fields = {
            "xml_namespace": parsed.namespace,
        }
        warnings = parsed.warnings

    if os.path.exists(out_path):
        os.remove(out_path)

    result = store.build_store(
        db_path=out_path,
        source_path=os.path.abspath(input_path),
        source_format=fmt,
        tables=tables,
        warnings=warnings,
        header_fields=header_fields,
    )
    click.echo(f"Loaded {input_path} ({fmt}) -> {out_path}")
    click.echo(f"Tables: {len(result.tables_loaded)}")
    for t in result.tables_loaded:
        click.echo(f"  {t}: {len(tables[t].rows)} rows")
    _print_warnings_summary(warnings)


def _open_schedule(db_path: str) -> tuple[sqlite3.Connection, "model_mod.Schedule"]:
    if not os.path.exists(db_path):
        raise click.ClickException(f"database not found: {db_path}")
    conn = store.connect(db_path)
    schedule = model_mod.load_schedule(conn)
    return conn, schedule


@main.command()
@click.argument("db_path", type=click.Path(exists=True, dir_okay=False))
def summary(db_path: str) -> None:
    """Print a project summary: activity counts, relationships, calendars."""
    conn, schedule = _open_schedule(db_path)
    try:
        meta = schedule.meta
        click.echo(f"Source: {meta.get('source_file', '?')} ({meta.get('source_format', '?')})")
        if schedule.project:
            p = schedule.project
            click.echo(f"Project: {p.short_name} (proj_id={p.proj_id})")
            click.echo(f"  Plan start: {p.plan_start}")
            click.echo(f"  Plan end / must-finish: {p.plan_end}")
            click.echo(f"  Data date (last recalc): {p.last_recalc_date}")
            click.echo(f"  Scheduled end: {p.scd_end_date}")
        else:
            click.echo("Project: (none found)")

        click.echo("")
        click.echo(f"Activities: {len(schedule.activities)}")
        by_type = collections.Counter(a.task_type for a in schedule.activities.values())
        for t, n in sorted(by_type.items()):
            click.echo(f"  {model_mod.TASK_TYPE_LABELS.get(t, t)}: {n}")

        click.echo("")
        by_status = collections.Counter(a.status_code for a in schedule.activities.values())
        for s, n in sorted(by_status.items()):
            click.echo(f"  {model_mod.STATUS_LABELS.get(s, s)}: {n}")

        click.echo("")
        click.echo(f"Relationships: {len(schedule.relationships)}")

        click.echo("")
        click.echo(f"Calendars: {len(schedule.calendars)}")
        for c in schedule.calendars.values():
            flag = " [PARSE FAILED - fallback Mon-Fri 8h]" if c.parsed.is_fallback else ""
            click.echo(f"  {c.name} (id={c.clndr_id}): {c.parsed.day_hr_cnt}h/day{flag}")

        _print_warnings_summary(schedule.all_warnings)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
