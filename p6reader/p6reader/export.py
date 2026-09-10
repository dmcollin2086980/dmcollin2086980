"""CSV export with readable column names.

Writes ``activities.csv``, ``relationships.csv``, ``wbs.csv``, and
``calendars.csv`` from a loaded :class:`~p6reader.model.Schedule`. Column
names are meant to be readable by a human scheduler, not raw P6 field
names -- see ``docs/COLUMN_MAPPING.md`` for the full mapping table.
"""

from __future__ import annotations

import csv
import os

from . import model as model_mod
from .model import Schedule


def _fmt_date(dt) -> str:
    return dt.strftime("%Y-%m-%d %H:%M") if dt else ""


def _fmt_num(x) -> str:
    if x is None:
        return ""
    if isinstance(x, float) and x == int(x):
        return str(int(x))
    return f"{x:.2f}" if isinstance(x, float) else str(x)


ACTIVITY_COLUMNS = [
    "Activity ID",
    "Activity Name",
    "WBS Path",
    "Activity Type",
    "Status",
    "Calendar",
    "Original Duration (days)",
    "Remaining Duration (days)",
    "Target Start",
    "Target Finish",
    "Actual Start",
    "Actual Finish",
    "Early Start",
    "Early Finish",
    "Late Start",
    "Late Finish",
    "Total Float (days)",
    "Free Float (days)",
    "Constraint Type",
    "Constraint Date",
    "Secondary Constraint Type",
    "Secondary Constraint Date",
    "Driving",
    "Percent Complete",
]


def activity_rows(schedule: Schedule) -> list[dict[str, str]]:
    rows = []
    for act in sorted(schedule.activities.values(), key=lambda a: (schedule.wbs_path(a.wbs_id), a.task_code)):
        calendar = schedule.calendar_for(act)
        cal_name = schedule.calendars[act.clndr_id].name if act.clndr_id in schedule.calendars else "(unknown)"
        rows.append(
            {
                "Activity ID": act.task_code,
                "Activity Name": act.task_name,
                "WBS Path": schedule.wbs_path(act.wbs_id),
                "Activity Type": model_mod.TASK_TYPE_LABELS.get(act.task_type, act.task_type),
                "Status": model_mod.STATUS_LABELS.get(act.status_code, act.status_code),
                "Calendar": cal_name,
                "Original Duration (days)": _fmt_num(act.target_drtn_days(calendar)),
                "Remaining Duration (days)": _fmt_num(act.remain_drtn_days(calendar)),
                "Target Start": _fmt_date(act.target_start),
                "Target Finish": _fmt_date(act.target_end),
                "Actual Start": _fmt_date(act.act_start),
                "Actual Finish": _fmt_date(act.act_end),
                "Early Start": _fmt_date(act.early_start),
                "Early Finish": _fmt_date(act.early_end),
                "Late Start": _fmt_date(act.late_start),
                "Late Finish": _fmt_date(act.late_end),
                "Total Float (days)": _fmt_num(act.total_float_days(calendar)),
                "Free Float (days)": _fmt_num(act.free_float_days(calendar)),
                "Constraint Type": model_mod.CONSTRAINT_LABELS.get(act.cstr_type, act.cstr_type or ""),
                "Constraint Date": _fmt_date(act.cstr_date),
                "Secondary Constraint Type": model_mod.CONSTRAINT_LABELS.get(act.cstr_type2, act.cstr_type2 or ""),
                "Secondary Constraint Date": _fmt_date(act.cstr_date2),
                "Driving": "Yes" if act.driving_path_flag else "No",
                "Percent Complete": _fmt_num(act.phys_complete_pct),
            }
        )
    return rows


RELATIONSHIP_COLUMNS = [
    "Predecessor ID",
    "Predecessor Name",
    "Successor ID",
    "Successor Name",
    "Type",
    "Lag (days)",
]


def relationship_rows(schedule: Schedule) -> list[dict[str, str]]:
    rows = []
    for rel in schedule.relationships:
        pred = schedule.activities.get(rel.pred_task_id)
        succ = schedule.activities.get(rel.task_id)
        calendar = schedule.calendar_for(pred) if pred else model_mod.cal.ParsedCalendar()
        rows.append(
            {
                "Predecessor ID": pred.task_code if pred else rel.pred_task_id,
                "Predecessor Name": pred.task_name if pred else "(unknown)",
                "Successor ID": succ.task_code if succ else rel.task_id,
                "Successor Name": succ.task_name if succ else "(unknown)",
                "Type": model_mod.PRED_TYPE_LABELS.get(rel.pred_type, rel.pred_type),
                "Lag (days)": _fmt_num(rel.lag_days(calendar)),
            }
        )
    return rows


WBS_COLUMNS = ["WBS Code", "WBS Name", "Full Path", "Level", "Is Project Node"]


def wbs_rows(schedule: Schedule) -> list[dict[str, str]]:
    rows = []
    for node in sorted(schedule.wbs.values(), key=lambda n: schedule.wbs_path(n.wbs_id)):
        rows.append(
            {
                "WBS Code": node.short_name,
                "WBS Name": node.name,
                "Full Path": schedule.wbs_path(node.wbs_id),
                "Level": schedule.wbs_level(node.wbs_id),
                "Is Project Node": "Yes" if node.is_project_node else "No",
            }
        )
    return rows


CALENDAR_COLUMNS = [
    "Calendar ID",
    "Calendar Name",
    "Hours per Day",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "Exception Count",
    "Parse Status",
]


def calendar_rows(schedule: Schedule) -> list[dict[str, str]]:
    rows = []
    weekday_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for cal in schedule.calendars.values():
        row = {
            "Calendar ID": cal.clndr_id,
            "Calendar Name": cal.name,
            "Hours per Day": _fmt_num(cal.parsed.day_hr_cnt),
            "Exception Count": str(len(cal.parsed.exceptions)),
            "Parse Status": "FAILED (fallback Mon-Fri 8h)" if cal.parsed.is_fallback else "OK",
        }
        for i, name in enumerate(weekday_names, start=1):
            row[name] = _fmt_num(cal.parsed.hours_for_weekday(i))
        rows.append(row)
    return rows


def _write_csv(path: str, columns: list[str], rows: list[dict[str, str]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def export_csv(schedule: Schedule, out_dir: str) -> list[str]:
    """Write activities.csv, relationships.csv, wbs.csv, calendars.csv into
    out_dir (created if needed). Returns the list of file paths written.
    """
    os.makedirs(out_dir, exist_ok=True)
    written = []

    path = os.path.join(out_dir, "activities.csv")
    _write_csv(path, ACTIVITY_COLUMNS, activity_rows(schedule))
    written.append(path)

    path = os.path.join(out_dir, "relationships.csv")
    _write_csv(path, RELATIONSHIP_COLUMNS, relationship_rows(schedule))
    written.append(path)

    path = os.path.join(out_dir, "wbs.csv")
    _write_csv(path, WBS_COLUMNS, wbs_rows(schedule))
    written.append(path)

    path = os.path.join(out_dir, "calendars.csv")
    _write_csv(path, CALENDAR_COLUMNS, calendar_rows(schedule))
    written.append(path)

    return written
