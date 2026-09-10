"""Normalized data model, built by reading typed values back out of the
SQLite store.

The store keeps everything as raw strings (see ``store.py``); this module is
where XER/XML format differences disappear and typed conversion happens.
Downstream code (export, logic_check, compare) only ever touches these
dataclasses, never raw table rows.

Unknown/unparseable values never raise -- they are recorded as warnings and
the field is left as ``None`` or a safe default.
"""

from __future__ import annotations

import datetime
import sqlite3
from dataclasses import dataclass, field

from . import calendars as cal
from .calendars import ParsedCalendar

TASK_TYPE_LABELS = {
    "TT_Task": "Task",
    "TT_Mile": "Start Milestone",
    "TT_FinMile": "Finish Milestone",
    "TT_LOE": "Level of Effort",
    "TT_WBS": "WBS Summary",
    "TT_Rsrc": "Resource-Dependent Task",
}

STATUS_LABELS = {
    "TK_NotStart": "Not Started",
    "TK_Active": "In Progress",
    "TK_Complete": "Complete",
}

PRED_TYPE_LABELS = {
    "PR_FS": "Finish to Start",
    "PR_SS": "Start to Start",
    "PR_FF": "Finish to Finish",
    "PR_SF": "Start to Finish",
}

CONSTRAINT_LABELS = {
    "CS_MSO": "Mandatory Start",
    "CS_MSOB": "Mandatory Start",
    "CS_MEO": "Mandatory Finish",
    "CS_MEOB": "Mandatory Finish",
    "CS_MANDSTART": "Mandatory Start",
    "CS_MANDFIN": "Mandatory Finish",
    "CS_ALAP": "As Late As Possible",
    "CS_SNLT": "Start On or Before",
    "CS_SNET": "Start On or After",
    "CS_FNLT": "Finish On or Before",
    "CS_FNET": "Finish On or After",
    "CS_SO": "Start On",
    "CS_FO": "Finish On",
}

MANDATORY_CONSTRAINTS = {"CS_MSO", "CS_MSOB", "CS_MEO", "CS_MEOB", "CS_MANDSTART", "CS_MANDFIN"}
START_ON_FINISH_ON_CONSTRAINTS = {"CS_SO", "CS_FO"}

LOE_OR_WBS_TYPES = {"TT_LOE", "TT_WBS"}
MILESTONE_TYPES = {"TT_Mile", "TT_FinMile"}


