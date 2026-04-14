"""
Deterministic normalization: 30-minute grid, period labels, midnight splits, overlap detection.

Period labels use the block's **start** (local time):
- morning:   [06:00, 12:00)
- afternoon: [12:00, 17:00)
- evening:   [17:00, 22:00)
- night:     [22:00, 24:00) ∪ [00:00, 02:00)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.schemas import AvailabilityBlock, DayOfWeek, Period

DAY_ORDER: list[DayOfWeek] = list(DayOfWeek)

DAY_TO_OFFSET: dict[DayOfWeek, int] = {d: i for i, d in enumerate(DAY_ORDER)}

# Fixed anchor Monday for mapping weekday names → concrete calendar dates during expansion.
ANCHOR_MONDAY = date(2026, 1, 5)


def _parse_hhmm(s: str) -> tuple[int, int]:
    parts = s.strip().split(":")
    if len(parts) != 2:
        raise ValueError("invalid_time")
    h, m = int(parts[0]), int(parts[1])
    if not (0 <= h <= 24 and 0 <= m <= 59):
        raise ValueError("invalid_time")
    if h == 24 and m != 0:
        raise ValueError("invalid_time")
    return h, m


def time_to_minutes(t: str, *, end: bool = False) -> int:
    """Minutes since local midnight. For end=True, allow 24:00 → 1440 (exclusive end semantics)."""
    h, m = _parse_hhmm(t)
    mins = h * 60 + m
    if end and mins == 1440:
        return 1440
    if h == 24:
        raise ValueError("invalid_time")
    return mins


def minutes_to_time(mins: int) -> str:
    if mins == 1440:
        return "24:00"
    if not (0 <= mins < 1440):
        raise ValueError("minutes_out_of_range")
    h, m = divmod(mins, 60)
    return f"{h:02d}:{m:02d}"


def quantize_start_minutes(m: int) -> int:
    return (max(0, min(m, 1440)) // 30) * 30


def quantize_end_minutes(m: int) -> int:
    """Ceil to next 30-minute boundary for exclusive end interpretation."""
    m = max(0, min(m, 1440))
    q = ((m + 29) // 30) * 30
    return min(1440, q)


def period_for_start_minutes(start_m: int) -> Period:
    if 360 <= start_m < 720:
        return Period.morning
    if 720 <= start_m < 1020:
        return Period.afternoon
    if 1020 <= start_m < 1320:
        return Period.evening
    # night: 22:00–24:00 or 00:00–02:00
    if start_m >= 1320 or start_m < 120:
        return Period.night
    # 02:00–06:00 is outside Athira buckets; map to morning edge case (spec focuses on named buckets)
    return Period.morning


def _floor_dt_30(dt: datetime) -> datetime:
    epoch = datetime(1970, 1, 1, tzinfo=dt.tzinfo)
    secs = int((dt - epoch).total_seconds())
    floored = (secs // (30 * 60)) * (30 * 60)
    return epoch + timedelta(seconds=floored)


def _ceil_dt_30(dt: datetime) -> datetime:
    epoch = datetime(1970, 1, 1, tzinfo=dt.tzinfo)
    secs = int((dt - epoch).total_seconds())
    ceiled = ((secs + 30 * 60 - 1) // (30 * 60)) * (30 * 60)
    return epoch + timedelta(seconds=ceiled)


@dataclass(frozen=True)
class RawBlock:
    day: DayOfWeek
    start: str
    end: str


def _date_for_day(day: DayOfWeek) -> date:
    return ANCHOR_MONDAY + timedelta(days=DAY_TO_OFFSET[day])


def expand_raw_block_to_slot_boundaries(raw: RawBlock, tz: str) -> tuple[datetime, datetime]:
    """Interpret start/end in tutor TZ; if end is not after start on same calendar day, end rolls to next day."""
    zi = ZoneInfo(tz)
    d = _date_for_day(raw.day)
    sh, sm = _parse_hhmm(raw.start)
    start_dt = datetime(d.year, d.month, d.day, sh, sm, tzinfo=zi)
    if raw.end.strip() == "24:00":
        end_dt = datetime(d.year, d.month, d.day, 0, 0, tzinfo=zi) + timedelta(days=1)
    else:
        eh, em = _parse_hhmm(raw.end)
        end_dt = datetime(d.year, d.month, d.day, eh, em, tzinfo=zi)
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)
    return start_dt, end_dt


def raw_blocks_to_merged_blocks(raws: list[RawBlock], tz: str) -> list[AvailabilityBlock]:
    """Quantize to 30m grid, split across local midnights, merge adjacent on same day.

    When multiple RawBlock values are supplied, they are **union-merged** before slotting.
    For overlap detection across conflicting LLM rows, call this once per RawBlock instead.
    """
    if not raws:
        return []

    zi = ZoneInfo(tz)
    intervals: list[tuple[datetime, datetime]] = []
    for raw in raws:
        s, e = expand_raw_block_to_slot_boundaries(raw, tz)
        s = _floor_dt_30(s)
        e = _ceil_dt_30(e)
        if e <= s:
            continue
        intervals.append((s, e))

    intervals.sort(key=lambda x: x[0])
    merged_iv: list[tuple[datetime, datetime]] = []
    for s, e in intervals:
        if not merged_iv:
            merged_iv.append((s, e))
            continue
        ps, pe = merged_iv[-1]
        if s <= pe:
            merged_iv[-1] = (ps, max(pe, e))
        else:
            merged_iv.append((s, e))

    # slice into 30m slots then regroup per local day
    slot_starts: list[datetime] = []
    for s, e in merged_iv:
        t = s
        while t < e:
            slot_starts.append(t)
            t += timedelta(minutes=30)

    # group consecutive slot starts into ranges; split on day boundary
    blocks: list[AvailabilityBlock] = []
    if not slot_starts:
        return blocks

    def local_day_key(dt: datetime) -> date:
        return dt.astimezone(zi).date()

    run_start = slot_starts[0]
    prev = slot_starts[0]
    for cur in slot_starts[1:]:
        expected_next = prev + timedelta(minutes=30)
        if cur != expected_next or local_day_key(cur) != local_day_key(prev):
            blocks.append(_make_block_from_run(run_start, prev + timedelta(minutes=30), zi))
            run_start = cur
        prev = cur
    blocks.append(_make_block_from_run(run_start, prev + timedelta(minutes=30), zi))

    return _dedupe_and_sort(blocks)


def _make_block_from_run(start: datetime, end_exclusive: datetime, zi: ZoneInfo) -> AvailabilityBlock:
    ls = start.astimezone(zi)
    le = end_exclusive.astimezone(zi)
    day_name = ls.strftime("%A").lower()
    day = DayOfWeek(day_name)
    start_m = ls.hour * 60 + ls.minute
    if le.date() > ls.date() and le.hour == 0 and le.minute == 0:
        end_m = 1440
    elif le.date() == ls.date():
        end_m = le.hour * 60 + le.minute
    else:
        raise RuntimeError("slot_run_spans_multiple_local_days")
    st = minutes_to_time(start_m)
    en = minutes_to_time(end_m) if end_m != 1440 else "24:00"
    period = period_for_start_minutes(start_m)
    bid = f"{day.value}-{st}-{en}"
    return AvailabilityBlock(day=day, start=st, end=en, period=period, block_id=bid)


def _dedupe_and_sort(blocks: list[AvailabilityBlock]) -> list[AvailabilityBlock]:
    seen: set[tuple[str, str, str]] = set()
    out: list[AvailabilityBlock] = []
    for b in sorted(blocks, key=lambda x: (DAY_TO_OFFSET[x.day], time_to_minutes(x.start))):
        key = (b.day.value, b.start, b.end)
        if key in seen:
            continue
        seen.add(key)
        out.append(b)
    return _merge_adjacent_same_day(out)


def _merge_adjacent_same_day(blocks: list[AvailabilityBlock]) -> list[AvailabilityBlock]:
    if not blocks:
        return []
    by_day: dict[DayOfWeek, list[AvailabilityBlock]] = {d: [] for d in DAY_ORDER}
    for b in blocks:
        by_day[b.day].append(b)
    merged: list[AvailabilityBlock] = []
    for d in DAY_ORDER:
        day_blocks = sorted(by_day[d], key=lambda x: time_to_minutes(x.start))
        if not day_blocks:
            continue
        cur = day_blocks[0]
        for nxt in day_blocks[1:]:
            cur_end = time_to_minutes(cur.end, end=(cur.end == "24:00"))
            nxt_start = time_to_minutes(nxt.start)
            nxt_end = time_to_minutes(nxt.end, end=(nxt.end == "24:00"))
            if nxt_start < cur_end:
                # Overlap: keep separate so callers can surface validation errors.
                merged.append(cur)
                cur = nxt
            elif nxt_start == cur_end:
                new_end_m = max(cur_end, nxt_end)
                new_end = minutes_to_time(new_end_m) if new_end_m != 1440 else "24:00"
                cur = AvailabilityBlock(
                    day=cur.day,
                    start=cur.start,
                    end=new_end,
                    period=period_for_start_minutes(time_to_minutes(cur.start)),
                    block_id=f"{cur.day.value}-{cur.start}-{new_end}",
                )
            else:
                merged.append(cur)
                cur = nxt
        merged.append(cur)
    return merged


def detect_overlaps(blocks: list[AvailabilityBlock]) -> list[str]:
    warnings: list[str] = []
    by_day: dict[DayOfWeek, list[AvailabilityBlock]] = {d: [] for d in DAY_ORDER}
    for b in blocks:
        by_day[b.day].append(b)
    for d, bs in by_day.items():
        bs = sorted(bs, key=lambda x: time_to_minutes(x.start))
        for i in range(len(bs) - 1):
            a, b = bs[i], bs[i + 1]
            a_end = time_to_minutes(a.end, end=(a.end == "24:00"))
            b_start = time_to_minutes(b.start)
            if b_start < a_end:
                warnings.append(f"overlap_on_{d.value}:{a.start}-{a.end}_vs_{b.start}-{b.end}")
    return warnings


def normalize_from_llm_dict(
    *,
    timezone: str,
    blocks: list[dict],
) -> tuple[list[AvailabilityBlock], list[str]]:
    """
    Accept dicts with keys day/start/end; day is lowercase english weekday.
    Returns (normalized_blocks, warnings).

    Each LLM row is expanded independently so true overlaps (ambiguous / conflicting
    extractions) are preserved and surfaced via ``detect_overlaps``.
    """
    merged: list[AvailabilityBlock] = []
    for row in blocks:
        try:
            day = DayOfWeek(str(row["day"]).lower())
            start = str(row["start"])
            end = str(row["end"])
            raw = RawBlock(day=day, start=start, end=end)
        except Exception:
            continue
        merged.extend(raw_blocks_to_merged_blocks([raw], timezone))
    merged = _dedupe_and_sort(merged)
    warnings = detect_overlaps(merged)
    return merged, warnings
