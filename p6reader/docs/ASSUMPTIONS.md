# Assumptions -- READ THIS FIRST

**No real Primavera P6 exports (.xer or P6 XML) have been used or validated
against this build.** `samples/` was empty when this tool was built and the
person who would supply real exports was not available to ask. Everything
in this tool was built and tested against **synthetic fixtures** written by
hand in `tests/fixtures/` (`baseline.xer`, `update.xer`, `cycle.xer`,
`baseline.xml`), following published/community documentation of the XER and
P6 XML formats plus the format description in the build spec.

**Do not trust any output of this tool on a real GC schedule until you have
run it against at least one real `.xer` and one real P6 XML export and
checked every item below.** Treat the first real run as a validation
exercise, not a QC deliverable: load the file, read every warning it prints,
and check dates/calendars/durations against what P6 itself shows for the
same project before relying on `check`/`compare` output for a real decision.

## How to validate, once you have real samples

1. Drop the files in `samples/` (gitignored, never committed).
2. `p6reader load samples/real.xer --out /tmp/real.db` -- read every
   warning. Any "unparseable calendar", "unknown task_type", "unknown
   pred_type", or "unknown status_code" warning means this tool encountered
   something the synthetic fixtures never exercised. Investigate before
   trusting downstream output for that file.
3. Compare `p6reader summary /tmp/real.db` against what P6 itself reports
   for the same project (activity counts by type/status, calendar list).
4. If you also have the same project exported as P6 XML, run `load` on
   both and diff `p6reader export` output for parity (see
   `docs/COLUMN_MAPPING.md`), per the Phase 2 acceptance criterion.

## Assumption list

### File-level (XER)

| # | Assumption | Where used | How to verify |
|---|---|---|---|
| 1 | Default encoding is cp1252, falling back to latin-1. | `xer.py: _decode_bytes` | Open a real .xer in a hex editor / `file` command; look for non-ASCII bytes in project names, check they render correctly after load. |
| 2 | Dates are `YYYY-MM-DD HH:MM`, 24-hour, no seconds. | `model.py: parse_p6_date` | Inspect a few `TASK.early_start_date` values directly in a real .xer with a text editor. |
| 3 | `*_hr_cnt` fields are hours, converted to days via that activity's own calendar `day_hr_cnt`. | `calendars.py: hours_to_days` | Compare a known activity's `target_drtn_hr_cnt` / calendar hours/day against the duration P6 displays in days. |
| 4 | ERMHDR field order is `ERMHDR, version, export_date, project_name, exported_by, user, app_name, ..., currency` (positional, tolerant of a short line). | `xer.py: _parse_header` | Read the first line of a real .xer directly; adjust indices in `_parse_header` if the order differs for your P6 version. |
| 5 | Trailing omitted fields in a `%R` row should be treated as empty strings, not an error. | `xer.py: parse_xer_bytes` | Look for `%R` rows in a real file with fewer tab-separated values than the table's `%F` line. |

### Calendar grammar (`clndr_data`) -- see `docs/XER_FORMAT_NOTES.md` for the full grammar

