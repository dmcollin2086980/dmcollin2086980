# CSV export column mapping

`p6reader export` writes readable, scheduler-facing column names rather than
raw P6/XER field names. This table is the authoritative mapping so anyone
auditing the CSVs can trace a column back to its source field.

## activities.csv

| CSV column | Source (XER field / derived) |
|---|---|
| Activity ID | `TASK.task_code` |
| Activity Name | `TASK.task_name` |
| WBS Path | derived: full WBS ancestry from `PROJWBS`, joined with " > " |
| Activity Type | `TASK.task_type` (`TT_Task` -> "Task", `TT_Mile` -> "Start Milestone", `TT_FinMile` -> "Finish Milestone", `TT_LOE` -> "Level of Effort", `TT_WBS` -> "WBS Summary", `TT_Rsrc` -> "Resource-Dependent Task") |
| Status | `TASK.status_code` (`TK_NotStart`/`TK_Active`/`TK_Complete` -> "Not Started"/"In Progress"/"Complete") |
| Calendar | `CALENDAR.clndr_name` for `TASK.clndr_id` |
| Original Duration (days) | `TASK.target_drtn_hr_cnt` / activity's calendar `day_hr_cnt` |
| Remaining Duration (days) | `TASK.remain_drtn_hr_cnt` / activity's calendar `day_hr_cnt` |
| Target Start / Target Finish | `TASK.target_start_date` / `target_end_date` |
| Actual Start / Actual Finish | `TASK.act_start_date` / `act_end_date` |
| Early Start / Early Finish | `TASK.early_start_date` / `early_end_date` |
| Late Start / Late Finish | `TASK.late_start_date` / `late_end_date` |
| Total Float (days) | `TASK.total_float_hr_cnt` / calendar `day_hr_cnt` |
| Free Float (days) | `TASK.free_float_hr_cnt` / calendar `day_hr_cnt` |
| Constraint Type / Date | `TASK.cstr_type` / `cstr_date` (`CS_MSO` -> "Mandatory Start", etc. -- see `model.py: CONSTRAINT_LABELS`) |
| Secondary Constraint Type / Date | `TASK.cstr_type2` / `cstr_date2` |
| Driving | `TASK.driving_path_flag` ("Y"/"N" -> "Yes"/"No") |
| Percent Complete | `TASK.phys_complete_pct` |

## relationships.csv

| CSV column | Source |
|---|---|
| Predecessor ID / Name | `TASKPRED.pred_task_id` resolved to `TASK.task_code` / `task_name` |
| Successor ID / Name | `TASKPRED.task_id` resolved to `TASK.task_code` / `task_name` |
| Type | `TASKPRED.pred_type` (`PR_FS`/`PR_SS`/`PR_FF`/`PR_SF` -> "Finish to Start"/"Start to Start"/"Finish to Finish"/"Start to Finish") |
| Lag (days) | `TASKPRED.lag_hr_cnt` / the predecessor activity's calendar `day_hr_cnt` |

## wbs.csv

| CSV column | Source |
|---|---|
| WBS Code | `PROJWBS.wbs_short_name` |
| WBS Name | `PROJWBS.wbs_name` |
| Full Path | derived: ancestry chain of short names, joined with " > " |
| Level | derived: depth in the WBS tree (root = 1) |
| Is Project Node | `PROJWBS.proj_node_flag` ("Y"/"N" -> "Yes"/"No") |

## calendars.csv

| CSV column | Source |
|---|---|
| Calendar ID | `CALENDAR.clndr_id` |
| Calendar Name | `CALENDAR.clndr_name` |
| Hours per Day | `CALENDAR.day_hr_cnt` |
| Monday...Sunday | decoded from `CALENDAR.clndr_data` (see `docs/XER_FORMAT_NOTES.md`); hours worked that weekday |
| Exception Count | number of decoded entries in the calendar's `Exceptions` section |
| Parse Status | "OK" or "FAILED (fallback Mon-Fri 8h)" if `clndr_data` could not be decoded |

P6 XML exports are mapped onto the same XER field names before reaching
this layer (see `p6xml.py`), so this table applies to both source formats.
