"""Round-trip and unit tests for the XER parser."""

from __future__ import annotations

import os

from p6reader import xer as xer_mod

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def _raw_table_counts(path: str) -> dict[str, tuple[int, int]]:
    """Reference-implementation-free ground truth: count %F fields and %R
    rows per table directly from the raw file text, independent of the
    parser under test.
    """
    counts: dict[str, tuple[int, int]] = {}
    current = None
    field_count = 0
    row_count = 0
    with open(path, "rb") as f:
        text = f.read().decode("cp1252")
    for line in text.split("\n"):
        line = line.rstrip("\r\n")
        if not line:
            continue
        parts = line.split("\t")
        marker = parts[0]
        if marker == "%T":
            if current is not None:
                counts[current] = (field_count, row_count)
            current = parts[1].strip()
            field_count = 0
            row_count = 0
        elif marker == "%F":
            field_count = len(parts) - 1
        elif marker == "%R":
            row_count += 1
    if current is not None:
        counts[current] = (field_count, row_count)
    return counts


def test_round_trip_baseline():
    path = os.path.join(FIXTURES, "baseline.xer")
    parsed = xer_mod.parse_xer_file(path)
    expected = _raw_table_counts(path)
    assert set(parsed.tables.keys()) == set(expected.keys())
    for name, (field_count, row_count) in expected.items():
        table = parsed.tables[name]
        assert len(table.fields) == field_count, f"{name} field count mismatch"
        assert len(table.rows) == row_count, f"{name} row count mismatch"


def test_round_trip_update():
    path = os.path.join(FIXTURES, "update.xer")
    parsed = xer_mod.parse_xer_file(path)
    expected = _raw_table_counts(path)
    for name, (field_count, row_count) in expected.items():
        table = parsed.tables[name]
        assert len(table.fields) == field_count
        assert len(table.rows) == row_count


def test_header_parsed():
    path = os.path.join(FIXTURES, "baseline.xer")
    parsed = xer_mod.parse_xer_file(path)
    assert parsed.header.version == "8.4"
    assert parsed.header.export_date == "2026-01-05"


def test_task_table_has_expected_activity_count():
    path = os.path.join(FIXTURES, "baseline.xer")
    parsed = xer_mod.parse_xer_file(path)
    assert len(parsed.tables["TASK"].rows) == 14


def test_no_exception_on_malformed_row(tmp_path):
    bad = tmp_path / "bad.xer"
    bad.write_bytes(
        b"ERMHDR\t8.4\t2026-01-01\tP\tu\tu\tapp\tUSD\n"
        b"%T\tTASK\n"
        b"%F\ttask_id\ttask_code\ttask_name\n"
        b"%R\t1\tA1\tGood Row\n"
        b"%R\t2\tA2\n"  # missing trailing field, should be padded not crash
        b"%R\n"  # empty row, should warn not crash
        b"%X\tsome garbage marker\n"  # unknown marker
        b"%E\n"
    )
    parsed = xer_mod.parse_xer_bytes(bad.read_bytes())
    assert len(parsed.tables["TASK"].rows) == 2
    assert parsed.tables["TASK"].rows[1]["task_name"] == ""
    assert len(parsed.warnings) >= 1


def test_missing_end_marker_warns(tmp_path):
    bad = tmp_path / "noend.xer"
    bad.write_bytes(b"ERMHDR\t8.4\t2026-01-01\tP\tu\tu\tapp\tUSD\n%T\tTASK\n%F\ttask_id\n%R\t1\n")
    parsed = xer_mod.parse_xer_bytes(bad.read_bytes())
    assert any("%E" in w for w in parsed.warnings)


def test_encoding_fallback_does_not_crash():
    # A byte sequence invalid in strict utf-8 but valid in cp1252 (e.g. 0x93 curly quote).
    raw = b"ERMHDR\t8.4\t2026-01-01\tP\tu\tu\tapp\tUSD\n%T\tTASK\n%F\ttask_name\n%R\t\x93Quoted\x94\n%E\n"
    parsed = xer_mod.parse_xer_bytes(raw)
    assert parsed.tables["TASK"].rows[0]["task_name"] == "“Quoted”"
