#!/usr/bin/env python3
"""Generate hhk_e_expansion.xer: a reconstructed Primavera P6 export for the
"HHK E Expansion" (Gila River) project, built from an Arviso Okland
Construction JV "Milestone & Takt Schedule" PDF graphic (revision date
2026-05-20, Takt start 2026-04-27).

THIS IS NOT A REAL P6 EXPORT. It is a from-scratch reconstruction, written
to exercise p6reader against a large, plausible-but-invented schedule. See
../examples/README.md for exactly what was inferred vs. read off the PDF.

The script is data-driven: activities are declared with a WBS path,
calendar, working-day duration, predecessor logic (FS/SS with working-day
lags), and optional start-date constraints taken from the PDF's milestone
summary table. A simple forward/backward CPM pass (day-granularity, per
activity's own calendar) computes early/late dates and total float so the
.xer is not left with blank float fields.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

OUT_PATH = "p6reader/examples/hhk_e_expansion.xer"

DATA_DATE = dt.date(2026, 5, 20)  # PDF revision date
PROJ_ID = 900
CAL_5D_ID = "9001"  # Mon-Fri, 8h/day -- design, procurement, civil, MEP-equip
CAL_6D_ID = "9002"  # Mon-Sat, 10h/day -- field takt trains (core/shell, buildout)

# ---------------------------------------------------------------------------
# Working-day calendar helpers (day granularity; mirrors the fixture's
# Mon-Fri/8h calendar shape but adds a Mon-Sat/10h field calendar).
# ---------------------------------------------------------------------------

MASK_5D = {0, 1, 2, 3, 4}       # Mon-Fri
MASK_6D = {0, 1, 2, 3, 4, 5}    # Mon-Sat


def is_workday(d: dt.date, mask: set[int]) -> bool:
    return d.weekday() in mask


def shift_forward(d: dt.date, n: int, mask: set[int]) -> dt.date:
    """Return the date n workdays after d (n >= 1)."""
    cur = d
    count = 0
    while count < n:
        cur = cur + dt.timedelta(days=1)
        if is_workday(cur, mask):
            count += 1
    return cur


def shift_backward(d: dt.date, n: int, mask: set[int]) -> dt.date:
    """Return the date n workdays before d (n >= 1)."""
    cur = d
    count = 0
    while count < n:
        cur = cur - dt.timedelta(days=1)
        if is_workday(cur, mask):
            count += 1
    return cur


def snap_forward(d: dt.date, mask: set[int]) -> dt.date:
    """If d is not a workday, move forward to the next one."""
    cur = d
    while not is_workday(cur, mask):
        cur = cur + dt.timedelta(days=1)
    return cur


def add_duration(start: dt.date, dur_days: int, mask: set[int]) -> dt.date:
    """Finish date of a task of dur_days working days starting on start."""
    start = snap_forward(start, mask)
    if dur_days <= 1:
        return start
    return shift_forward(start, dur_days - 1, mask)


def sub_duration(finish: dt.date, dur_days: int, mask: set[int]) -> dt.date:
    """Start date implied by a finish date and a working-day duration."""
    if dur_days <= 1:
        return finish
    return shift_backward(finish, dur_days - 1, mask)


def workday_span(d1: dt.date, d2: dt.date, mask: set[int]) -> int:
    """Signed count of workdays from d1 to d2 (0 if equal)."""
    if d1 == d2:
        return 0
    sign = 1 if d2 > d1 else -1
    a, b = (d1, d2) if d2 > d1 else (d2, d1)
    count = 0
    cur = a
    while cur < b:
        cur = cur + dt.timedelta(days=1)
        if is_workday(cur, mask):
            count += 1
    return sign * count


def mask_for(cal_id: str) -> set[int]:
    return MASK_6D if cal_id == CAL_6D_ID else MASK_5D


def day_hours(cal_id: str) -> float:
    return 10.0 if cal_id == CAL_6D_ID else 8.0


# ---------------------------------------------------------------------------
# Activity model
# ---------------------------------------------------------------------------


@dataclass
class Pred:
    code: str
    rel: str  # "FS" or "SS"
    lag: int = 0  # working days, on the successor's calendar


@dataclass
class Act:
    code: str
    name: str
    wbs: str
    dur: int = 1  # working days
    cal: str = CAL_5D_ID
    task_type: str = "TT_Task"
    preds: list[Pred] = field(default_factory=list)
    snet: dt.date | None = None  # Start On or After constraint (from PDF table)
    status: str | None = None  # override; default derived from data date
    actual_start: dt.date | None = None
    actual_end: dt.date | None = None
    # computed
    early_start: dt.date | None = None
    early_finish: dt.date | None = None
    late_start: dt.date | None = None
    late_finish: dt.date | None = None


ACTS: dict[str, Act] = {}


def add(code, name, wbs, dur=1, cal=CAL_5D_ID, task_type="TT_Task", preds=None, snet=None,
        status=None, actual_start=None, actual_end=None):
    a = Act(code=code, name=name, wbs=wbs, dur=dur, cal=cal, task_type=task_type,
            preds=list(preds or []), snet=snet, status=status,
            actual_start=actual_start, actual_end=actual_end)
    ACTS[code] = a
    return a


# ---------------------------------------------------------------------------
# WBS tree
# ---------------------------------------------------------------------------

WBS = [
    # (code, name, parent_code)
    ("ROOT", "HHK E Expansion - Gila River", None),
    ("PRECON", "Preconstruction & Design", "ROOT"),
    ("DESIGN", "Design Phases", "PRECON"),
    ("PROC", "Procurement", "PRECON"),
    ("CONST", "Construction", "ROOT"),
    ("CIVIL", "Site / Civil", "CONST"),
    ("CORESHELL", "Core & Shell", "CONST"),
    ("BUILDOUT", "Buildout & Finishes", "CONST"),
    ("BLD01", "Level 01 - Area 01", "BUILDOUT"),
    ("BLD02", "Level 01 - Area 02", "BUILDOUT"),
    ("BLD03", "Level 01 - Area 03", "BUILDOUT"),
    ("BLD04", "Level 02 - Area 04", "BUILDOUT"),
    ("BLD05", "Level 02 - Area 05", "BUILDOUT"),
    ("BLD06", "Level 02 - Area 06", "BUILDOUT"),
    ("BLD07", "Level 03 - Area 07", "BUILDOUT"),
    ("BLD08", "Level 03 - Area 08", "BUILDOUT"),
    ("SHELL09", "Level 04 - Shell Space Area 09", "BUILDOUT"),
    ("CLOSEOUT", "Closeout & Turnover", "CONST"),
]

# ---------------------------------------------------------------------------
# Design & Procurement (WBS: DESIGN, PROC)
# ---------------------------------------------------------------------------

add("RFQ-DUE", "RFQ Due", "DESIGN", dur=0, task_type="TT_Mile",
    status="TK_Complete", actual_start=dt.date(2026, 4, 24), actual_end=dt.date(2026, 4, 24))

add("DES-RFP", "Design & Trade RFP", "DESIGN", dur=25, cal=CAL_5D_ID,
    preds=[Pred("RFQ-DUE", "FS", 0)], status="TK_Active",
    actual_start=dt.date(2026, 4, 27))

add("SEL-GC", "Select GC", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("DES-RFP", "FS", 0)])

add("DES-START", "Design Start", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("SEL-GC", "FS", 2)])

add("PROGRAM", "Programming", "DESIGN", dur=40, preds=[Pred("DES-START", "FS", 0)])

add("PROG-COMPL", "Program Complete", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("PROGRAM", "FS", 0)])

add("CONCEPT", "Conceptual Design", "DESIGN", dur=119 * 5 // 7,
    preds=[Pred("PROG-COMPL", "FS", 0)], snet=dt.date(2026, 8, 3))

add("CONCEPT-COMPL", "Concept Complete", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("CONCEPT", "FS", 0)])

add("SD", "Schematic Design", "DESIGN", dur=49 * 5 // 7,
    preds=[Pred("CONCEPT-COMPL", "FS", 0)], snet=dt.date(2026, 12, 7))

add("SD-COMPL", "Schematic Complete", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("SD", "FS", 0)])

add("DD", "Design Development", "DESIGN", dur=63 * 5 // 7,
    preds=[Pred("SD-COMPL", "FS", 0)], snet=dt.date(2027, 2, 1))

add("DD-COMPL", "DD's Complete", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("DD", "FS", 0)])

add("CD", "Construction Documents", "DESIGN", dur=70 * 5 // 7,
    preds=[Pred("DD-COMPL", "FS", 0)], snet=dt.date(2027, 4, 12))

add("CD-COMPL", "CD's Complete", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("CD", "FS", 0)])

add("LOA-LOI", "LOA/LOI Release Shop Drawings", "DESIGN", dur=20,
    preds=[Pred("CD-COMPL", "SS", 0)])

add("AHJ-PERMIT", "AHJ Permit Approval", "DESIGN", dur=63 * 5 // 7,
    preds=[Pred("CD-COMPL", "FS", 0)], snet=dt.date(2027, 6, 28))

add("GMP-BUYOUT", "GMP / Buyout", "DESIGN", dur=91 * 5 // 7,
    preds=[Pred("CD-COMPL", "FS", 0)], snet=dt.date(2027, 6, 21))

add("GMP-APPR", "GMP Approval", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("GMP-BUYOUT", "FS", 0), Pred("AHJ-PERMIT", "FS", 0)])

add("NTP", "Notice to Proceed", "DESIGN", dur=0, task_type="TT_Mile",
    preds=[Pred("GMP-APPR", "FS", 1)])

add("HHK-APPR", "HHK Approval", "DESIGN", dur=20,
    preds=[Pred("GMP-BUYOUT", "SS", 0)])

# Procurement packages: PSD (~6wk) -> SDA (2wk) -> Fabrication & Delivery lead time.
PROC_PACKAGES = [
    ("GEN", "Generators & Transfer Switches", 62),
    ("SWG", "Main Electrical Gear", 52),
    ("UPS", "UPS", 40),
    ("CHIL", "Chillers & AHUs", 40),
    ("EF", "Exhaust Fans", 36),
    ("ELEV", "Elevators", 52),
    ("STL", "Steel Procurement", 31),
    ("GLZ", "Glazing", 38),
    ("MPAN", "Metal Panels", 38),
    ("ROOF", "Roofing", 12),
    ("UGB", "UG Utilities Brass Fittings", 16),
    ("REBAR", "Rebar", 6),
]
for code, label, lead_wk in PROC_PACKAGES:
    psd = add(f"{code}-PSD", f"{label} - Prepare Shop Drawings", "PROC", dur=30,
              preds=[Pred("LOA-LOI", "FS", 0)])
    sda = add(f"{code}-SDA", f"{label} - Shop Drawing Approval", "PROC", dur=10,
              preds=[Pred(f"{code}-PSD", "FS", 0)])
    add(f"{code}-DEL", f"{label} - Fabrication & Delivery", "PROC", dur=lead_wk * 5,
        preds=[Pred(f"{code}-SDA", "FS", 0)])

# ---------------------------------------------------------------------------
# Construction milestone + Site/Civil
# ---------------------------------------------------------------------------

add("START-CONST", "Start Construction", "CONST", dur=0, task_type="TT_Mile",
    preds=[Pred("NTP", "FS", 0)], snet=dt.date(2027, 9, 27))

CIVIL = [
    ("MAKESAFE", "Makesafe / SWPPP / Fencing", 15, None),
    ("CLEARGRUB", "Clear & Grub", 10, ("CV-MAKESAFE", "FS", 0)),
    ("EARTHWORK", "Earthwork", 20, ("CV-CLEARGRUB", "FS", 0)),
    ("UU", "Underground Utilities", 30, ("CV-EARTHWORK", "FS", 0)),
]
for code, name, dur, pred in CIVIL:
    preds = [Pred(*pred)] if pred else [Pred("START-CONST", "FS", 0)]
    add(f"CV-{code}", name, "CIVIL", dur=dur, preds=preds,
        snet=dt.date(2027, 9, 27) if pred is None else None)
add("REBAR-USE", "UG Utilities Brass Fittings Install", "CIVIL", dur=5,
    preds=[Pred("CV-UU", "SS", 5), Pred("UGB-DEL", "FS", 0)])

# ---------------------------------------------------------------------------
# Core & Shell (overlapping takt-style bars on the 6-day field calendar)
# ---------------------------------------------------------------------------

add("CS-FOOT", "Spot & Continuous Footings", "CORESHELL", dur=6 * 6, cal=CAL_6D_ID,
    preds=[Pred("CV-UU", "FS", 5)], snet=dt.date(2028, 1, 3))
add("CS-UGMEP", "Underground MEP Rough-In", "CORESHELL", dur=4 * 6, cal=CAL_6D_ID,
    preds=[Pred("CS-FOOT", "SS", 18)])
add("CS-WP", "Waterproofing", "CORESHELL", dur=4 * 6, cal=CAL_6D_ID,
    preds=[Pred("CS-UGMEP", "SS", 12)])
add("CS-BACKFILL", "Backfill", "CORESHELL", dur=2 * 6, cal=CAL_6D_ID,
    preds=[Pred("CS-WP", "SS", 12)])
add("CS-SOG", "Slab On Grade", "CORESHELL", dur=11 * 6, cal=CAL_6D_ID,
    preds=[Pred("CS-BACKFILL", "SS", 6)])
add("CS-STEEL", "Erect Steel", "CORESHELL", dur=18 * 6, cal=CAL_6D_ID,
    preds=[Pred("CS-SOG", "SS", 24), Pred("STL-DEL", "FS", 0)])
add("CS-ROOF", "Roofing", "CORESHELL", dur=16 * 6, cal=CAL_6D_ID,
    preds=[Pred("CS-STEEL", "SS", 60), Pred("ROOF-DEL", "FS", 0)])
add("CS-PANELS", "Prefab Panels", "CORESHELL", dur=13 * 6, cal=CAL_6D_ID,
    preds=[Pred("CS-STEEL", "SS", 66), Pred("MPAN-DEL", "FS", 0)])

# ---------------------------------------------------------------------------
# Buildout / Finishes takt trains (Areas 01-08)
# ---------------------------------------------------------------------------

# Legend abbreviations reconstructed from the PDF's Interiors/Finishes,
# MEP, and Structural legends -- see examples/README.md for the mapping
# assumptions where the takt-row codes weren't a direct legend hit.
TAKT_ROW1 = [
    ("WL", "Wall Layout", 1),
    ("EOH", "Electrical Overhead Rough-In", 3),
    ("FRM", "Framing", 3),
    ("OHR", "Mechanical/Plumbing Overhead Rough-In", 4),
    ("PW", "Painting / Wall Covering", 3),
    ("FL", "Flooring", 3),
    ("SPMW", "Specialties & Millwork", 4),
    ("TIL", "Tile", 2),
    ("FPPP", "Fire Protection & Prefab Panels", 3),
]
TAKT_ROW2 = [
    ("PWFS", "Wall Covering & Fire Sprinkler Rough", 3),
    ("MEPOH", "Mechanical/Plumbing Overhead & In-Wall Rough", 9),
    ("MEPTRIM", "MEP Trim - Hang Lights & Fixtures", 6),
    ("ACT", "Ceiling Grid", 2),
    ("FIN", "Finishes", 3),
]

AREAS = ["01", "02", "03", "04", "05", "06", "07", "08"]
AREA_START_LAG = 5  # ~1 week stagger between successive area takt trains

prev_area_first_code = None
for i, area in enumerate(AREAS):
    wbs = f"BLD{area}"
    prev_code = None
    first_code = None
    for abbr, label, dur in TAKT_ROW1:
        code = f"BLD{area}-{abbr}"
        if prev_code is None:
            preds = ([Pred(prev_area_first_code, "SS", AREA_START_LAG)]
                     if prev_area_first_code else [Pred("CS-SOG", "SS", 30)])
        else:
            preds = [Pred(prev_code, "FS", 0)]
        add(code, f"Area {area} - {label}", wbs, dur=dur, cal=CAL_6D_ID, preds=preds)
        if first_code is None:
            first_code = code
        prev_code = code
    row1_last = prev_code
    for abbr, label, dur in TAKT_ROW2:
        code = f"BLD{area}-{abbr}"
        if prev_code == row1_last:
            preds = [Pred(row1_last, "SS", 2)]
        else:
            preds = [Pred(prev_code, "FS", 0)]
        add(code, f"Area {area} - {label}", wbs, dur=dur, cal=CAL_6D_ID, preds=preds)
        prev_code = code
    prev_area_first_code = first_code

# Level 04 Shell Space Area 09 (larger, coarser-grained; 37 wk overall per PDF)
add("SHELL09-STRUCT", "Shell Space Rough Structure", "SHELL09", dur=10 * 6, cal=CAL_6D_ID,
    preds=[Pred("CS-STEEL", "FS", 0)])
add("SHELL09-MEP", "Shell Space MEP Overhead Rough-In", "SHELL09", dur=10 * 6, cal=CAL_6D_ID,
    preds=[Pred("SHELL09-STRUCT", "SS", 12)])
add("SHELL09-ENV", "Shell Space Envelope Closeout", "SHELL09", dur=8 * 6, cal=CAL_6D_ID,
    preds=[Pred("SHELL09-MEP", "SS", 12)])
add("SHELL09-TURN", "Shell Space Finish Allowance & Turnover", "SHELL09", dur=9 * 6, cal=CAL_6D_ID,
    preds=[Pred("SHELL09-ENV", "SS", 12)])

add("PM-CONST", "General Conditions / Project Management", "CONST", dur=400,
    cal=CAL_5D_ID, task_type="TT_LOE", preds=[Pred("START-CONST", "SS", 0)])

# ---------------------------------------------------------------------------
# Closeout
# ---------------------------------------------------------------------------

last_finish_area = f"BLD{AREAS[-1]}-FIN"
add("FI-AHJ", "Final Inspections AHJ", "CLOSEOUT", dur=20,
    preds=[Pred(last_finish_area, "FS", 0), Pred("SHELL09-TURN", "FS", 0)])
add("COO", "COO", "CLOSEOUT", dur=0, task_type="TT_Mile", preds=[Pred("FI-AHJ", "FS", 0)])
add("OWNER-MOVEIN", "Owner Move-In", "CLOSEOUT", dur=60, preds=[Pred("COO", "FS", 0)])
add("MEP-EQUIP", "MEP Equip Rm Install", "CLOSEOUT", dur=90,
    preds=[Pred("CS-ROOF", "SS", 30), Pred("GEN-DEL", "FS", 0), Pred("SWG-DEL", "FS", 0),
           Pred("CHIL-DEL", "FS", 0), Pred("UPS-DEL", "FS", 0)])
add("AIR-ON", "Air On", "CLOSEOUT", dur=0, task_type="TT_Mile",
    preds=[Pred("MEP-EQUIP", "FS", 0), Pred("EF-DEL", "FS", 0)])
add("SUB-COMPL", "Substantial Completion", "CLOSEOUT", dur=0, task_type="TT_Mile",
    preds=[Pred("OWNER-MOVEIN", "FS", 0), Pred("AIR-ON", "FS", 0)], snet=dt.date(2029, 5, 7))
add("FIN-COMPL", "Final Completion", "CLOSEOUT", dur=0, task_type="TT_FinMile",
    preds=[Pred("SUB-COMPL", "FS", 55)], snet=dt.date(2029, 7, 30))

# ---------------------------------------------------------------------------
# CPM: forward pass (early dates, respecting SNET constraints)
# ---------------------------------------------------------------------------

ORDER = list(ACTS.keys())  # declaration order is already topological

for code in ORDER:
    a = ACTS[code]
    mask = mask_for(a.cal)
    if a.preds:
        candidates = []
        for p in a.preds:
            pa = ACTS[p.code]
            if p.rel == "FS":
                candidates.append(shift_forward(pa.early_finish, p.lag + 1, mask))
            else:  # SS
                candidates.append(pa.early_start if p.lag == 0 else shift_forward(pa.early_start, p.lag, mask))
        es = max(candidates)
    else:
        es = DATA_DATE
    es = snap_forward(es, mask)
    if a.snet and a.snet > es:
        es = snap_forward(a.snet, mask)
    if a.actual_start and a.status in ("TK_Active", "TK_Complete"):
        es = a.actual_start
    a.early_start = es
    a.early_finish = add_duration(es, max(a.dur, 1), mask) if a.dur > 0 else es

PROJECT_FINISH = ACTS["FIN-COMPL"].early_finish

# ---------------------------------------------------------------------------
# CPM: backward pass (late dates + total float)
# ---------------------------------------------------------------------------

SUCC: dict[str, list[tuple[str, str, int]]] = {c: [] for c in ORDER}
for code in ORDER:
    a = ACTS[code]
    for p in a.preds:
        SUCC[p.code].append((code, p.rel, p.lag))

for code in reversed(ORDER):
    a = ACTS[code]
    mask = mask_for(a.cal)
    succs = SUCC[code]
    if not succs:
        lf = PROJECT_FINISH
    else:
        candidates = []
        for succ_code, rel, lag in succs:
            sa = ACTS[succ_code]
            if rel == "FS":
                candidates.append(shift_backward(sa.late_start, lag + 1, mask))
            else:  # SS -> convert successor's late_start bound into a late_finish bound for a
                late_start_bound = sa.late_start if lag == 0 else shift_backward(sa.late_start, lag, mask)
                candidates.append(add_duration(late_start_bound, max(a.dur, 1), mask) if a.dur > 0 else late_start_bound)
        lf = min(candidates)
    a.late_finish = lf
    a.late_start = sub_duration(lf, max(a.dur, 1), mask) if a.dur > 0 else lf

for code in ORDER:
    a = ACTS[code]
    mask = mask_for(a.cal)
    tf_days = workday_span(a.early_start, a.late_start, mask)
    a.total_float_hr = tf_days * day_hours(a.cal)

# ---------------------------------------------------------------------------
# Status resolution
# ---------------------------------------------------------------------------

for code in ORDER:
    a = ACTS[code]
    if a.status:
        continue
    if a.early_finish and a.early_finish < DATA_DATE:
        a.status = "TK_Complete"
    elif a.early_start and a.early_start < DATA_DATE <= (a.early_finish or a.early_start):
        a.status = "TK_Active"
    else:
        a.status = "TK_NotStart"

# ---------------------------------------------------------------------------
# XER emission
# ---------------------------------------------------------------------------

def fmt(d: dt.date | None, hhmm: str = "08:00") -> str:
    if d is None:
        return ""
    return f"{d.isoformat()} {hhmm}"


def fmt_end(d: dt.date | None) -> str:
    return fmt(d, "17:00") if d else ""


CLNDR_5D = (
    "(0||CalendarData()(  (0||DaysOfWeek()("
    "    (0||1(s|08:00|f|17:00)())"
    "    (0||2(s|08:00|f|17:00)())"
    "    (0||3(s|08:00|f|17:00)())"
    "    (0||4(s|08:00|f|17:00)())"
    "    (0||5(s|08:00|f|17:00)())"
    "    (0||6()())"
    "    (0||7()())"
    "  ))"
    "  (0||Exceptions()())))"
)

CLNDR_6D = (
    "(0||CalendarData()(  (0||DaysOfWeek()("
    "    (0||1(s|06:00|f|16:00)())"
    "    (0||2(s|06:00|f|16:00)())"
    "    (0||3(s|06:00|f|16:00)())"
    "    (0||4(s|06:00|f|16:00)())"
    "    (0||5(s|06:00|f|16:00)())"
    "    (0||6(s|06:00|f|16:00)())"
    "    (0||7()())"
    "  ))"
    "  (0||Exceptions()())))"
)

lines: list[str] = []


def table(name, fields, rows):
    lines.append(f"%T\t{name}")
    lines.append("%F\t" + "\t".join(fields))
    for row in rows:
        lines.append("%R\t" + "\t".join(row))
    lines.append("%E")


def main() -> None:
    header = "\t".join(["ERMHDR", "8.4", DATA_DATE.isoformat(), "HHK E Expansion",
                         "admin", "dcollinsworth", "P6Reader", "1", "USD"])
    lines.append(header)

    table("CURRTYPE", ["curr_id", "decimal_digit_cnt", "curr_symbol", "curr_type"],
          [["1", "2", "$", "US Dollar"]])

    table("CALENDAR",
          ["clndr_id", "clndr_name", "clndr_type", "day_hr_cnt", "week_hr_cnt", "clndr_data"],
          [
              [CAL_5D_ID, "5 Day Design/Procurement Workweek", "CA_Base", "8", "40", CLNDR_5D],
              [CAL_6D_ID, "6 Day Field Takt Calendar", "CA_Base", "10", "60", CLNDR_6D],
          ])

    proj_start = min(a.early_start for a in ACTS.values())
    proj_end = max(a.early_finish or a.early_start for a in ACTS.values())
    table("PROJECT",
          ["proj_id", "proj_short_name", "proj_name", "plan_start_date", "plan_end_date",
           "last_recalc_date", "scd_end_date"],
          [[str(PROJ_ID), "HHK-E-EXP", "HHK E Expansion - Gila River",
            fmt(proj_start), fmt_end(proj_end), fmt(DATA_DATE), fmt_end(proj_end)]])

    wbs_id_of = {code: str(1000 + i) for i, (code, _, _) in enumerate(WBS)}
    wbs_rows = []
    for code, name, parent in WBS:
        wbs_rows.append([
            wbs_id_of[code],
            wbs_id_of[parent] if parent else " ",
            str(PROJ_ID),
            code,
            name,
            "Y" if parent is None else "N",
        ])
    table("PROJWBS",
          ["wbs_id", "parent_wbs_id", "proj_id", "wbs_short_name", "wbs_name", "proj_node_flag"],
          wbs_rows)

    task_fields = [
        "task_id", "proj_id", "wbs_id", "task_code", "task_name", "task_type", "status_code",
        "target_drtn_hr_cnt", "remain_drtn_hr_cnt", "target_start_date", "target_end_date",
        "act_start_date", "act_end_date", "early_start_date", "early_end_date",
        "late_start_date", "late_end_date", "total_float_hr_cnt", "free_float_hr_cnt",
        "cstr_type", "cstr_date", "cstr_type2", "cstr_date2", "clndr_id",
        "driving_path_flag", "phys_complete_pct",
    ]
    task_id_of = {code: str(10000 + i) for i, code in enumerate(ORDER)}
    task_rows = []
    for code in ORDER:
        a = ACTS[code]
        dh = day_hours(a.cal)
        target_hr = a.dur * dh
        is_complete = a.status == "TK_Complete"
        is_active = a.status == "TK_Active"
        remain_hr = 0.0 if is_complete else (target_hr * 0.7 if is_active else target_hr)
        pct = 100 if is_complete else (30 if is_active else 0)
        cstr_type = "CS_SNET" if a.snet else ""
        cstr_date = fmt(a.snet) if a.snet else ""
        task_rows.append([
            task_id_of[code], str(PROJ_ID), wbs_id_of[a.wbs], code, a.name, a.task_type, a.status,
            f"{target_hr:g}", f"{remain_hr:g}",
            fmt(a.early_start), fmt_end(a.early_finish),
            fmt(a.actual_start) if is_complete or is_active else "",
            fmt_end(a.actual_end) if is_complete else "",
            fmt(a.early_start), fmt_end(a.early_finish),
            fmt(a.late_start), fmt_end(a.late_finish),
            f"{a.total_float_hr:g}", f"{a.total_float_hr:g}",
            cstr_type, cstr_date, "", "",
            a.cal, "Y" if a.total_float_hr <= 0 else "N", str(pct),
        ])
    table("TASK", task_fields, task_rows)

    pred_rows = []
    pred_id = 1
    for code in ORDER:
        a = ACTS[code]
        for p in a.preds:
            pred_rows.append([
                str(pred_id), task_id_of[code], task_id_of[p.code], str(PROJ_ID),
                f"PR_{p.rel}", f"{p.lag * day_hours(a.cal):g}",
            ])
            pred_id += 1
    table("TASKPRED",
          ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_type", "lag_hr_cnt"],
          pred_rows)

    table("RSRC", ["rsrc_id", "rsrc_name", "rsrc_short_name"],
          [["1", "General Conditions Staff", "GC-PM"]])
    table("TASKRSRC", ["taskrsrc_id", "task_id", "proj_id", "rsrc_id", "target_qty"],
          [["1", task_id_of["PM-CONST"], str(PROJ_ID), "1", "3200"]])

    table("UDFTYPE", ["udf_type_id", "table_name", "udf_type_label"], [["1", "TASK", "Takt Area"]])
    udf_rows = []
    for area in AREAS:
        first_code = f"BLD{area}-WL"
        udf_rows.append(["1", task_id_of[first_code], str(PROJ_ID), f"Area {area}"])
    table("UDFVALUE", ["udf_type_id", "fk_id", "proj_id", "udf_text"], udf_rows)

    lines.append("%E")
    content = "\n".join(lines) + "\n"
    with open(OUT_PATH, "w", encoding="cp1252", newline="\n") as f:
        f.write(content)

    print(f"Wrote {OUT_PATH}: {len(ORDER)} activities, {len(pred_rows)} relationships")


if __name__ == "__main__":
    main()
