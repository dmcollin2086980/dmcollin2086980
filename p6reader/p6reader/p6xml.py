"""P6 XML export parser.

Maps a P6 XML export (``<APIBusinessObjects>`` root, Oracle namespace of the
form ``http://xmlns.oracle.com/Primavera/P6/V<version>/API/BusinessObjects``)
onto the *same* table/column shape produced by ``xer.py``, so that
``store.py``, ``model.py`` and everything downstream is completely
format-agnostic.

The namespace is read from the file itself, never hardcoded to a specific P6
version. Values that don't parse cleanly are recorded as warnings rather
than raising -- same tolerance contract as the XER parser.

See docs/ASSUMPTIONS.md for every format assumption made here (element
names, activity/status/relationship-type string mappings, calendar
structure) -- none of it has been validated against a real P6 XML export.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from xml.etree import ElementTree as ET

# --- String-value mappings: XML uses readable strings, XER uses codes. ----

ACTIVITY_TYPE_MAP = {
    "Task Dependent": "TT_Task",
    "Resource Dependent": "TT_Rsrc",
    "Start Milestone": "TT_Mile",
    "Finish Milestone": "TT_FinMile",
    "Level of Effort": "TT_LOE",
    "WBS Summary": "TT_WBS",
}

STATUS_MAP = {
    "Not Started": "TK_NotStart",
    "In Progress": "TK_Active",
    "Completed": "TK_Complete",
}

RELATIONSHIP_TYPE_MAP = {
    "Finish to Start": "PR_FS",
    "Start to Start": "PR_SS",
    "Finish to Finish": "PR_FF",
    "Start to Finish": "PR_SF",
}

CONSTRAINT_TYPE_MAP = {
    "Mandatory Start": "CS_MSO",
    "Mandatory Finish": "CS_MEO",
    "Start On": "CS_SO",
    "Finish On": "CS_FO",
    "Start On or Before": "CS_SNLT",
    "Start On or After": "CS_SNET",
    "Finish On or Before": "CS_FNLT",
    "Finish On or After": "CS_FNET",
    "As Late As Possible": "CS_ALAP",
}


@dataclass
class TableData:
    """Duck-type compatible with xer.XerTable: has .fields and .rows."""

    fields: list[str] = field(default_factory=list)
    rows: list[dict[str, str]] = field(default_factory=list)


@dataclass
class ParsedXml:
    namespace: str | None
    tables: dict[str, TableData] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def _local_children(elem: ET.Element) -> dict[str, str]:
    """Flatten an element's direct children into {localname: text}.

    Ignores nested structural children (e.g. StandardWorkWeek) -- callers
    that need those extract them separately.
    """
    out: dict[str, str] = {}
    for child in elem:
        name = _strip_ns(child.tag)
        if name in out:
            continue  # first occurrence wins; repeats handled by specific parsers
        out[name] = (child.text or "").strip()
    return out


def _detect_namespace(root: ET.Element) -> str | None:
    if root.tag.startswith("{"):
        return root.tag[1 : root.tag.index("}")]
    return None


def _fmt_date(value: str) -> str:
    """Normalize an XML date ('YYYY-MM-DDTHH:MM:SS') to XER-style
    'YYYY-MM-DD HH:MM' so the rest of the pipeline (model.py's date parser)
    handles both formats uniformly. Falls back to the raw value if it
    doesn't match the expected pattern.
    """
    if not value:
        return ""
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})", value)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    m2 = re.match(r"^(\d{4}-\d{2}-\d{2})$", value)
    if m2:
        return f"{m2.group(1)} 00:00"
    return value


def _fmt_hours(value: str) -> str:
    """XML durations are decimal hours already; pass through, normalizing
    whitespace. Non-numeric values are passed through as-is (a downstream
    typed-conversion warning will catch it).
    """
    return value.strip() if value else ""


def _parse_calendar(elem: ET.Element, warnings: list[str]) -> dict[str, str]:
    fields = _local_children(elem)
    clndr_id = fields.get("ObjectId", "")
    clndr_name = fields.get("Name") or fields.get("Id", "")
    day_hr_cnt = fields.get("HoursPerDay", "8")

    # Rebuild a clndr_data-equivalent string so calendars.py's single decoder
    # can be reused unchanged for both formats -- keeps the two parsers from
    # diverging on calendar semantics.
    day_name_to_num = {
        "Monday": 1,
        "Tuesday": 2,
        "Wednesday": 3,
        "Thursday": 4,
        "Friday": 5,
        "Saturday": 6,
        "Sunday": 7,
    }
    day_shifts: dict[int, list[str]] = {}
    week = elem.find(".//{*}StandardWorkWeek")
    if week is not None:
        for wh in week.findall("{*}StandardWorkHours"):
            wh_fields = _local_children(wh)
            day_name = wh_fields.get("DayOfWeek", "")
            day_num = day_name_to_num.get(day_name)
            if day_num is None:
                continue
            shifts: list[str] = []
            for wt in wh.findall("{*}WorkTime"):
                wt_fields = _local_children(wt)
                start = wt_fields.get("Start", "")
                finish = wt_fields.get("Finish", "")
                if start and finish:
                    shifts.append(f"s|{start}|f|{finish}")
            day_shifts[day_num] = shifts
    else:
        warnings.append(
            f"calendar {clndr_id!r} ({clndr_name!r}): no StandardWorkWeek element found"
        )

    days_str = "".join(
        f"(0||{d}({''.join(day_shifts.get(d, []))})())" for d in range(1, 8)
    )

    exceptions_parts: list[str] = []
    exc_container = elem.find(".//{*}HolidayOrExceptions")
    if exc_container is not None:
        for i, exc in enumerate(exc_container.findall("{*}HolidayOrException")):
            exc_fields = _local_children(exc)
            date_str = exc_fields.get("Date", "")
            ordinal = _date_to_ordinal(date_str)
            if ordinal is None:
                continue
            exceptions_parts.append(f"(0||{i}(d|{ordinal})())")
    exceptions_str = "".join(exceptions_parts)

    clndr_data = f"(0||CalendarData()((0||DaysOfWeek()({days_str}))(0||Exceptions()({exceptions_str}))))"

    return {
        "clndr_id": clndr_id,
        "clndr_name": clndr_name,
        "clndr_type": "CA_Base",
        "day_hr_cnt": day_hr_cnt,
        "week_hr_cnt": "",
        "clndr_data": clndr_data,
    }


def _date_to_ordinal(date_str: str) -> int | None:
    import datetime

    from .calendars import DATE_ORDINAL_EPOCH

    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", date_str)
    if not m:
        return None
    y, mo, d = (int(x) for x in m.groups())
    try:
        return (datetime.date(y, mo, d) - DATE_ORDINAL_EPOCH).days
    except ValueError:
        return None


def parse_xml_bytes(raw: bytes) -> ParsedXml:
    warnings: list[str] = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        warnings.append(f"XML failed to parse: {exc}")
        return ParsedXml(namespace=None, tables={}, warnings=warnings)

    namespace = _detect_namespace(root)
    if namespace is None:
        warnings.append("no XML namespace detected on root element; continuing anyway")
    elif "xmlns.oracle.com/Primavera/P6" not in namespace:
        warnings.append(
            f"root namespace {namespace!r} does not look like a P6 BusinessObjects "
            "namespace; continuing anyway"
        )

    project_rows: list[dict[str, str]] = []
    wbs_rows: list[dict[str, str]] = []
    task_rows: list[dict[str, str]] = []
    pred_rows: list[dict[str, str]] = []
    calendar_rows: list[dict[str, str]] = []

    # Project may appear at the root, or nested; search anywhere in the tree.
    for elem in root.iter():
        local = _strip_ns(elem.tag)

        if local == "Project":
            f = _local_children(elem)
            project_rows.append(
                {
                    "proj_id": f.get("ObjectId", ""),
                    "proj_short_name": f.get("Id", ""),
                    "plan_start_date": _fmt_date(f.get("PlannedStartDate", "")),
                    "plan_end_date": _fmt_date(f.get("MustFinishByDate") or f.get("FinishDate", "")),
                    "last_recalc_date": _fmt_date(f.get("DataDate", "")),
                    "scd_end_date": _fmt_date(f.get("FinishDate", "")),
                }
            )
        elif local == "WBS":
            f = _local_children(elem)
            wbs_rows.append(
                {
                    "wbs_id": f.get("ObjectId", ""),
                    "parent_wbs_id": f.get("ParentObjectId", ""),
                    "proj_id": f.get("ProjectObjectId", ""),
                    "wbs_short_name": f.get("Id", ""),
                    "wbs_name": f.get("Name", ""),
                    "proj_node_flag": "Y" if not f.get("ParentObjectId") else "N",
                }
            )
        elif local == "Calendar":
            calendar_rows.append(_parse_calendar(elem, warnings))
        elif local == "Activity":
            f = _local_children(elem)
            xml_type = f.get("Type", "")
            task_type = ACTIVITY_TYPE_MAP.get(xml_type)
            if task_type is None:
                warnings.append(
                    f"activity {f.get('Id', f.get('ObjectId'))!r}: unknown XML activity "
                    f"Type {xml_type!r}; treating as TT_Task"
                )
                task_type = "TT_Task"
            xml_status = f.get("Status", "")
            status_code = STATUS_MAP.get(xml_status)
            if status_code is None:
                warnings.append(
                    f"activity {f.get('Id', f.get('ObjectId'))!r}: unknown XML Status "
                    f"{xml_status!r}; treating as TK_NotStart"
                )
                status_code = "TK_NotStart"
            xml_cstr = f.get("PrimaryConstraintType", "")
            cstr_type = CONSTRAINT_TYPE_MAP.get(xml_cstr, "") if xml_cstr else ""

            task_rows.append(
                {
                    "task_id": f.get("ObjectId", ""),
                    "proj_id": f.get("ProjectObjectId", ""),
                    "wbs_id": f.get("WBSObjectId", ""),
                    "task_code": f.get("Id", f.get("ObjectId", "")),
                    "task_name": f.get("Name", ""),
                    "task_type": task_type,
                    "status_code": status_code,
                    "target_drtn_hr_cnt": _fmt_hours(f.get("PlannedDuration", "")),
                    "remain_drtn_hr_cnt": _fmt_hours(f.get("RemainingDuration", "")),
                    "target_start_date": _fmt_date(f.get("PlannedStartDate", "")),
                    "target_end_date": _fmt_date(f.get("PlannedFinishDate", "")),
                    "act_start_date": _fmt_date(f.get("ActualStartDate", "")),
                    "act_end_date": _fmt_date(f.get("ActualFinishDate", "")),
                    "early_start_date": _fmt_date(f.get("StartDate", "")),
                    "early_end_date": _fmt_date(f.get("FinishDate", "")),
                    "late_start_date": _fmt_date(f.get("LateStartDate", "")),
                    "late_end_date": _fmt_date(f.get("LateFinishDate", "")),
                    "total_float_hr_cnt": _fmt_hours(f.get("TotalFloat", "")),
                    "free_float_hr_cnt": _fmt_hours(f.get("FreeFloat", "")),
                    "cstr_type": cstr_type,
                    "cstr_date": _fmt_date(f.get("PrimaryConstraintDate", "")),
                    "cstr_type2": "",
                    "cstr_date2": "",
                    "clndr_id": f.get("CalendarObjectId", ""),
                    "driving_path_flag": "Y" if f.get("DrivingPath", "").lower() == "true" else "N",
                    "phys_complete_pct": f.get("PercentComplete", ""),
                }
            )
        elif local == "Relationship":
            f = _local_children(elem)
            xml_type = f.get("Type", "")
            pred_type = RELATIONSHIP_TYPE_MAP.get(xml_type)
            if pred_type is None:
                warnings.append(
                    f"relationship {f.get('ObjectId')!r}: unknown XML relationship "
                    f"Type {xml_type!r}; treating as PR_FS"
                )
                pred_type = "PR_FS"
            pred_rows.append(
                {
                    "task_pred_id": f.get("ObjectId", ""),
                    "task_id": f.get("SuccessorActivityObjectId", ""),
                    "pred_task_id": f.get("PredecessorActivityObjectId", ""),
                    "proj_id": f.get("SuccessorProjectObjectId", ""),
                    "pred_type": pred_type,
                    "lag_hr_cnt": _fmt_hours(f.get("Lag", "0")),
                }
            )

    tables: dict[str, TableData] = {}

    def _add(name: str, rows: list[dict[str, str]], fields_order: list[str]) -> None:
        if rows:
            tables[name] = TableData(fields=fields_order, rows=rows)

    _add(
        "PROJECT",
        project_rows,
        ["proj_id", "proj_short_name", "plan_start_date", "plan_end_date", "last_recalc_date", "scd_end_date"],
    )
    _add(
        "PROJWBS",
        wbs_rows,
        ["wbs_id", "parent_wbs_id", "proj_id", "wbs_short_name", "wbs_name", "proj_node_flag"],
    )
    _add(
        "CALENDAR",
        calendar_rows,
        ["clndr_id", "clndr_name", "clndr_type", "day_hr_cnt", "week_hr_cnt", "clndr_data"],
    )
    _add(
        "TASK",
        task_rows,
        [
            "task_id", "proj_id", "wbs_id", "task_code", "task_name", "task_type", "status_code",
            "target_drtn_hr_cnt", "remain_drtn_hr_cnt", "target_start_date", "target_end_date",
            "act_start_date", "act_end_date", "early_start_date", "early_end_date",
            "late_start_date", "late_end_date", "total_float_hr_cnt", "free_float_hr_cnt",
            "cstr_type", "cstr_date", "cstr_type2", "cstr_date2", "clndr_id",
            "driving_path_flag", "phys_complete_pct",
        ],
    )
    _add(
        "TASKPRED",
        pred_rows,
        ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_type", "lag_hr_cnt"],
    )

    if not task_rows:
        warnings.append("no <Activity> elements found in XML file")

    return ParsedXml(namespace=namespace, tables=tables, warnings=warnings)


def parse_xml_file(path: str) -> ParsedXml:
    with open(path, "rb") as f:
        raw = f.read()
    return parse_xml_bytes(raw)