| # | Assumption | How to verify |
|---|---|---|
| 6 | Weekday numbering in `DaysOfWeek` is Monday=1 ... Sunday=7 (per build spec section 3.3). | Load a real calendar and check whether the decoded weekday hours line up with the actual work week P6 shows for that calendar (e.g. does day "6" show Friday's hours or Saturday's?). If flipped, adjust the day-number-to-weekday mapping in `calendars.py`. |
| 7 | A day entry with no `s\|HH:MM\|f\|HH:MM` shift means a non-working day. | Compare a calendar you know includes a 6-day work week; confirm Saturday shows a shift in the raw string. |
| 8 | `Exceptions` entries with no shift are full holidays (0 hours); entries with a shift are partial/half-days. | Find a known holiday's exception entry in a real file and confirm it decodes with 0 hours. |
| 9 | Date ordinals in `d\|<n>` use the Lotus/Excel 1899-12-30 epoch. **This is the single riskiest assumption in the whole tool.** | Decode one exception you can identify (e.g. a well-known holiday close to the file's data date) and confirm the resulting calendar date matches. If off, the epoch or day-count convention (1900 leap year bug, etc.) needs correcting in `DATE_ORDINAL_EPOCH`. |
| 10 | If `clndr_data` cannot be parsed under the assumed grammar, falling back to Mon-Fri/8h and flagging every activity on that calendar is an acceptable degraded mode (never crash). | Confirm this fallback doesn't silently corrupt QC output on a real file with a calendar this tool can't parse -- check `check` report's "activities assigned to a calendar that failed to parse" section. |

### P6 XML

| # | Assumption | How to verify |
|---|---|---|
| 11 | The Oracle XML namespace is read from the file's root element rather than hardcoded to one P6 version. | `p6xml.py: parse_xml_bytes` strips whatever namespace URI is present; confirm a real export's root element uses a namespace of the form `http://xmlns.oracle.com/Primavera/P6/V<version>/API/BusinessObjects`. |
| 12 | XML `<PlannedDuration>`/`<RemainingDuration>`/`<Lag>`/`<TotalFloat>`/`<FreeFloat>` are decimal **hours**, matching XER's `*_hr_cnt` semantics. | Compare a value against the days P6 displays for the same activity, using that activity's calendar hours/day. |
| 13 | XML relationship `<Type>` values are the English strings `Finish to Start`, `Start to Start`, `Finish to Finish`, `Start to Finish`. | Inspect `<Relationship><Type>` in a real export; some P6 versions/locales may use different casing or abbreviations (`FS`, `SS`...). Adjust the mapping table in `p6xml.py` if so. |
| 14 | XML `<Type>` activity type strings map as: `Task Dependent`/`Resource Dependent` -> `TT_Task`, `Start Milestone` -> `TT_Mile`, `Finish Milestone` -> `TT_FinMile`, `Level of Effort` -> `TT_LOE`, `WBS Summary` -> `TT_WBS`. | Inspect real `<Activity><Type>` values; adjust `p6xml.py: ACTIVITY_TYPE_MAP` if different strings appear. |
| 15 | XML `<Status>` strings map as: `Not Started` -> `TK_NotStart`, `In Progress` -> `TK_Active`, `Completed` -> `TK_Complete`. | Same approach as above, against `p6xml.py: STATUS_MAP`. |
| 16 | XML calendars use `<StandardWorkWeek><StandardWorkHours><DayOfWeek>...</DayOfWeek><WorkTime>...` and `<HolidayOrExceptions><HolidayOrException><Date>...</Date>` structures. | Confirm element names/nesting against a real XML export; P6 version differences may rename or restructure these. |
| 17 | XML activity `<PrimaryConstraintType>` strings (`Mandatory Start`, `Mandatory Finish`, `Start On`, `Finish On`, etc.) map 1:1 onto the XER `CS_*` labels already used for XER-loaded schedules. | Inspect a real file's constraint strings against `p6xml.py: CONSTRAINT_TYPE_MAP`. |

### Logic QC thresholds (configurable, but defaults are assumptions)

| # | Assumption | Where | How to verify |
|---|---|---|---|
| 18 | "Long duration" threshold defaults to 44 working days (per build spec section 5.2). | `logic_check.py` `--max-duration-days` | Confirm with the owner's rep spec/section if one exists; spec explicitly says to make this configurable. |
| 19 | "High float" threshold defaults to 44 working days. | `logic_check.py` `--high-float-days` | Same as above. |
| 20 | "Long lag" threshold defaults to 10 working days. | `logic_check.py` `--max-lag-days` | Same as above. |
| 21 | Healthcare keyword overlay list (ICRA, ILSM, ADHS, Joint Commission, TJC, life safety, above ceiling inspection, licensing) is a fixed, non-exhaustive keyword list, off by default. | `logic_check.py` | This is explicitly a keyword heuristic per spec; expand the list for a specific facility/AHJ as needed. |

### Compare

| # | Assumption | Where | How to verify |
|---|---|---|---|
| 22 | Activities are matched between two schedule snapshots by `task_code`, never `task_id` (task_id is not stable across re-exports). | `compare.py` | Per spec section 5.3, explicit requirement, not really an assumption -- listed here for completeness. |
| 23 | "Slip" is computed in *working days* using the activity's own calendar from the baseline file (falling back to the update file's calendar if the activity is new). | `compare.py` | Sanity-check slip numbers against calendar days / known holidays for a couple of activities in a real pair of exports. |
