"""Tests for the baseline-vs-update comparison, checking each planted
change in tests/fixtures/{baseline,update}.xer is detected.
"""

from __future__ import annotations

import os

from p6reader import compare as compare_mod
from p6reader import model as model_mod
from p6reader import store
from p6reader import xer as xer_mod

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def _schedule(tmp_path, filename):
    path = os.path.join(FIXTURES, filename)
    parsed = xer_mod.parse_xer_file(path)
    db_path = str(tmp_path / f"{filename}.db")
    store.build_store(db_path=db_path, source_path=path, source_format="xer",
                       tables=parsed.tables, warnings=parsed.warnings)
    conn = store.connect(db_path)
    return conn, model_mod.load_schedule(conn)


def _compare(tmp_path):
    conn_b, sched_b = _schedule(tmp_path, "baseline.xer")
    conn_u, sched_u = _schedule(tmp_path, "update.xer")
    result = compare_mod.compare_schedules(sched_b, sched_u)
    return result, sched_b, sched_u, conn_b, conn_u


def test_added_activity_detected(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        codes = {a.task_code for a in result.added_activities}
        assert "A1025" in codes
    finally:
        cb.close()
        cu.close()


def test_deleted_activity_detected(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        codes = {a.task_code for a in result.deleted_activities}
        assert "A1099" in codes
    finally:
        cb.close()
        cu.close()


def test_duration_change_detected(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        codes = {c.task_code for c in result.duration_changes}
        assert "A1020" in codes  # remaining duration dropped to 0 (completed)
    finally:
        cb.close()
        cu.close()


def test_date_slips_detected_and_sorted_desc(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        assert len(result.date_slips) > 0
        codes = {s.task_code for s in result.date_slips}
        assert "A1050" in codes
        mags = [abs(s.slip_working_days) for s in result.date_slips]
        assert mags == sorted(mags, reverse=True)
    finally:
        cb.close()
        cu.close()


def test_relationship_added_and_deleted(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        added = [c for c in result.relationship_changes if c.kind == "added"]
        deleted = [c for c in result.relationship_changes if c.kind == "deleted"]
        assert any(c.pred_code == "A1020" and c.succ_code == "A1025" for c in added)
        assert any(c.pred_code == "A1010" and c.succ_code == "A1099" for c in deleted)
    finally:
        cb.close()
        cu.close()


def test_relationship_lag_change_detected(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        lag_changes = [c for c in result.relationship_changes if c.kind == "lag changed"]
        assert any(c.pred_code == "A1030" and c.succ_code == "A1040" for c in lag_changes)
    finally:
        cb.close()
        cu.close()


def test_constraint_change_detected(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        assert any(c.task_code == "A1090" for c in result.constraint_changes)
    finally:
        cb.close()
        cu.close()


def test_data_date_and_finish_date_movement(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        assert result.data_date_change is not None
        assert result.finish_date_change is not None
        assert result.data_date_change[1] > result.data_date_change[0]
    finally:
        cb.close()
        cu.close()


def test_match_by_task_code_not_task_id(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        # A1030 keeps the same task_id (40) in both files -- sanity check
        # that matching worked and it's neither added nor deleted.
        added_codes = {a.task_code for a in result.added_activities}
        deleted_codes = {a.task_code for a in result.deleted_activities}
        assert "A1030" not in added_codes
        assert "A1030" not in deleted_codes
    finally:
        cb.close()
        cu.close()


def test_markdown_report_renders(tmp_path):
    result, sb, su, cb, cu = _compare(tmp_path)
    try:
        report = compare_mod.render_markdown_report(result, sb, su)
        assert "# Schedule Comparison Report" in report
        assert "A1025" in report
        assert "A1099" in report
    finally:
        cb.close()
        cu.close()
