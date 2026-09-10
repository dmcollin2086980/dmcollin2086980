"""Calendar decoding and working-time math.

P6's XER ``CALENDAR.clndr_data`` field is a nested, parenthesis-delimited
string. This module contains a *tolerant* parser for it: it never raises on
malformed input. If it cannot make sense of the data, it logs a warning and
falls back to a Monday-Friday, 8-hour-day calendar with no holidays.

The exact clndr_data grammar implemented here is an assumption based on
widely published community documentation of the XER format (see
``docs/XER_FORMAT_NOTES.md`` and ``docs/ASSUMPTIONS.md``). It has not been
validated against a real P6 export. Verify against a real ``.xer`` file
before trusting calendar output on real projects.

Date ordinals in ``Exceptions`` entries (``d|<n>``) are assumed to use the
Lotus/Excel serial date epoch of 1899-12-30 (day 0). This is a common
convention in P6-adjacent tools but is *not confirmed* against a real P6
export -- see docs/ASSUMPTIONS.md.
"""

from __future__ import annotations

import datetime
import re
from dataclasses import dataclass, field

# Assumed epoch for P6 date ordinals used in clndr_data Exceptions (d|<n>).
# 1899-12-30 is the classic Lotus 1-2-3 / Excel serial-date epoch.
# UNVERIFIED against a real P6 export -- see docs/ASSUMPTIONS.md.
DATE_ORDINAL_EPOCH = datetime.date(1899, 12, 30)

# Default fallback calendar: Mon-Fri, 8 hours/day, no holidays.
DEFAULT_WORKDAYS = {1, 2, 3, 4, 5}  # P6 numbering: Monday=1 ... Sunday=7
DEFAULT_DAY_HOURS = 8.0


@dataclass
class WorkDay:
    """Working hours defined for one weekday (P6 numbering, Monday=1)."""

    weekday: int
    hours: float


@dataclass
class ParsedCalendar:
    """A decoded calendar: standard hours per weekday plus exceptions.

    ``exceptions`` maps a ``datetime.date`` to the hours worked that day
    (0.0 for a full holiday, a nonzero value for a shortened day).
    """

    clndr_id: str = ""
    clndr_name: str = ""
    day_hr_cnt: float = DEFAULT_DAY_HOURS
    weekday_hours: dict[int, float] = field(default_factory=dict)
    exceptions: dict[datetime.date, float] = field(default_factory=dict)
    is_fallback: bool = False
    parse_error: str | None = None

    def hours_for_weekday(self, weekday: int) -> float:
        return self.weekday_hours.get(weekday, 0.0)

    def is_working_day(self, d: datetime.date) -> bool:
        if d in self.exceptions:
            return self.exceptions[d] > 0
        # Python: Monday=0 .. Sunday=6. P6: Monday=1 .. Sunday=7.
        p6_weekday = d.isoweekday()
        return self.hours_for_weekday(p6_weekday) > 0

    def hours_on(self, d: datetime.date) -> float:
        if d in self.exceptions:
            return self.exceptions[d]
        return self.hours_for_weekday(d.isoweekday())


def _fallback_calendar(clndr_id: str, clndr_name: str, reason: str) -> ParsedCalendar:
    return ParsedCalendar(
        clndr_id=clndr_id,
        clndr_name=clndr_name,
        day_hr_cnt=DEFAULT_DAY_HOURS,
        weekday_hours={d: DEFAULT_DAY_HOURS for d in DEFAULT_WORKDAYS},
        exceptions={},
        is_fallback=True,
        parse_error=reason,
    )


def _find_balanced(text: str, start: int) -> int:
    """Return index just past the parenthesis group opened at ``start``.

    ``text[start]`` must be '('. Tolerant of unbalanced input: returns
    ``len(text)`` if no matching close paren is found.
    """
    depth = 0
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def _extract_section(text: str, name: str) -> str | None:
    """Find e.g. 'DaysOfWeek()(...)' and return the inner '(...)' content."""
    idx = text.find(name)
    if idx == -1:
        return None
    # After the name, P6 emits '()(' then the section body, closed with ')'.
    after = idx + len(name)
    # Skip an empty-paren marker '()' if present.
    m = re.match(r"\s*\(\)\s*", text[after:])
    body_start = after + (m.end() if m else 0)
    if body_start >= len(text) or text[body_start] != "(":
        return None
    body_end = _find_balanced(text, body_start)
    return text[body_start + 1 : body_end - 1]


def _parse_days_of_week(section: str) -> dict[int, float]:
    """Parse entries like '(0||1()())' or '(0||2(s|08:00|f|17:00)())'."""
    result: dict[int, float] = {}
    # Each weekday entry begins '(0||<n>' followed by a paren group that may
    # contain 's|HH:MM|f|HH:MM' shift definitions (possibly several).
    for m in re.finditer(r"\(0\|\|(\d)\(", section):
        day_num = int(m.group(1))
        shift_start = m.end() - 1  # position of the '(' after the day number
        shift_end = _find_balanced(section, shift_start)
        shift_body = section[shift_start + 1 : shift_end - 1]
        hours = 0.0
        for shift_m in re.finditer(
            r"s\|(\d{1,2}):(\d{2})\|f\|(\d{1,2}):(\d{2})", shift_body
        ):
            sh, sm, fh, fm = (int(g) for g in shift_m.groups())
            start_minutes = sh * 60 + sm
            finish_minutes = fh * 60 + fm
            delta = (finish_minutes - start_minutes) / 60.0
            if delta > 0:
                hours += delta
        result[day_num] = hours
    return result


