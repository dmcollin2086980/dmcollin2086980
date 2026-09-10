"""Tests for loading a parsed XER into the SQLite store and reading back a
typed Schedule model.
"""

from __future__ import annotations

import datetime
import os

from p6reader import model as model_mod
from p6reader import store
from p6reader import xer as xer_mod

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def _build_schedule(tmp_path, filename):
    xer_path = os.path.join(FIXTURES, filename)
    parsed = xer_mod.parse_xer_file(xer_path)
    db_path = str(tmp_path / "test.db")
    store.build_store(
        db_path=db_path,
        source_path=xer_path,
        source_format="xer",
        tables=parsed.tables,
        warnings=parsed.warnings,
        header_fields={"version": parsed.header.version},
    )
    conn = store.connect(db_path)
    schedule = model_mod.load_schedule(conn)
    return conn, schedule


def test_store_round_trip_row_counts(tmp_path):
    conn, schedule = _build_schedule(tmp_path, "baseline.xer")
    try:
        rows = store.read_table(conn, "TASK")
        assert len(rows) == 14
        rows_pred = store.read_table(conn, "TASKPRED")
        assert len(rows_pred) == 15
    finally:
        conn.close()


def test_meta_and_warnings_present(tmp_path):
    conn, schedule = _build_schedule(tmp_path, "baseline.xer")
    try:
        meta = store.get_meta(conn)
        assert meta["source_format"] == "xer"
        assert meta["header.version"] == "8.4"
    finally:
        conn.close()


def test_project_parsed(tmp_path):
    conn, schedule = _build_schedule(tmp_path, "baseline.xer")
    try:
        assert schedule.project is not None
        assert schedule.project.short_name == "HCTI-01"
        assert schedule.project.plan_start == datetime.datetime(2026, 1, 5, 8, 0)
    finally:
        conn.close()


def test_activities_typed_and_keyed(tmp_path):
    conn, schedule = _build_schedule(tmp_path, "baseline.xer")
    try:
        assert len(schedule.activities) == 14
        act = schedule.activities_by_code["A1020"]
        assert act.task_type == "TT_Task"
        assert act.status_code == "TK_Active"
        assert act.target_drtn_hr == 120.0
        assert act.early_start == datetime.datetime(2026, 1, 22, 8, 0)
    finally:
        conn.close()


def test_hours_to_days_conversion_via_calendar(tmp_path):
    conn, schedule = _build_schedule(tmp_path, "baseline.xer")
    try:
        act = schedule.activities_by_code["A1050"]  # 400 target hours
        calendar = schedule.calendar_for(act)
        assert act.target_drtn_days(calendar) == 50.0  # 400 / 8
    finally:
        conn.close()


def test_calendar_fallback_flagged_for_garbled_calendar(tmp_path):
    conn, schedule = _build_schedule(tmp_path, "baseline.xer")
    try:
        cal1002 = schedule.calendars["1002"]
        assert cal1002.parsed.is_fallback
        assert any("1002" in w for w in schedule.warnings)
    finally:
        conn.close()


def test_relationships_loaded(tmp_path):
    conn, schedule = _build_schedule(tmp_path, "baseline.xer")
    try:
        assert len(schedule.relationships) == 15
        neg_lag = [r for r in schedule.relationships if r.lag_hr is not None and r.lag_hr < 0]
        assert len(neg_lag) == 1
        assert neg_lag[0].lag_hr == -16
    finally:
        conn.close()


def test_wbs_path_and_level(tmp_path):
    conn, schedule = _build_schedule(tmp_path, "baseline.xer")
    try:
        act = schedule.activities_by_code["A1020"]
        path = schedule.wbs_path(act.wbs_id)
        assert path == "HCTI-01 > STRUCT"
        assert schedule.wbs_level(act.wbs_id) == 2
    finally:
        conn.close()
