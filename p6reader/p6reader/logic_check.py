"""Schedule logic QC rules engine.

Implements the minimum rule set from build spec section 5.2, grouped by
severity (Critical, High, Medium, Low, Info). Thresholds (long-duration,
high-float, long-lag) are configurable. The healthcare keyword overlay is
off by default and is explicitly a keyword heuristic, not a compliance
check.
"""

from __future__ import annotations

import collections
from dataclasses import dataclass, field

import networkx as nx

from . import model as model_mod
from .model import Activity, Schedule

SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"]

DEFAULT_MAX_DURATION_DAYS = 44.0
DEFAULT_HIGH_FLOAT_DAYS = 44.0
DEFAULT_MAX_LAG_DAYS = 10.0

HEALTHCARE_KEYWORDS = [
    "icra", "ilsm", "adhs", "joint commission", "tjc", "life safety",
    "above ceiling", "licensing", "license",
]


@dataclass
class Finding:
    severity: str
    rule: str
    message: str
    activity_codes: list[str] = field(default_factory=list)


@dataclass
class CheckOptions:
    max_duration_days: float = DEFAULT_MAX_DURATION_DAYS
    high_float_days: float = DEFAULT_HIGH_FLOAT_DAYS
    max_lag_days: float = DEFAULT_MAX_LAG_DAYS
    healthcare_overlay: bool = False


def _pred_map(schedule: Schedule) -> dict[str, list]:
    m: dict[str, list] = collections.defaultdict(list)
    for rel in schedule.relationships:
        m[rel.task_id].append(rel)
    return m


def _succ_map(schedule: Schedule) -> dict[str, list]:
    m: dict[str, list] = collections.defaultdict(list)
    for rel in schedule.relationships:
        m[rel.pred_task_id].append(rel)
    return m


def _find_project_milestones(schedule: Schedule) -> tuple[set[str], set[str]]:
    start_mss = {a.task_id for a in schedule.activities.values() if a.task_type == "TT_Mile"}
    fin_mss = {a.task_id for a in schedule.activities.values() if a.task_type == "TT_FinMile"}
    return start_mss, fin_mss


def check_open_starts(schedule: Schedule, preds: dict[str, list]) -> list[Finding]:
    start_mss, _ = _find_project_milestones(schedule)
    findings = []
    for act in schedule.activities.values():
        if act.task_id in start_mss or act.is_wbs_summary:
            continue
        my_preds = preds.get(act.task_id, [])
        non_ms_preds = [r for r in my_preds if r.pred_task_id not in start_mss]
        if not non_ms_preds:
            findings.append(
                Finding(
                    "Critical", "Open start",
                    f"Activity {act.task_code} ({act.task_name}) has no predecessor "
                    "other than a project start milestone.",
                    [act.task_code],
                )
            )
    return findings


def check_open_finishes(schedule: Schedule, succs: dict[str, list]) -> list[Finding]:
    _, fin_mss = _find_project_milestones(schedule)
    findings = []
    for act in schedule.activities.values():
        if act.task_id in fin_mss or act.is_wbs_summary:
            continue
        my_succs = succs.get(act.task_id, [])
        non_ms_succs = [r for r in my_succs if r.task_id not in fin_mss]
        if not non_ms_succs:
            findings.append(
                Finding(
                    "Critical", "Open finish",
                    f"Activity {act.task_code} ({act.task_name}) has no successor "
                    "other than a project finish milestone.",
                    [act.task_code],
                )
            )
    return findings


def check_negative_float(schedule: Schedule) -> list[Finding]:
    findings = []
    for act in schedule.activities.values():
        if act.total_float_hr is not None and act.total_float_hr < 0:
            calendar = schedule.calendar_for(act)
            findings.append(
                Finding(
                    "Critical", "Negative total float",
                    f"Activity {act.task_code} ({act.task_name}) has negative total "
                    f"float ({act.total_float_days(calendar):.1f} days).",
                    [act.task_code],
                )
            )
    return findings


def check_circular_logic(schedule: Schedule) -> list[Finding]:
    g = nx.DiGraph()
    for act in schedule.activities.values():
        g.add_node(act.task_id)
    for rel in schedule.relationships:
        g.add_edge(rel.pred_task_id, rel.task_id)
    findings = []
    try:
        cycles = list(nx.simple_cycles(g))
    except Exception:  # noqa: BLE001 - never crash the QC run
        cycles = []
    for cycle in cycles:
        codes = [schedule.activities[t].task_code for t in cycle if t in schedule.activities]
        findings.append(
            Finding(
                "Critical", "Circular logic",
                f"Circular relationship logic detected among activities: {' -> '.join(codes)} -> {codes[0] if codes else '?'}.",
                codes,
            )
        )
    return findings