def parse_p6_date(value: str | None) -> datetime.datetime | None:
    """Parse a P6 date string ('YYYY-MM-DD HH:MM', ISO 'T'-separated, or
    date-only). Empty string / None means null. Never raises; returns None
    and lets the caller decide whether to warn.
    """
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    candidates = [
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]
    for fmt in candidates:
        try:
            return datetime.datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _to_float(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


@dataclass
class Project:
    proj_id: str
    short_name: str
    plan_start: datetime.datetime | None
    plan_end: datetime.datetime | None
    last_recalc_date: datetime.datetime | None
    scd_end_date: datetime.datetime | None


@dataclass
class WbsNode:
    wbs_id: str
    parent_wbs_id: str | None
    proj_id: str
    short_name: str
    name: str
    is_project_node: bool


@dataclass
class Calendar:
    clndr_id: str
    name: str
    parsed: ParsedCalendar


@dataclass
class Activity:
    task_id: str
    proj_id: str
    wbs_id: str | None
    task_code: str
    task_name: str
    task_type: str
    status_code: str
    clndr_id: str | None
    target_drtn_hr: float | None
    remain_drtn_hr: float | None
    target_start: datetime.datetime | None
    target_end: datetime.datetime | None
    act_start: datetime.datetime | None
    act_end: datetime.datetime | None
    early_start: datetime.datetime | None
    early_end: datetime.datetime | None
    late_start: datetime.datetime | None
    late_end: datetime.datetime | None
    total_float_hr: float | None
    free_float_hr: float | None
    cstr_type: str | None
    cstr_date: datetime.datetime | None
    cstr_type2: str | None
    cstr_date2: datetime.datetime | None
    driving_path_flag: bool
    phys_complete_pct: float | None

    @property
    def is_loe(self) -> bool:
        return self.task_type == "TT_LOE"

    @property
    def is_wbs_summary(self) -> bool:
        return self.task_type == "TT_WBS"

    @property
    def is_milestone(self) -> bool:
        return self.task_type in MILESTONE_TYPES

    @property
    def is_complete(self) -> bool:
        return self.status_code == "TK_Complete"

    @property
    def is_in_progress(self) -> bool:
        return self.status_code == "TK_Active"

    @property
    def is_not_started(self) -> bool:
        return self.status_code == "TK_NotStart"

    @property
    def has_mandatory_constraint(self) -> bool:
        return (self.cstr_type in MANDATORY_CONSTRAINTS) or (self.cstr_type2 in MANDATORY_CONSTRAINTS)

    @property
    def has_start_on_finish_on_constraint(self) -> bool:
        return (self.cstr_type in START_ON_FINISH_ON_CONSTRAINTS) or (
            self.cstr_type2 in START_ON_FINISH_ON_CONSTRAINTS
        )

    def target_drtn_days(self, calendar: ParsedCalendar) -> float | None:
        return cal.hours_to_days(self.target_drtn_hr, calendar)

    def remain_drtn_days(self, calendar: ParsedCalendar) -> float | None:
        return cal.hours_to_days(self.remain_drtn_hr, calendar)

    def total_float_days(self, calendar: ParsedCalendar) -> float | None:
        return cal.hours_to_days(self.total_float_hr, calendar)

    def free_float_days(self, calendar: ParsedCalendar) -> float | None:
        return cal.hours_to_days(self.free_float_hr, calendar)


@dataclass
class Relationship:
    task_pred_id: str
    task_id: str  # successor
    pred_task_id: str  # predecessor
    proj_id: str
    pred_type: str
    lag_hr: float | None

    def lag_days(self, calendar: ParsedCalendar) -> float | None:
        return cal.hours_to_days(self.lag_hr, calendar)


@dataclass
class Schedule:
    project: Project | None
    wbs: dict[str, WbsNode] = field(default_factory=dict)
    activities: dict[str, Activity] = field(default_factory=dict)  # by task_id
    activities_by_code: dict[str, Activity] = field(default_factory=dict)
    relationships: list[Relationship] = field(default_factory=list)
    calendars: dict[str, Calendar] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    store_warnings: list[str] = field(default_factory=list)
    meta: dict[str, str] = field(default_factory=dict)

    @property
    def all_warnings(self) -> list[str]:
        return list(self.store_warnings) + list(self.warnings)

    def calendar_for(self, activity: Activity) -> ParsedCalendar:
        if activity.clndr_id and activity.clndr_id in self.calendars:
            return self.calendars[activity.clndr_id].parsed
        # No calendar reference at all -- fall back silently (rare/edge case).
        return cal.ParsedCalendar(is_fallback=True, parse_error="activity has no clndr_id")

    def wbs_path(self, wbs_id: str | None) -> str:
        if not wbs_id or wbs_id not in self.wbs:
            return ""
        parts: list[str] = []
        seen: set[str] = set()
        current: str | None = wbs_id
        while current and current in self.wbs and current not in seen:
            seen.add(current)
            node = self.wbs[current]
            parts.append(node.short_name or node.name)
            current = node.parent_wbs_id
        return " > ".join(reversed(parts))

    def wbs_level(self, wbs_id: str | None) -> int:
        if not wbs_id or wbs_id not in self.wbs:
            return 0
        level = 0
        current: str | None = wbs_id
        seen: set[str] = set()
        while current and current in self.wbs and current not in seen:
            seen.add(current)
            level += 1
            current = self.wbs[current].parent_wbs_id
        return level


def _get_rows(conn: sqlite3.Connection, table: str) -> list[dict[str, str]]:
    from . import store

    return store.read_table(conn, table)


def load_schedule(conn: sqlite3.Connection) -> Schedule:
    from . import store

    warnings: list[str] = []
    meta = store.get_meta(conn)
    store_warnings = store.get_warnings(conn)

    # --- Calendars ---
    calendars: dict[str, Calendar] = {}
    for row in _get_rows(conn, "CALENDAR"):
        clndr_id = row.get("clndr_id", "")
        clndr_name = row.get("clndr_name", "") or clndr_id

        def _warn(msg: str, _bucket=warnings):
            _bucket.append(msg)

        parsed = cal.parse_clndr_data(
            clndr_id, clndr_name, row.get("clndr_data"), row.get("day_hr_cnt"), warn=_warn
        )
        calendars[clndr_id] = Calendar(clndr_id=clndr_id, name=clndr_name, parsed=parsed)

    # --- Project ---
    project: Project | None = None
    proj_rows = _get_rows(conn, "PROJECT")
    if proj_rows:
        row = proj_rows[0]
        if len(proj_rows) > 1:
            warnings.append(f"multiple PROJECT rows found ({len(proj_rows)}); using the first")
        project = Project(
            proj_id=row.get("proj_id", ""),
            short_name=row.get("proj_short_name", ""),
            plan_start=parse_p6_date(row.get("plan_start_date")),
            plan_end=parse_p6_date(row.get("plan_end_date")),
            last_recalc_date=parse_p6_date(row.get("last_recalc_date")),
            scd_end_date=parse_p6_date(row.get("scd_end_date")),
        )
    else:
        warnings.append("no PROJECT row found in store")

    # --- WBS ---
    wbs: dict[str, WbsNode] = {}
    for row in _get_rows(conn, "PROJWBS"):
        wbs_id = row.get("wbs_id", "")
        if not wbs_id:
            warnings.append("PROJWBS row missing wbs_id; skipping")
            continue
        wbs[wbs_id] = WbsNode(
            wbs_id=wbs_id,
            parent_wbs_id=(row.get("parent_wbs_id") or "").strip() or None,
            proj_id=row.get("proj_id", ""),
            short_name=row.get("wbs_short_name", ""),
            name=row.get("wbs_name", ""),
            is_project_node=(row.get("proj_node_flag", "") or "").upper() == "Y",
        )

    # --- Activities ---
    activities: dict[str, Activity] = {}
    activities_by_code: dict[str, Activity] = {}
    known_task_types = set(TASK_TYPE_LABELS)
    known_status = set(STATUS_LABELS)
    for row in _get_rows(conn, "TASK"):
        task_id = row.get("task_id", "")
        if not task_id:
            warnings.append("TASK row missing task_id; skipping")
            continue
        task_type = row.get("task_type", "") or "TT_Task"
        if task_type not in known_task_types:
            warnings.append(
                f"activity {row.get('task_code', task_id)!r}: unknown task_type "
                f"{task_type!r}; treating as TT_Task"
            )
            task_type = "TT_Task"
        status_code = row.get("status_code", "") or "TK_NotStart"
        if status_code not in known_status:
            warnings.append(
                f"activity {row.get('task_code', task_id)!r}: unknown status_code "
                f"{status_code!r}; treating as TK_NotStart"
            )
            status_code = "TK_NotStart"

        act = Activity(
            task_id=task_id,
            proj_id=row.get("proj_id", ""),
            wbs_id=(row.get("wbs_id") or "").strip() or None,
            task_code=row.get("task_code", task_id),
            task_name=row.get("task_name", ""),
            task_type=task_type,
            status_code=status_code,
            clndr_id=(row.get("clndr_id") or "").strip() or None,
            target_drtn_hr=_to_float(row.get("target_drtn_hr_cnt")),
            remain_drtn_hr=_to_float(row.get("remain_drtn_hr_cnt")),
            target_start=parse_p6_date(row.get("target_start_date")),
            target_end=parse_p6_date(row.get("target_end_date")),
            act_start=parse_p6_date(row.get("act_start_date")),
            act_end=parse_p6_date(row.get("act_end_date")),
            early_start=parse_p6_date(row.get("early_start_date")),
            early_end=parse_p6_date(row.get("early_end_date")),
            late_start=parse_p6_date(row.get("late_start_date")),
            late_end=parse_p6_date(row.get("late_end_date")),
            total_float_hr=_to_float(row.get("total_float_hr_cnt")),
            free_float_hr=_to_float(row.get("free_float_hr_cnt")),
            cstr_type=(row.get("cstr_type") or "").strip() or None,
            cstr_date=parse_p6_date(row.get("cstr_date")),
            cstr_type2=(row.get("cstr_type2") or "").strip() or None,
            cstr_date2=parse_p6_date(row.get("cstr_date2")),
            driving_path_flag=(row.get("driving_path_flag", "") or "").upper() == "Y",
            phys_complete_pct=_to_float(row.get("phys_complete_pct")),
        )
        activities[task_id] = act
        if act.task_code in activities_by_code:
            warnings.append(
                f"duplicate task_code {act.task_code!r} (task_id {task_id} and "
                f"{activities_by_code[act.task_code].task_id}); keyed by task_id, "
                "code lookups will use the last one seen"
            )
        activities_by_code[act.task_code] = act

    # --- Relationships ---
    relationships: list[Relationship] = []
    known_pred_types = set(PRED_TYPE_LABELS)
    for row in _get_rows(conn, "TASKPRED"):
        pred_type = row.get("pred_type", "") or "PR_FS"
        if pred_type not in known_pred_types:
            warnings.append(
                f"relationship {row.get('task_pred_id')}: unknown pred_type "
                f"{pred_type!r}; treating as PR_FS"
            )
            pred_type = "PR_FS"
        relationships.append(
            Relationship(
                task_pred_id=row.get("task_pred_id", ""),
                task_id=row.get("task_id", ""),
                pred_task_id=row.get("pred_task_id", ""),
                proj_id=row.get("proj_id", ""),
                pred_type=pred_type,
                lag_hr=_to_float(row.get("lag_hr_cnt")),
            )
        )

    schedule = Schedule(
        project=project,
        wbs=wbs,
        activities=activities,
        activities_by_code=activities_by_code,
        relationships=relationships,
        calendars=calendars,
        warnings=warnings,
        store_warnings=store_warnings,
        meta=meta,
    )
    return schedule
