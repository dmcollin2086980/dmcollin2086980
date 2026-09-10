"""Two-file schedule comparison (baseline vs. update).

Activities are matched by ``task_code``, never ``task_id`` (task IDs are not
stable across P6 re-exports). Slips are reported in working days using each
activity's own calendar (baseline's calendar, falling back to the update
file's calendar for newly added activities).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import calendars as cal
from .model import Activity, Relationship, Schedule


@dataclass
class ActivityChange:
    task_code: str
    field_name: str
    old_value: str
    new_value: str


@dataclass
class DateSlip:
    task_code: str
    task_name: str
    field_name: str  # "Start" or "Finish"
    old_date: object
    new_date: object
    slip_working_days: float


@dataclass
class RelationshipChange:
    pred_code: str
    succ_code: str
    kind: str  # "added" | "deleted" | "type changed" | "lag changed"
    detail: str


@dataclass
class ConstraintChange:
    task_code: str
    kind: str  # "added" | "removed" | "changed"
    detail: str


@dataclass
class DrivingPathChange:
    task_code: str
    joined_or_left: str  # "joined" | "left"


@dataclass
class CompareResult:
    added_activities: list[Activity] = field(default_factory=list)
    deleted_activities: list[Activity] = field(default_factory=list)
    renamed_activities: list[tuple[str, str, str]] = field(default_factory=list)  # code, old name, new name
    duration_changes: list[ActivityChange] = field(default_factory=list)
    calendar_changes: list[ActivityChange] = field(default_factory=list)
    date_slips: list[DateSlip] = field(default_factory=list)
    relationship_changes: list[RelationshipChange] = field(default_factory=list)
    constraint_changes: list[ConstraintChange] = field(default_factory=list)
    data_date_change: tuple | None = None
    finish_date_change: tuple | None = None
    driving_path_changes: list[DrivingPathChange] = field(default_factory=list)


def _rel_key(schedule: Schedule, rel: Relationship) -> tuple[str, str] | None:
    pred = schedule.activities.get(rel.pred_task_id)
    succ = schedule.activities.get(rel.task_id)
    if pred is None or succ is None:
        return None
    return (pred.task_code, succ.task_code)


def compare_schedules(baseline: Schedule, update: Schedule) -> CompareResult:
    result = CompareResult()

    base_codes = set(baseline.activities_by_code.keys())
    upd_codes = set(update.activities_by_code.keys())

    for code in sorted(upd_codes - base_codes):
        result.added_activities.append(update.activities_by_code[code])
    for code in sorted(base_codes - upd_codes):
        result.deleted_activities.append(baseline.activities_by_code[code])

    common_codes = base_codes & upd_codes
    for code in sorted(common_codes):
        b = baseline.activities_by_code[code]
        u = update.activities_by_code[code]

        if b.task_name.strip() != u.task_name.strip():
            result.renamed_activities.append((code, b.task_name, u.task_name))

        b_cal = baseline.calendar_for(b)
        u_cal = update.calendar_for(u)

        b_dur = b.target_drtn_days(b_cal)
        u_dur = u.target_drtn_days(u_cal)
        if _rounded(b_dur) != _rounded(u_dur):
            result.duration_changes.append(
                ActivityChange(code, "Original Duration (days)", _fmt(b_dur), _fmt(u_dur))
            )
        b_rem = b.remain_drtn_days(b_cal)
        u_rem = u.remain_drtn_days(u_cal)
        if _rounded(b_rem) != _rounded(u_rem):
            result.duration_changes.append(
                ActivityChange(code, "Remaining Duration (days)", _fmt(b_rem), _fmt(u_rem))
            )

        b_cal_name = baseline.calendars[b.clndr_id].name if b.clndr_id in baseline.calendars else b.clndr_id
        u_cal_name = update.calendars[u.clndr_id].name if u.clndr_id in update.calendars else u.clndr_id
        if b_cal_name != u_cal_name:
            result.calendar_changes.append(ActivityChange(code, "Calendar", str(b_cal_name), str(u_cal_name)))

        for field_name, b_date, u_date in [
            ("Start", b.early_start or b.act_start, u.early_start or u.act_start),
            ("Finish", b.early_end or b.act_end, u.early_end or u.act_end),
        ]:
            if b_date and u_date and b_date != u_date:
                slip = cal.working_days_between(b_cal, b_date.date(), u_date.date())
                result.date_slips.append(
                    DateSlip(code, u.task_name, field_name, b_date, u_date, slip)
                )

        # Constraints
        b_cstr = (b.cstr_type, b.cstr_date)
        u_cstr = (u.cstr_type, u.cstr_date)
        if b_cstr != u_cstr:
            if not b.cstr_type and u.cstr_type:
                result.constraint_changes.append(
                    ConstraintChange(code, "added", f"{u.cstr_type} on {u.cstr_date}")
                )
            elif b.cstr_type and not u.cstr_type:
                result.constraint_changes.append(
                    ConstraintChange(code, "removed", f"{b.cstr_type} was on {b.cstr_date}")
                )
            else:
                result.constraint_changes.append(
                    ConstraintChange(
                        code, "changed",
                        f"{b.cstr_type} on {b.cstr_date} -> {u.cstr_type} on {u.cstr_date}",
                    )
                )

        if b.driving_path_flag and not u.driving_path_flag:
            result.driving_path_changes.append(DrivingPathChange(code, "left"))
        elif not b.driving_path_flag and u.driving_path_flag:
            result.driving_path_changes.append(DrivingPathChange(code, "joined"))

    result.date_slips.sort(key=lambda s: abs(s.slip_working_days), reverse=True)

    # Relationships, keyed by (pred_code, succ_code) since ids aren't stable.
    base_rels = {}
    for rel in baseline.relationships:
        key = _rel_key(baseline, rel)
        if key:
            base_rels[key] = rel
    upd_rels = {}
    for rel in update.relationships:
        key = _rel_key(update, rel)
        if key:
            upd_rels[key] = rel

    for key in sorted(set(upd_rels) - set(base_rels)):
        rel = upd_rels[key]
        result.relationship_changes.append(
            RelationshipChange(key[0], key[1], "added", f"{rel.pred_type}, lag {rel.lag_hr}h")
        )
    for key in sorted(set(base_rels) - set(upd_rels)):
        rel = base_rels[key]
        result.relationship_changes.append(
            RelationshipChange(key[0], key[1], "deleted", f"{rel.pred_type}, lag {rel.lag_hr}h")
        )
    for key in sorted(set(base_rels) & set(upd_rels)):
        b_rel = base_rels[key]
        u_rel = upd_rels[key]
        if b_rel.pred_type != u_rel.pred_type:
            result.relationship_changes.append(
                RelationshipChange(
                    key[0], key[1], "type changed", f"{b_rel.pred_type} -> {u_rel.pred_type}"
                )
            )
        if _rounded(b_rel.lag_hr) != _rounded(u_rel.lag_hr):
            result.relationship_changes.append(
                RelationshipChange(
                    key[0], key[1], "lag changed", f"{b_rel.lag_hr}h -> {u_rel.lag_hr}h"
                )
            )

    if baseline.project and update.project:
        if baseline.project.last_recalc_date != update.project.last_recalc_date:
            result.data_date_change = (baseline.project.last_recalc_date, update.project.last_recalc_date)
        if baseline.project.scd_end_date != update.project.scd_end_date:
            result.finish_date_change = (baseline.project.scd_end_date, update.project.scd_end_date)

    return result


def _rounded(x):
    if x is None:
        return None
    return round(x, 2)


def _fmt(x) -> str:
    return "" if x is None else f"{x:.2f}"


def render_markdown_report(result: CompareResult, baseline: Schedule, update: Schedule) -> str:
    lines = ["# Schedule Comparison Report", ""]
    if baseline.project and update.project:
        lines.append(f"Baseline: **{baseline.project.short_name}** (data date {baseline.project.last_recalc_date})")
        lines.append(f"Update: **{update.project.short_name}** (data date {update.project.last_recalc_date})")
        lines.append("")

    lines.append("## Project-level changes")
    lines.append("")
    if result.data_date_change:
        lines.append(f"- Data date moved: {result.data_date_change[0]} -> {result.data_date_change[1]}")
    if result.finish_date_change:
        lines.append(f"- Scheduled finish moved: {result.finish_date_change[0]} -> {result.finish_date_change[1]}")
    if not result.data_date_change and not result.finish_date_change:
        lines.append("_No project-level date changes._")
    lines.append("")

    lines.append(f"## Activities added ({len(result.added_activities)})")
    lines.append("")
    for act in result.added_activities:
        lines.append(f"- {act.task_code}: {act.task_name}")
    if not result.added_activities:
        lines.append("_None._")
    lines.append("")

    lines.append(f"## Activities deleted ({len(result.deleted_activities)})")
    lines.append("")
    for act in result.deleted_activities:
        lines.append(f"- {act.task_code}: {act.task_name}")
    if not result.deleted_activities:
        lines.append("_None._")
    lines.append("")

    lines.append(f"## Activities renamed ({len(result.renamed_activities)})")
    lines.append("")
    for code, old, new in result.renamed_activities:
        lines.append(f"- {code}: \"{old}\" -> \"{new}\"")
    if not result.renamed_activities:
        lines.append("_None._")
    lines.append("")

    lines.append(f"## Duration / calendar changes ({len(result.duration_changes) + len(result.calendar_changes)})")
    lines.append("")
    for c in result.duration_changes + result.calendar_changes:
        lines.append(f"- {c.task_code}: {c.field_name} changed from {c.old_value} to {c.new_value}")
    if not result.duration_changes and not result.calendar_changes:
        lines.append("_None._")
    lines.append("")

    lines.append(f"## Date slips, sorted by largest slip ({len(result.date_slips)})")
    lines.append("")
    for s in result.date_slips:
        direction = "slip" if s.slip_working_days > 0 else "pull-ahead"
        lines.append(
            f"- {s.task_code} ({s.task_name}) {s.field_name}: {s.old_date} -> {s.new_date} "
            f"({abs(s.slip_working_days):.0f} working day {direction})"
        )
    if not result.date_slips:
        lines.append("_None._")
    lines.append("")

    lines.append(f"## Relationship changes ({len(result.relationship_changes)})")
    lines.append("")
    for r in result.relationship_changes:
        lines.append(f"- {r.pred_code} -> {r.succ_code}: {r.kind} ({r.detail})")
    if not result.relationship_changes:
        lines.append("_None._")
    lines.append("")

    lines.append(f"## Constraint changes ({len(result.constraint_changes)})")
    lines.append("")
    for c in result.constraint_changes:
        lines.append(f"- {c.task_code}: {c.kind} -- {c.detail}")
    if not result.constraint_changes:
        lines.append("_None._")
    lines.append("")

    lines.append(f"## Driving (longest) path changes ({len(result.driving_path_changes)})")
    lines.append("")
    for c in result.driving_path_changes:
        lines.append(f"- {c.task_code} {c.joined_or_left} the driving path")
    if not result.driving_path_changes:
        lines.append("_None._")
    lines.append("")

    return "\n".join(lines)
