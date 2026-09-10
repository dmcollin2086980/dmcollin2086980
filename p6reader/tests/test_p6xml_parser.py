"""Tests for the P6 XML parser and its parity with the XER parser."""

from __future__ import annotations

import datetime
import os

from p6reader import model as model_mod
from p6reader import p6xml
from p6reader import store
from p6reader import xer as xer_mod

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_schedule(tmp_path, filename, fmt):
    path = os.path.join(FIXTURES, filename)
    db_path = str(tmp_path / f"{filename}.db")
    if fmt == "xer":
        parsed = xer_mod.parse_xer_file(path)
    else:
        parsed = p6xml.parse_xml_file(path)
    store.build_store(
        db_path=db_path,
        source_path=path,
        source_format=fmt,
        tables=parsed.tables,
        warnings=parsed.warnings,
    )
    conn = store.connect(db_path)
    schedule = model_mod.load_schedule(conn)
    return conn, schedule


def test_xml_namespace_detected():
    parsed = p6xml.parse_xml_file(os.path.join(FIXTURES, "baseline.xml"))
    assert parsed.namespace is not None
    assert "xmlns.oracle.com/Primavera/P6" in parsed.namespace


def test_xml_activity_and_relationship_counts():
    parsed = p6xml.parse_xml_file(os.path.join(FIXTURES, "baseline.xml"))
    assert len(parsed.tables["TASK"].rows) == 14
    assert len(parsed.tables["TASKPRED"].rows) == 15


def test_xml_never_raises_on_garbage(tmp_path):
    bad = tmp_path / "bad.xml"
    bad.write_bytes(b"<not><valid<xml")
    parsed = p6xml.parse_xml_bytes(bad.read_bytes())
    assert parsed.warnings
    assert parsed.tables == {}


def test_xml_type_and_status_mapping():
    parsed = p6xml.parse_xml_file(os.path.join(FIXTURES, "baseline.xml"))
    by_code = {r["task_code"]: r for r in parsed.tables["TASK"].rows}
    assert by_code["A1080"]["task_type"] == "TT_LOE"
    assert by_code["MS-FIN"]["task_type"] == "TT_FinMile"
    assert by_code["A1020"]["status_code"] == "TK_Active"
    assert by_code["A1090"]["cstr_type"] == "CS_MSO"


def test_xml_relationship_type_mapping():
    parsed = p6xml.parse_xml_file(os.path.join(FIXTURES, "baseline.xml"))
    types = {r["pred_type"] for r in parsed.tables["TASKPRED"].rows}
    assert "PR_FS" in types
    assert "PR_SS" in types
    assert "PR_SF" in types


def test_xer_vs_xml_parity_activity_and_relationship_counts(tmp_path):
    conn_xer, sched_xer = _load_schedule(tmp_path, "baseline.xer", "xer")
    conn_xml, sched_xml = _load_schedule(tmp_path, "baseline.xml", "xml")
    try:
        assert len(sched_xer.activities) == len(sched_xml.activities)
        assert len(sched_xer.relationships) == len(sched_xml.relationships)
        assert set(sched_xer.activities_by_code.keys()) == set(sched_xml.activities_by_code.keys())
    finally:
        conn_xer.close()
        conn_xml.close()


def test_xer_vs_xml_parity_sample_dates(tmp_path):
    conn_xer, sched_xer = _load_schedule(tmp_path, "baseline.xer", "xer")
    conn_xml, sched_xml = _load_schedule(tmp_path, "baseline.xml", "xml")
    try:
        act_xer = sched_xer.activities_by_code["A1020"]
        act_xml = sched_xml.activities_by_code["A1020"]
        assert act_xer.early_start == act_xml.early_start == datetime.datetime(2026, 1, 22, 8, 0)
        assert act_xer.target_drtn_hr == act_xml.target_drtn_hr == 120.0

        act_xer2 = sched_xer.activities_by_code["A1090"]
        act_xml2 = sched_xml.activities_by_code["A1090"]
        assert act_xer2.cstr_date == act_xml2.cstr_date == datetime.datetime(2026, 6, 8, 8, 0)
    finally:
        conn_xer.close()
        conn_xml.close()


def test_xer_vs_xml_parity_project(tmp_path):
    conn_xer, sched_xer = _load_schedule(tmp_path, "baseline.xer", "xer")
    conn_xml, sched_xml = _load_schedule(tmp_path, "baseline.xml", "xml")
    try:
        assert sched_xer.project.short_name == sched_xml.project.short_name
        assert sched_xer.project.plan_start == sched_xml.project.plan_start
    finally:
        conn_xer.close()
        conn_xml.close()
