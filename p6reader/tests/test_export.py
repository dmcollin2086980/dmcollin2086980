"""Tests for CSV export."""

from __future__ import annotations

import csv
import os

from p6reader import export as export_mod
from p6reader import model as model_mod
from p6reader import store
from p6reader import xer as xer_mod

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def _schedule(tmp_path, filename="baseline.xer"):
    path = os.path.join(FIXTURES, filename)
    parsed = xer_mod.parse_xer_file(path)
    db_path = str(tmp_path / "s.db")
    store.build_store(db_path=db_path, source_path=path, source_format="xer",
                       tables=parsed.tables, warnings=parsed.warnings)
    conn = store.connect(db_path)
    return conn, model_mod.load_schedule(conn)


def test_export_writes_four_files(tmp_path):
    conn, schedule = _schedule(tmp_path)
    try:
        out_dir = str(tmp_path / "out")
        written = export_mod.export_csv(schedule, out_dir)
        names = {os.path.basename(p) for p in written}
        assert names == {"activities.csv", "relationships.csv", "wbs.csv", "calendars.csv"}
        for p in written:
            assert os.path.exists(p)
    finally:
        conn.close()


def test_activities_csv_row_count_and_readable_columns(tmp_path):
    conn, schedule = _schedule(tmp_path)
    try:
        out_dir = str(tmp_path / "out")
        export_mod.export_csv(schedule, out_dir)
        with open(os.path.join(out_dir, "activities.csv"), newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 14
        assert "Activity ID" in rows[0]
        assert "task_code" not in rows[0]  # no raw P6 field names
        assert "Original Duration (days)" in rows[0]
    finally:
        conn.close()


def test_export_duration_days_uses_calendar(tmp_path):
    conn, schedule = _schedule(tmp_path)
    try:
        out_dir = str(tmp_path / "out")
        export_mod.export_csv(schedule, out_dir)
        with open(os.path.join(out_dir, "activities.csv"), newline="", encoding="utf-8") as f:
            rows = {r["Activity ID"]: r for r in csv.DictReader(f)}
        assert rows["A1050"]["Original Duration (days)"] == "50"
    finally:
        conn.close()


def test_relationships_csv_has_readable_names(tmp_path):
    conn, schedule = _schedule(tmp_path)
    try:
        out_dir = str(tmp_path / "out")
        export_mod.export_csv(schedule, out_dir)
        with open(os.path.join(out_dir, "relationships.csv"), newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 15
        types = {r["Type"] for r in rows}
        assert "Finish to Start" in types
        assert "Start to Finish" in types
    finally:
        conn.close()


def test_wbs_csv_has_full_paths(tmp_path):
    conn, schedule = _schedule(tmp_path)
    try:
        out_dir = str(tmp_path / "out")
        export_mod.export_csv(schedule, out_dir)
        with open(os.path.join(out_dir, "wbs.csv"), newline="", encoding="utf-8") as f:
            rows = {r["WBS Code"]: r for r in csv.DictReader(f)}
        assert rows["STRUCT"]["Full Path"] == "HCTI-01 > STRUCT"
        assert rows["STRUCT"]["Level"] == "2"
    finally:
        conn.close()
