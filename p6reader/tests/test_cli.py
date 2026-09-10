"""End-to-end CLI smoke tests using click's test runner."""

from __future__ import annotations

import os

from click.testing import CliRunner

from p6reader.cli import main

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_load_summary_export_check_xer(tmp_path):
    runner = CliRunner()
    db_path = str(tmp_path / "baseline.db")

    result = runner.invoke(main, ["load", os.path.join(FIXTURES, "baseline.xer"), "--out", db_path])
    assert result.exit_code == 0, result.output
    assert os.path.exists(db_path)

    result = runner.invoke(main, ["summary", db_path])
    assert result.exit_code == 0, result.output
    assert "HCTI-01" in result.output

    out_dir = str(tmp_path / "out")
    result = runner.invoke(main, ["export", db_path, "--out", out_dir])
    assert result.exit_code == 0, result.output
    assert os.path.exists(os.path.join(out_dir, "activities.csv"))

    report_path = str(tmp_path / "check.md")
    result = runner.invoke(main, ["check", db_path, "--out", report_path])
    assert result.exit_code == 0, result.output
    assert os.path.exists(report_path)


def test_load_xml(tmp_path):
    runner = CliRunner()
    db_path = str(tmp_path / "baseline_xml.db")
    result = runner.invoke(main, ["load", os.path.join(FIXTURES, "baseline.xml"), "--out", db_path])
    assert result.exit_code == 0, result.output

    result = runner.invoke(main, ["summary", db_path])
    assert result.exit_code == 0, result.output
    assert "Activities: 14" in result.output


def test_compare_cli(tmp_path):
    runner = CliRunner()
    base_db = str(tmp_path / "baseline.db")
    upd_db = str(tmp_path / "update.db")
    runner.invoke(main, ["load", os.path.join(FIXTURES, "baseline.xer"), "--out", base_db])
    runner.invoke(main, ["load", os.path.join(FIXTURES, "update.xer"), "--out", upd_db])

    report_path = str(tmp_path / "compare.md")
    result = runner.invoke(main, ["compare", base_db, upd_db, "--out", report_path])
    assert result.exit_code == 0, result.output
    assert os.path.exists(report_path)
    with open(report_path) as f:
        content = f.read()
    assert "A1025" in content
    assert "A1099" in content


def test_check_with_options(tmp_path):
    runner = CliRunner()
    db_path = str(tmp_path / "baseline.db")
    runner.invoke(main, ["load", os.path.join(FIXTURES, "baseline.xer"), "--out", db_path])
    report_path = str(tmp_path / "check.md")
    result = runner.invoke(
        main,
        [
            "check", db_path, "--out", report_path,
            "--max-duration-days", "5", "--healthcare-overlay",
        ],
    )
    assert result.exit_code == 0, result.output
    with open(report_path) as f:
        content = f.read()
    assert "Healthcare overlay: ON" in content
