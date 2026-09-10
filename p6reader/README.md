# p6reader

Read Primavera P6 schedules in their native export formats (`.xer` and P6
XML), load them into a queryable SQLite store, and audit them without owning
P6.

**Status: no real P6 exports have been validated against this build.** See
`docs/ASSUMPTIONS.md` before trusting output on a real schedule.

## Install

```bash
pip install -e .
```

Requires Python 3.11+. Dependencies: pandas, click, networkx (all pure
Python / no proprietary or P6-specific libraries).

## Commands

### `load`

Parse a `.xer` or P6 XML export into a SQLite database. Format is detected
from the file extension, falling back to content sniffing.

```bash
p6reader load tests/fixtures/baseline.xer --out baseline.db
p6reader load tests/fixtures/baseline.xml --out baseline_xml.db
```

Output lists every table loaded with its row count, and a warnings summary
(unknown tables/fields/values, or calendars that failed to parse, never stop
the load -- they're reported instead).

### `summary`

```bash
p6reader summary baseline.db
```

Prints project name, data date, activity counts by type and status,
relationship count, calendar list (flagging any calendar that fell back to
Mon-Fri/8h because it couldn't be decoded), and the warnings summary.

## P6 XML support

`load` also accepts P6 XML exports (`.xml`, or any file whose content sniffs
as XML/XER regardless of extension). The XML loader maps `<Project>`,
`<WBS>`, `<Activity>`, `<Relationship>`, and `<Calendar>` elements onto the
*same* table/column names the XER loader produces (`PROJECT`, `PROJWBS`,
`TASK`, `TASKPRED`, `CALENDAR`), so `summary`, `export`, `check`, and
`compare` never need to know which format a database came from:

```bash
p6reader load tests/fixtures/baseline.xml --out baseline_xml.db
p6reader summary baseline_xml.db
```

Loading the same project as both `.xer` and P6 XML and comparing their
`summary` output is a good sanity check that the two loaders agree (activity
counts, relationship counts, and a sample of dates should match exactly --
see `tests/test_p6xml_parser.py` for the automated version of this check).

### `export`

```bash
p6reader export baseline.db --format csv --out ./out/
```

Writes `activities.csv`, `relationships.csv`, `wbs.csv`, and
`calendars.csv` with readable, scheduler-facing column names (not raw P6
field names) -- see `docs/COLUMN_MAPPING.md` for the full mapping. Durations,
float, and lag are converted to days using each activity's own calendar.

### `check`

```bash
p6reader check baseline.db --out check.md
p6reader check baseline.db --out check.md \
  --max-duration-days 44 --high-float-days 44 --max-lag-days 10 \
  --healthcare-overlay
```

Runs the schedule logic QC rule set (open starts/finishes, negative float,
circular logic via a graph cycle check, data-date issues, hard constraints,
negative/long lags, Start-to-Finish relationships, out-of-sequence progress,
LOE/WBS-summary relationships, long durations, high float, duplicate names,
calendars that failed to parse, and info-level stats) and writes a
severity-ranked markdown report (Critical/High/Medium/Low/Info). Duration,
float, and lag thresholds are configurable flags. The healthcare keyword
overlay (ICRA/ILSM/ADHS/Joint Commission/TJC/life safety/above ceiling
inspection/licensing) is off by default and is explicitly a keyword
heuristic, not a compliance check.

### `compare`

```bash
p6reader compare baseline.db update.db --out compare.md
```

Matches activities by `task_code` (never `task_id`, which is not stable
across P6 re-exports) and reports: activities added/deleted/renamed;
duration, remaining duration, and calendar changes; date slips in *working
days* (using each activity's own calendar), sorted largest-first;
relationship additions/deletions/type-or-lag changes; constraint changes;
data-date and finish-date movement; and activities that joined or left the
driving (longest) path.

## Querying the raw data

The SQLite file has one table per XER table (`TASK`, `TASKPRED`, `CALENDAR`,
`PROJECT`, `PROJWBS`, `RSRC`, ...), every column stored as TEXT so nothing is
lost, plus `_meta` (source file/format/ERMHDR fields) and `_warnings`:

```bash
sqlite3 baseline.db "select task_code, task_name, status_code from TASK limit 5;"
sqlite3 baseline.db "select * from _warnings;"
```

## Development

```bash
pip install -e ".[dev]"
python -m pytest -q
```

Tests run against hand-built synthetic fixtures in `tests/fixtures/`
(`baseline.xer`, `update.xer`, `cycle.xer`, `baseline.xml`) -- see
`docs/ASSUMPTIONS.md` for why, and what to check when real samples are
available.

## Phase 4 (not implemented)

Independent CPM recalculation (`p6reader recalc`) is deferred -- see
`p6reader/cpm.py`. It requires validation against at least three real P6
sample exports before it can be trusted; none were available at build time.

## Documentation

- `docs/ASSUMPTIONS.md` -- every format assumption made in this build, and
  how to verify it once real P6 exports are available. **Read this before
  trusting any output on a real schedule.**
- `docs/XER_FORMAT_NOTES.md` -- the XER file grammar and calendar
  (`clndr_data`) decoding details.
- `docs/COLUMN_MAPPING.md` -- CSV export column names mapped back to their
  P6/XER source fields.
