"""Unit tests for calendar decoding and working-time math."""

from __future__ import annotations

import datetime

from p6reader import calendars as cal

VALID_CLNDR_DATA = (
    "(0||CalendarData()(  (0||DaysOfWeek()(    (0||1(s|08:00|f|17:00)())    "
    "(0||2(s|08:00|f|17:00)())    (0||3(s|08:00|f|17:00)())    "
    "(0||4(s|08:00|f|17:00)())    (0||5(s|08:00|f|17:00)())    "
    "(0||6()())    (0||7()())  ))  (0||Exceptions()(    "
    "(0||0(d|46023)())  ))))"
)


def test_parse_valid_calendar():
    parsed = cal.parse_clndr_data("1001", "5 Day Workweek", VALID_CLNDR_DATA, "8")
    assert not parsed.is_fallback
    assert parsed.day_hr_cnt == 8.0
    assert parsed.hours_for_weekday(1) == 9.0  # Monday (08:00-17:00 shift window)
    assert parsed.hours_for_weekday(6) == 0.0  # Saturday
    assert parsed.hours_for_weekday(7) == 0.0  # Sunday
    assert datetime.date(2026, 1, 1) in parsed.exceptions
    assert parsed.exceptions[datetime.date(2026, 1, 1)] == 0.0


def test_parse_garbled_calendar_falls_back():
    warnings = []
    parsed = cal.parse_clndr_data(
        "1002", "Garbled", "(0||NotEvenClose", "not-a-number", warn=warnings.append
    )
    assert parsed.is_fallback
    assert parsed.day_hr_cnt == 8.0
    assert parsed.hours_for_weekday(1) == 8.0
    assert parsed.hours_for_weekday(6) == 0.0
    assert warnings  # at least one warning logged


def test_parse_empty_calendar_falls_back():
    parsed = cal.parse_clndr_data("1003", "Empty", "", "8")
    assert parsed.is_fallback


def test_parse_never_raises_on_garbage():
    garbage_inputs = [None, "", "(((((", ")))))", "random text", "(0||CalendarData()())"]
    for g in garbage_inputs:
        parsed = cal.parse_clndr_data("x", "x", g, "8")
        assert isinstance(parsed, cal.ParsedCalendar)


def test_working_days_between():
    parsed = cal.parse_clndr_data("1001", "5 Day Workweek", VALID_CLNDR_DATA, "8")
    # 2026-01-05 is a Monday, 2026-01-09 is a Friday -> 4 working days between.
    start = datetime.date(2026, 1, 5)
    end = datetime.date(2026, 1, 9)
    assert cal.working_days_between(parsed, start, end) == 4


def test_working_days_between_skips_holiday_exception():
    parsed = cal.parse_clndr_data("1001", "5 Day Workweek", VALID_CLNDR_DATA, "8")
    # 2026-01-01 is a holiday exception in the fixture. Range spans it.
    start = datetime.date(2025, 12, 30)
    end = datetime.date(2026, 1, 2)
    # 12/31 (Wed, work), 1/1 (holiday, excluded), 1/2 (Fri, work) = 2 working days
    assert cal.working_days_between(parsed, start, end) == 2


def test_add_working_days():
    parsed = cal.parse_clndr_data("1001", "5 Day Workweek", VALID_CLNDR_DATA, "8")
    start = datetime.date(2026, 1, 5)  # Monday
    result = cal.add_working_days(parsed, start, 5)
    assert result == datetime.date(2026, 1, 12)  # next Monday (skips weekend)


def test_add_working_days_negative():
    parsed = cal.parse_clndr_data("1001", "5 Day Workweek", VALID_CLNDR_DATA, "8")
    start = datetime.date(2026, 1, 12)
    result = cal.add_working_days(parsed, start, -5)
    assert result == datetime.date(2026, 1, 5)


def test_hours_to_days_uses_calendar_not_hardcoded_8():
    ten_hour_calendar = cal.ParsedCalendar(day_hr_cnt=10.0, weekday_hours={1: 10, 2: 10, 3: 10, 4: 10})
    assert cal.hours_to_days(40.0, ten_hour_calendar) == 4.0
    eight_hour_calendar = cal.ParsedCalendar(day_hr_cnt=8.0)
    assert cal.hours_to_days(40.0, eight_hour_calendar) == 5.0


def test_hours_to_days_none_passthrough():
    parsed = cal.ParsedCalendar()
    assert cal.hours_to_days(None, parsed) is None
