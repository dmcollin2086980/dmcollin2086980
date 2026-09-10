"""Phase 4 (deferred): independent CPM recalculation.

This module is intentionally not implemented. Per the build spec, Phase 4
(forward/backward pass CPM recalculation and validation against a GC's
stored dates) is out of scope for this build. It requires validation against
at least three real P6 sample exports before it can be trusted (see section
6 of the build spec), and no real samples were available at build time.

When this is picked up:

- Implement forward/backward pass using each activity's own calendar,
  relationship types (FS/SS/FF/SF), lags, and constraints.
- Decide retained-logic vs. progress-override for in-progress activities
  (default to retained logic, make it a flag).
- Verify against real samples whether lag is measured on the predecessor's
  or successor's calendar.
- Compare calculated dates against the file's stored early/late dates and
  report any activity that differs by more than one working day.
"""

from __future__ import annotations


def recalc(*args, **kwargs):  # noqa: D401 - explicit stub
    """Not implemented. See module docstring."""
    raise NotImplementedError(
        "Phase 4 CPM recalculation is deferred and not implemented in this build."
    )