def check_data_date_issues(schedule: Schedule) -> list[Finding]:
    findings = []
    project = schedule.project
    if project is None or project.last_recalc_date is None:
        return findings
    data_date = project.last_recalc_date
    if project.scd_end_date and project.scd_end_date < data_date:
        findings.append(
            Finding(
                "Critical", "Data date after finish",
                f"Data date ({data_date}) is later than the file's scheduled/last "
                f"recalc end date ({project.scd_end_date}).",
                [],
            )
        )
    for act in schedule.activities.values():
        if act.act_start and act.act_start > data_date:
            findings.append(
                Finding(
                    "Critical", "Actual date after data date",
                    f"Activity {act.task_code} ({act.task_name}) has an actual start "
                    f"({act.act_start}) after the data date ({data_date}).",
                    [act.task_code],
                )
            )
        if act.act_end and act.act_end > data_date:
            findings.append(
                Finding(
                    "Critical", "Actual date after data date",
                    f"Activity {act.task_code} ({act.task_name}) has an actual finish "
                    f"({act.act_end}) after the data date ({data_date}).",
                    [act.task_code],
                )
            )
    return findings


def check_constraints(schedule: Schedule) -> list[Finding]:
    findings = []
    start_on_finish_on_count = 0
    for act in schedule.activities.values():
        if act.has_mandatory_constraint:
            label = model_mod.CONSTRAINT_LABELS.get(act.cstr_type, act.cstr_type)
            findings.append(
                Finding(
                    "High", "Hard constraint",
                    f"Activity {act.task_code} ({act.task_name}) has a hard "
                    f"constraint: {label}.",
                    [act.task_code],
                )
            )
        if act.has_start_on_finish_on_constraint:
            start_on_finish_on_count += 1
    if start_on_finish_on_count:
        findings.append(
            Finding(
                "High", "Start On / Finish On constraints",
                f"{start_on_finish_on_count} activities carry a Start On or Finish "
                "On constraint.",
                [],
            )
        )
    return findings


def check_relationship_issues(schedule: Schedule, max_lag_days: float) -> list[Finding]:
    findings = []
    for rel in schedule.relationships:
        pred = schedule.activities.get(rel.pred_task_id)
        succ = schedule.activities.get(rel.task_id)
        pred_code = pred.task_code if pred else rel.pred_task_id
        succ_code = succ.task_code if succ else rel.task_id
        calendar = schedule.calendar_for(pred) if pred else model_mod.cal.ParsedCalendar()

        if rel.lag_hr is not None and rel.lag_hr < 0:
            findings.append(
                Finding(
                    "High", "Negative lag",
                    f"Relationship {pred_code} -> {succ_code} has negative lag "
                    f"({rel.lag_days(calendar):.1f} days).",
                    [pred_code, succ_code],
                )
            )
        lag_days = rel.lag_days(calendar)
        if lag_days is not None and lag_days > max_lag_days:
            findings.append(
                Finding(
                    "High", "Long lag",
                    f"Relationship {pred_code} -> {succ_code} has a lag of "
                    f"{lag_days:.1f} working days (threshold {max_lag_days}).",
                    [pred_code, succ_code],
                )
            )
        if rel.pred_type == "PR_SF":
            findings.append(
                Finding(
                    "High", "Start to Finish relationship",
                    f"Relationship {pred_code} -> {succ_code} is a Start to Finish "
                    "relationship, which is unusual and should be reviewed.",
                    [pred_code, succ_code],
                )
            )
        if pred and succ and rel.pred_type == "PR_FS":
            if pred.act_end is None and succ.act_start is not None:
                findings.append(
                    Finding(
                        "High", "Out of sequence progress",
                        f"Activity {succ_code} started ({succ.act_start}) before its "
                        f"Finish-to-Start predecessor {pred_code} finished.",
                        [pred_code, succ_code],
                    )
                )
        if pred and (pred.is_loe or pred.is_wbs_summary):
            findings.append(
                Finding(
                    "High", "Relationship to/from LOE or WBS summary",
                    f"Relationship {pred_code} -> {succ_code}: predecessor {pred_code} "
                    f"is a {model_mod.TASK_TYPE_LABELS.get(pred.task_type, pred.task_type)} activity.",
                    [pred_code, succ_code],
                )
            )
        if succ and (succ.is_loe or succ.is_wbs_summary):
            findings.append(
                Finding(
                    "High", "Relationship to/from LOE or WBS summary",
                    f"Relationship {pred_code} -> {succ_code}: successor {succ_code} "
                    f"is a {model_mod.TASK_TYPE_LABELS.get(succ.task_type, succ.task_type)} activity.",
                    [pred_code, succ_code],
                )
            )
    return findings


