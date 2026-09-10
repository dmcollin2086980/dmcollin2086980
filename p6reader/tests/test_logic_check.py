"""Tests for the schedule logic QC rules engine.

Each rule is checked against the planted case in the synthetic fixtures.
"""

from __future__ import annotations

import os

from p6reader import logic_check
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


def _rules_by_name(findings):
    from collections import defaultdict
    by_rule = defaultdict(list)
    for f in findings:
        by_rule[f.rule].append(f)
    return by_rule


def test_open_start_and_finish(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert any("A1000" in f.activity_codes for f in by_rule["Open start"])
        assert any("A1099" in f.activity_codes for f in by_rule["Open finish"])
    finally:
        conn.close()


def test_negative_total_float(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert any("A1099" in f.activity_codes for f in by_rule["Negative total float"])
    finally:
        conn.close()


def test_circular_logic(tmp_path):
    conn, schedule = _schedule(tmp_path, "cycle.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert len(by_rule["Circular logic"]) == 1
        codes = set(by_rule["Circular logic"][0].activity_codes)
        assert codes == {"B1000", "B1010", "B1020"}
    finally:
        conn.close()


def test_actual_after_data_date(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert len(by_rule["Actual date after data date"]) >= 1
    finally:
        conn.close()


def test_mandatory_constraint(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert any("A1090" in f.activity_codes for f in by_rule["Hard constraint"])
    finally:
        conn.close()


def test_negative_lag_relationship(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert len(by_rule["Negative lag"]) >= 1
    finally:
        conn.close()


def test_long_lag_relationship(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule, logic_check.CheckOptions(max_lag_days=10))
        by_rule = _rules_by_name(findings)
        assert len(by_rule["Long lag"]) >= 1
    finally:
        conn.close()


def test_start_to_finish_relationship(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert len(by_rule["Start to Finish relationship"]) >= 1
    finally:
        conn.close()


def test_out_of_sequence_progress(tmp_path):
    conn, schedule = _schedule(tmp_path, "update.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert len(by_rule["Out of sequence progress"]) >= 1
    finally:
        conn.close()


def test_loe_relationship_flagged(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert len(by_rule["Relationship to/from LOE or WBS summary"]) >= 1
    finally:
        conn.close()


def test_long_duration(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert any("A1050" in f.activity_codes for f in by_rule["Long duration"])
    finally:
        conn.close()


def test_high_float(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert any("A1090" in f.activity_codes for f in by_rule["High float"])
    finally:
        conn.close()


def test_milestone_with_duration(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert any("MS-FIN" in f.activity_codes for f in by_rule["Milestone with duration"])
    finally:
        conn.close()


def test_calendar_failed_to_parse_flagged(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert any("A1010" in f.activity_codes for f in by_rule["Calendar failed to parse"])
    finally:
        conn.close()


def test_duplicate_activity_name(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert len(by_rule["Duplicate activity name"]) == 1
        codes = set(by_rule["Duplicate activity name"][0].activity_codes)
        assert codes == {"A1070", "A1071"}
    finally:
        conn.close()


def test_info_rules_present(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert by_rule["Relationship type mix"]
        assert by_rule["Driving path"]
        assert by_rule["Float distribution"]
        assert by_rule["Calendar"]
    finally:
        conn.close()


def test_healthcare_overlay_off_by_default(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        findings = logic_check.run_all_checks(schedule)
        by_rule = _rules_by_name(findings)
        assert "Healthcare overlay" not in by_rule
    finally:
        conn.close()


def test_healthcare_overlay_finds_icra_activity(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        options = logic_check.CheckOptions(healthcare_overlay=True)
        findings = logic_check.run_all_checks(schedule, options)
        by_rule = _rules_by_name(findings)
        assert by_rule["Healthcare overlay"]
        assert "A1060" in by_rule["Healthcare overlay"][0].activity_codes
    finally:
        conn.close()


def test_thresholds_are_configurable(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        strict = logic_check.run_all_checks(schedule, logic_check.CheckOptions(max_duration_days=5))
        by_rule = _rules_by_name(strict)
        # With a 5-day threshold, many more activities should trigger "Long duration".
        assert len(by_rule["Long duration"]) > 1
    finally:
        conn.close()


def test_markdown_report_renders_all_severities(tmp_path):
    conn, schedule = _schedule(tmp_path, "baseline.xer")
    try:
        options = logic_check.CheckOptions()
        findings = logic_check.run_all_checks(schedule, options)
        report = logic_check.render_markdown_report(findings, options, schedule)
        for sev in logic_check.SEVERITIES:
            assert f"## {sev}" in report
    finally:
        conn.close()
