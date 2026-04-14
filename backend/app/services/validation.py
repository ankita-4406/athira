"""Server-side validation for saved availability profiles."""

from __future__ import annotations

from app.schemas import AvailabilityBlock, AvailabilityProfile
from app.services.normalize import detect_overlaps, time_to_minutes
from app.services.normalize import period_for_start_minutes as norm_period


def _aligned_30m(t: str, *, end: bool = False) -> bool:
    try:
        m = time_to_minutes(t, end=end)
    except Exception:
        return False
    if end and m == 1440:
        return True
    return m % 30 == 0 and 0 <= m <= 1440


def reconcile_blocks(blocks: list[AvailabilityBlock]) -> list[AvailabilityBlock]:
    """Recompute period labels and block_id from authoritative start/end/day."""
    out: list[AvailabilityBlock] = []
    for b in blocks:
        sm = time_to_minutes(b.start)
        em = time_to_minutes(b.end, end=(b.end == "24:00"))
        period = norm_period(sm)
        bid = f"{b.day.value}-{b.start}-{b.end}"
        out.append(
            AvailabilityBlock(
                day=b.day,
                start=b.start,
                end=b.end,
                period=period,
                block_id=bid,
            )
        )
    return out


def validate_profile(profile: AvailabilityProfile) -> tuple[list[str], list[str]]:
    """
    Returns (errors, warnings). Errors block persistence; warnings are informational.
    """
    errors: list[str] = []
    warnings: list[str] = []

    for i, b in enumerate(profile.blocks):
        if not _aligned_30m(b.start, end=False):
            errors.append(f"block_{i}_start_not_30m")
        if not _aligned_30m(b.end, end=True):
            errors.append(f"block_{i}_end_not_30m")
        try:
            sm = time_to_minutes(b.start)
            em = time_to_minutes(b.end, end=(b.end == "24:00"))
        except Exception:
            errors.append(f"block_{i}_invalid_time")
            continue
        if em <= sm and not (b.end == "24:00" and sm < 1440):
            errors.append(f"block_{i}_end_before_start")

        expected = norm_period(sm)
        if b.period != expected:
            warnings.append(f"block_{i}_period_mismatch_corrected_server_side")

    overlaps = detect_overlaps(profile.blocks)
    if overlaps:
        errors.extend(overlaps)

    return errors, warnings