def check_progress_consistency(schedule: Schedule) -> list[Finding]:
    findings = []
    for act in schedule.activities.values():
        if act.is_in_progress and act.remain_drtn_hr is not None and act.remain_drtn_hr <= 0:
            findings.append(
                Finding(
                    "High", "In progress with zero remaining duration",
                    f"Activity {act.task_code} ({act.task_name}) is In Progress but "
                    "has zero remaining duration.",
                    [act.task_code],
                )
            )
        if act.is_complete and act.remain_drtn_hr is not None and act.remain_drtn_hr > 0:
            findings.append(
                Finding(
                    "High", "Complete with remaining duration",
                    f"Activity {act.task_code} ({act.task_name}) is Complete but "
                    f"still shows {act.remain_drtn_hr} remaining hours.",
                    [act.task_code],
                )
            )
    return findings


def check_durations_and_float(schedule: Schedule, max_duration_days: float, high_float_days: float) -> list[Finding]:
    findings = []
    for act in schedule.activities.values():
        calendar = schedule.calendar_for(act)
        if not act.is_loe and not act.is_milestone:
            dur = act.target_drtn_days(calendar)
            if dur is not None and dur > max_duration_days:
                findings.append(
                    Finding(
                        "Medium", "Long duration",
                        f"Activity {act.task_code} ({act.task_name}) has an original "
                        f"duration of {dur:.1f} working days (threshold "
                        f"{max_duration_days}).",
                        [act.task_code],
                    )
                )
        if not act.is_complete:
            tf = act.total_float_days(calendar)
            if tf is not None and tf > high_float_days:
                findings.append(
                    Finding(
                        "Medium", "High float",
                        f"Activity {act.task_code} ({act.task_name}) has {tf:.1f} "
                        f"working days of total float (threshold {high_float_days}).",
                        [act.task_code],
                    )
                )
        if act.is_milestone:
            dur_hr = act.target_drtn_hr or 0
            if dur_hr > 0:
                findings.append(
                    Finding(
                        "Medium", "Milestone with duration",
                        f"Milestone {act.task_code} ({act.task_name}) has a nonzero "
                        f"duration ({dur_hr} hours); milestones should have zero duration.",
                        [act.task_code],
                    )
                )
    return findings


def check_calendar_and_duplicates(schedule: Schedule) -> list[Finding]:
    findings = []
    for act in schedule.activities.values():
        calendar = schedule.calendar_for(act)
        if calendar.is_fallback:
            findings.append(
                Finding(
                    "Medium", "Calendar failed to parse",
                    f"Activity {act.task_code} ({act.task_name}) is on a calendar "
                    f"that could not be parsed and fell back to Mon-Fri/8h.",
                    [act.task_code],
                )
            )

    by_wbs_name: dict[tuple, list[str]] = collections.defaultdict(list)
    for act in schedule.activities.values():
        by_wbs_name[(act.wbs_id, act.task_name.strip().lower())].append(act.task_code)
    for (wbs_id, _name), codes in by_wbs_name.items():
        if len(codes) > 1:
            findings.append(
                Finding(
                    "Medium", "Duplicate activity name",
                    f"Activities {', '.join(sorted(codes))} share the same name "
                    f"within WBS node {schedule.wbs_path(wbs_id) or wbs_id}.",
                    sorted(codes),
                )
            )
    return findings


