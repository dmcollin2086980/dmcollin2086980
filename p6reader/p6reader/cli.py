"""Command-line interface for p6reader."""

from __future__ import annotations

import collections
import os
import sqlite3
import sys

import click

from . import compare as compare_mod
from . import export as export_mod
from . import logic_check
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


@main.command()
@click.argument("db_path", type=click.Path(exists=True, dir_okay=False))
@click.option("--format", "fmt", default="csv", type=click.Choice(["csv"]), help="Export format.")
@click.option("--out", "out_dir", required=True, type=click.Path(), help="Output directory.")
def export(db_path: str, fmt: str, out_dir: str) -> None:
    """Export activities, relationships, WBS, and calendars to CSV."""
    conn, schedule = _open_schedule(db_path)
    try:
        written = export_mod.export_csv(schedule, out_dir)
        click.echo(f"Exported {len(written)} files to {out_dir}:")
        for path in written:
            click.echo(f"  {path}")
        _print_warnings_summary(schedule.all_warnings)
    finally:
        conn.close()


@main.command()
@click.argument("db_path", type=click.Path(exists=True, dir_okay=False))
@click.option("--out", "out_path", required=True, type=click.Path(), help="Markdown report output path.")
@click.option("--max-duration-days", default=logic_check.DEFAULT_MAX_DURATION_DAYS, show_default=True,
              help="Flag non-LOE/non-milestone activities longer than this many working days.")
@click.option("--high-float-days", default=logic_check.DEFAULT_HIGH_FLOAT_DAYS, show_default=True,
              help="Flag incomplete activities with more total float (working days) than this.")
@click.option("--max-lag-days", default=logic_check.DEFAULT_MAX_LAG_DAYS, show_default=True,
              help="Flag relationships with lag (working days) greater than this.")
@click.option("--healthcare-overlay/--no-healthcare-overlay", default=False,
              help="Flag if no activities match healthcare keywords (ICRA/ILSM/ADHS/TJC/etc). Off by default.")
def check(db_path: str, out_path: str, max_duration_days: float, high_float_days: float,
          max_lag_days: float, healthcare_overlay: bool) -> None:
    """Run schedule logic QC and write a severity-ranked markdown report."""
    conn, schedule = _open_schedule(db_path)
    try:
        options = logic_check.CheckOptions(
            max_duration_days=max_duration_days,
            high_float_days=high_float_days,
            max_lag_days=max_lag_days,
            healthcare_overlay=healthcare_overlay,
        )
        findings = logic_check.run_all_checks(schedule, options)
        report = logic_check.render_markdown_report(findings, options, schedule)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report)

        counts = collections.Counter(f.severity for f in findings)
        click.echo(f"Wrote QC report to {out_path}")
        for sev in logic_check.SEVERITIES:
            click.echo(f"  {sev}: {counts.get(sev, 0)}")
        _print_warnings_summary(schedule.all_warnings)
    finally:
        conn.close()


@main.command()
@click.argument("baseline_db", type=click.Path(exists=True, dir_okay=False))
@click.argument("update_db", type=click.Path(exists=True, dir_okay=False))
@click.option("--out", "out_path", required=True, type=click.Path(), help="Markdown report output path.")
def compare(baseline_db: str, update_db: str, out_path: str) -> None:
    """Compare two schedule databases (baseline vs. update) by task_code."""
    conn_b, schedule_b = _open_schedule(baseline_db)
    conn_u, schedule_u = _open_schedule(update_db)
    try:
        result = compare_mod.compare_schedules(schedule_b, schedule_u)
        report = compare_mod.render_markdown_report(result, schedule_b, schedule_u)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report)

        click.echo(f"Wrote comparison report to {out_path}")
        click.echo(f"  Added: {len(result.added_activities)}")
        click.echo(f"  Deleted: {len(result.deleted_activities)}")
        click.echo(f"  Renamed: {len(result.renamed_activities)}")
        click.echo(f"  Date slips: {len(result.date_slips)}")
        click.echo(f"  Relationship changes: {len(result.relationship_changes)}")
        click.echo(f"  Constraint changes: {len(result.constraint_changes)}")
        _print_warnings_summary(schedule_b.all_warnings + schedule_u.all_warnings)
    finally:
        conn_b.close()
        conn_u.close()


if __name__ == "__main__":
    main()