def _parse_exceptions(section: str) -> dict[datetime.date, float]:
    """Parse entries like '(0||0(d|46023)())' -> {date: 0.0 hours}."""
    result: dict[datetime.date, float] = {}
    for m in re.finditer(r"\(0\|\|\d+\(([^()]*)\)", section):
        body = m.group(1)
        date_m = re.search(r"d\|(\d+)", body)
        if not date_m:
            continue
        ordinal = int(date_m.group(1))
        try:
            the_date = DATE_ORDINAL_EPOCH + datetime.timedelta(days=ordinal)
        except OverflowError:
            continue
        hours = 0.0
        # Exceptions can carry explicit shift hours; default is a full holiday.
        for shift_m in re.finditer(
            r"s\|(\d{1,2}):(\d{2})\|f\|(\d{1,2}):(\d{2})", body
        ):
            sh, sm, fh, fm = (int(g) for g in shift_m.groups())
            hours += ((fh * 60 + fm) - (sh * 60 + sm)) / 60.0
        result[the_date] = hours
    return result


def parse_clndr_data(
    clndr_id: str,
    clndr_name: str,
    clndr_data: str | None,
    day_hr_cnt_raw: str | None,
    warn=None,
) -> ParsedCalendar:
    """Tolerantly decode a CALENDAR.clndr_data string.

    Never raises. On any failure, returns a Mon-Fri/8h fallback calendar with
    ``is_fallback=True`` and a ``parse_error`` message; if a warn callback is
    given, it is invoked with a human-readable warning string.
    """

    def _warn(msg: str) -> None:
        if warn is not None:
            warn(msg)

    try:
        day_hr_cnt = float(day_hr_cnt_raw) if day_hr_cnt_raw not in (None, "") else DEFAULT_DAY_HOURS
    except (TypeError, ValueError):
        day_hr_cnt = DEFAULT_DAY_HOURS

    if not clndr_data or "(" not in clndr_data:
        reason = f"calendar {clndr_id!r} ({clndr_name!r}) has empty/unparseable clndr_data"
        _warn(reason + "; falling back to Mon-Fri 8h")
        return _fallback_calendar(clndr_id, clndr_name, reason)

    try:
        days_section = _extract_section(clndr_data, "DaysOfWeek")
        weekday_hours = _parse_days_of_week(days_section) if days_section else {}

        exceptions_section = _extract_section(clndr_data, "Exceptions")
        exceptions = _parse_exceptions(exceptions_section) if exceptions_section else {}

        if not weekday_hours:
            reason = (
                f"calendar {clndr_id!r} ({clndr_name!r}): could not find a usable "
                "DaysOfWeek section in clndr_data"
            )
            _warn(reason + "; falling back to Mon-Fri 8h")
            return _fallback_calendar(clndr_id, clndr_name, reason)

        return ParsedCalendar(
            clndr_id=clndr_id,
            clndr_name=clndr_name,
            day_hr_cnt=day_hr_cnt,
            weekday_hours=weekday_hours,
            exceptions=exceptions,
            is_fallback=False,
            parse_error=None,
        )
    except Exception as exc:  # noqa: BLE001 - tolerant by design, never crash
        reason = f"calendar {clndr_id!r} ({clndr_name!r}) failed to parse: {exc}"
        _warn(reason + "; falling back to Mon-Fri 8h")
        return _fallback_calendar(clndr_id, clndr_name, reason)


def hours_to_days(hours: float | None, calendar: ParsedCalendar) -> float | None:
    """Convert an hours quantity to days using the calendar's day_hr_cnt.

    Never uses a hardcoded 8. Returns None if hours is None. If the
    calendar's day_hr_cnt is zero or invalid, falls back to 8.0 hours/day.
    """
    if hours is None:
        return None
    day_hours = calendar.day_hr_cnt if calendar.day_hr_cnt and calendar.day_hr_cnt > 0 else DEFAULT_DAY_HOURS
    return hours / day_hours


def working_days_between(
    calendar: ParsedCalendar, start: datetime.date, end: datetime.date
) -> int:
    """Count working days strictly between two calendar dates (inclusive of
    start's boundary logic: counts whole working days from start up to end,
    exclusive of start, inclusive of end, matching typical "days elapsed"
    semantics). Returns a negative number if end precedes start.
    """
    if start == end:
        return 0
    sign = 1
    a, b = start, end
    if end < start:
        sign = -1
        a, b = end, start
    count = 0
    d = a
    one_day = datetime.timedelta(days=1)
    while d < b:
        d = d + one_day
        if calendar.is_working_day(d):
            count += 1
    return sign * count


def add_working_days(calendar: ParsedCalendar, start: datetime.date, n: int) -> datetime.date:
    """Add n working days to start using the given calendar.

    n may be negative to go backwards. n == 0 returns start unchanged.
    """
    d = start
    step = 1 if n >= 0 else -1
    remaining = abs(n)
    one_day = datetime.timedelta(days=step)
    while remaining > 0:
        d = d + one_day
        if calendar.is_working_day(d):
            remaining -= 1
    return d