def check_info(schedule: Schedule) -> list[Finding]:
    findings = []
    total = len(schedule.relationships)
    fs = sum(1 for r in schedule.relationships if r.pred_type == "PR_FS")
    if total:
        pct_fs = 100.0 * fs / total
        findings.append(
            Finding(
                "Info", "Relationship type mix",
                f"{pct_fs:.0f}% of relationships are Finish to Start; "
                f"{100 - pct_fs:.0f}% are SS/FF/SF.",
                [],
            )
        )

    driving_count = sum(1 for a in schedule.activities.values() if a.driving_path_flag)
    findings.append(
        Finding(
            "Info", "Driving path",
            f"{driving_count} activities are flagged on the driving (longest) path.",
            [],
        )
    )

    buckets = collections.Counter()
    for act in schedule.activities.values():
        calendar = schedule.calendar_for(act)
        tf = act.total_float_days(calendar)
        if tf is None:
            continue
        if tf < 0:
            bucket = "< 0"
        elif tf <= 5:
            bucket = "0-5"
        elif tf <= 15:
            bucket = "6-15"
        elif tf <= 44:
            bucket = "16-44"
        else:
            bucket = "> 44"
        buckets[bucket] += 1
    findings.append(
        Finding(
            "Info", "Float distribution",
            "Float buckets (working days): " + ", ".join(f"{k}: {v}" for k, v in buckets.items()),
            [],
        )
    )

    for cal in schedule.calendars.values():
        findings.append(
            Finding(
                "Info", "Calendar",
                f"{cal.name} (id={cal.clndr_id}): {cal.parsed.day_hr_cnt}h/day"
                + (" [fallback]" if cal.parsed.is_fallback else ""),
                [],
            )
        )
    return findings


def check_healthcare_overlay(schedule: Schedule) -> list[Finding]:
    matched = []
    for act in schedule.activities.values():
        name_lower = act.task_name.lower()
        if any(kw in name_lower for kw in HEALTHCARE_KEYWORDS):
            matched.append(act.task_code)
    if not matched:
        return [
            Finding(
                "Medium", "Healthcare overlay",
                "No activities found whose names match healthcare-specific keywords "
                "(ICRA, ILSM, ADHS, Joint Commission/TJC, life safety, above ceiling "
                "inspection, licensing). This is a keyword check only -- it does not "
                "confirm the schedule actually addresses these requirements.",
                [],
            )
        ]
    return [
        Finding(
            "Info", "Healthcare overlay",
            f"{len(matched)} activities match healthcare-specific keywords "
            f"(ICRA/ILSM/ADHS/TJC/life safety/above ceiling/licensing). This is a "
            f"keyword check only. Matches: {', '.join(sorted(matched))}.",
            sorted(matched),
        )
    ]


def run_all_checks(schedule: Schedule, options: CheckOptions | None = None) -> list[Finding]:
    options = options or CheckOptions()
    preds = _pred_map(schedule)
    succs = _succ_map(schedule)

    findings: list[Finding] = []
    findings += check_open_starts(schedule, preds)
    findings += check_open_finishes(schedule, succs)
    findings += check_negative_float(schedule)
    findings += check_circular_logic(schedule)
    findings += check_data_date_issues(schedule)

    findings += check_constraints(schedule)
    findings += check_relationship_issues(schedule, options.max_lag_days)
    findings += check_progress_consistency(schedule)

    findings += check_durations_and_float(schedule, options.max_duration_days, options.high_float_days)
    findings += check_calendar_and_duplicates(schedule)

    findings += check_info(schedule)

    if options.healthcare_overlay:
        findings += check_healthcare_overlay(schedule)

    return findings


def render_markdown_report(findings: list[Finding], options: CheckOptions, schedule: Schedule) -> str:
    lines = ["# Schedule Logic QC Report", ""]
    if schedule.project:
        lines.append(f"Project: **{schedule.project.short_name}**")
        lines.append(f"Data date: {schedule.project.last_recalc_date}")
        lines.append("")
    lines.append(
        f"Thresholds: long duration > {options.max_duration_days} working days, "
        f"high float > {options.high_float_days} working days, "
        f"long lag > {options.max_lag_days} working days. "
        f"Healthcare overlay: {'ON' if options.healthcare_overlay else 'off'}."
    )
    lines.append("")

    by_sev: dict[str, list[Finding]] = collections.defaultdict(list)
    for f in findings:
        by_sev[f.severity].append(f)

    for sev in SEVERITIES:
        items = by_sev.get(sev, [])
        lines.append(f"## {sev} ({len(items)})")
        lines.append("")
        if not items:
            lines.append("_None found._")
            lines.append("")
            continue
        for f in items:
            codes = f", ".join(f.activity_codes) if f.activity_codes else ""
            suffix = f" (`{codes}`)" if codes else ""
            lines.append(f"- **{f.rule}**: {f.message}{suffix}")
        lines.append("")

    return "\n".join(lines)
