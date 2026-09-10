# XER format notes

Working notes on the .xer file format as implemented by `p6reader/xer.py` and
`p6reader/calendars.py`. These notes describe what the parser assumes and
implements; cross-check every claim here against a real P6 export before
trusting it on real data (see `ASSUMPTIONS.md`).

## File structure

- Line 1: `ERMHDR\t<version>\t<export_date>\t<project_name>\t<exported_by>\t<user>\t<app_name>\t...\t<currency>`.
  Field order/count for ERMHDR is not fully standardized across P6 versions;
  the parser reads positionally and tolerates a short header line.
- `%T\t<table_name>` opens (or re-opens) a table block.
- `%F\t<field1>\t<field2>\t...` declares the column order for the table
  block that follows, until the next `%T`.
- `%R\t<v1>\t<v2>\t...` is one data row, tab-delimited, in the order given
  by the most recent `%F`. Trailing empty fields are frequently omitted by
  P6's exporter -- the parser pads short rows with empty strings rather than
  rejecting them.
- `%E` marks end of file.
- Encoding: cp1252 by default (P6 exports are Windows-locale text), with a
  latin-1 fallback that never raises (every byte decodes under latin-1).

## Tables

Every table in the file is preserved losslessly as raw string columns (see
`store.py`). The following tables get typed conversions in `model.py`:

- `PROJECT`, `PROJWBS`, `TASK`, `TASKPRED`, `CALENDAR`.

All other tables (`RSRC`, `TASKRSRC`, `UDFTYPE`, `UDFVALUE`, `ACTVTYPE`,
`ACTVCODE`, `TASKACTV`, `CURRTYPE`, etc.) are stored as-is and queryable via
SQL, but are not surfaced by the higher-level model/export/QC code in this
build.

## Dates

Observed/assumed format: `YYYY-MM-DD HH:MM` (24-hour clock, no seconds).
Empty string means null. The parser also accepts a few ISO-8601 variants
defensively (P6 XML uses `YYYY-MM-DDTHH:MM:SS`), since `model.py`'s date
parser is shared conceptually across formats.

## Durations and floats

All `*_hr_cnt` fields (`target_drtn_hr_cnt`, `remain_drtn_hr_cnt`,
`total_float_hr_cnt`, `free_float_hr_cnt`, `lag_hr_cnt`) are in hours.
Conversion to days always divides by the *activity's own calendar's*
`day_hr_cnt` -- never a hardcoded 8 -- via `calendars.hours_to_days()`.

## clndr_data grammar (ASSUMED, UNVERIFIED)

`CALENDAR.clndr_data` is a nested, parenthesis-delimited string. The grammar
implemented in `calendars.py` (based on widely circulated community
documentation of the XER format, not on an Oracle-published spec):

```
(0||CalendarData()(
  (0||DaysOfWeek()(
    (0||1(s|08:00|f|17:00)())     <- Monday: one shift, 08:00-17:00
    (0||2(s|08:00|f|17:00)())
    (0||3(s|08:00|f|17:00)())
    (0||4(s|08:00|f|17:00)())
    (0||5(s|08:00|f|17:00)())
    (0||6()())                    <- Saturday: no shift = non-working
    (0||7()())                    <- Sunday: no shift = non-working
  ))
  (0||Exceptions()(
    (0||0(d|46023)())             <- exception dated day 46023, 0 shifts = full holiday
  ))
))
```

Assumptions baked into this grammar, all UNVERIFIED against a real export:

1. **Weekday numbering is Monday=1 ... Sunday=7.** This is what section 3.3
   of the build spec states. Some community documentation of real P6
   clndr_data instead uses Sunday=1 ... Saturday=7. If a real sample shows
   the parser's weekday hours mapped to the wrong days (e.g. Saturday
   looking like a workday), flip the mapping in `calendars.py`
   (`hours_for_weekday`/`is_working_day` use `date.isoweekday()`, which is
   Monday=1..Sunday=7 -- adjust the translation there, not the parser).
2. A day entry with no `s|..|f|..` shift means zero working hours that day.
   A day can have more than one shift (split shift); hours are summed.
3. `Exceptions` entries carry a `d|<ordinal>` date and, optionally, their
   own shift(s); no shift present means a full non-working day (holiday).
   A shift present would mean a partial working day (e.g. half-day).
4. The date ordinal in `d|<n>` uses the Lotus/Excel serial-date epoch,
   1899-12-30 = day 0. **This is the biggest unverified assumption** --
   verify by picking one exception in a real file, decoding it with this
   epoch, and checking whether the resulting calendar date matches a known
   holiday in that calendar (e.g. July 4, Thanksgiving, Christmas).
5. `day_hr_cnt` (a top-level CALENDAR column) is the calendar's nominal
   hours/day and is used directly for hour-to-day conversion, independent of
   what the DaysOfWeek shifts compute to.

Any calendar whose `clndr_data` does not parse under this grammar (missing
parens, no recognizable `DaysOfWeek` section, non-numeric `day_hr_cnt`,
etc.) falls back to a Monday-Friday, 8-hour, no-holiday calendar, and every
activity assigned to it is flagged in warnings and in the `check` report
(rule: "activity on a calendar that failed to parse").

## How to verify against a real file

1. Get one real `.xer` export.
2. `p6reader load real.xer --out real.db` and check the warnings output --
   any "could not find a usable DaysOfWeek section" or "unparseable"
   warning means the grammar above needs adjusting for that P6 version.
3. `p6reader export real.db --format csv --out ./real_out/` and eyeball
   `calendars.csv` against what you know about that calendar in P6 itself
   (open the calendar dialog in P6, compare weekday hours and holiday list).
4. If dates or weekday hours are wrong, adjust `_parse_days_of_week`,
   `_parse_exceptions`, or `DATE_ORDINAL_EPOCH` in `calendars.py` and rerun
   the calendar unit tests plus this manual check.
