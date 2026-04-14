from app.schemas import DayOfWeek
from app.services.normalize import (
    detect_overlaps,
    normalize_from_llm_dict,
    period_for_start_minutes,
    quantize_end_minutes,
    quantize_start_minutes,
    raw_blocks_to_merged_blocks,
    time_to_minutes,
)
from app.services.normalize import RawBlock


def test_quantize():
    assert quantize_start_minutes(16) == 0
    assert quantize_start_minutes(31) == 30
    assert quantize_end_minutes(31) == 60


def test_period_labels():
    assert period_for_start_minutes(6 * 60).value == "morning"
    assert period_for_start_minutes(12 * 60).value == "afternoon"
    assert period_for_start_minutes(17 * 60).value == "evening"
    assert period_for_start_minutes(22 * 60).value == "night"
    assert period_for_start_minutes(0).value == "night"


def test_merge_weekday_block():
    blocks, _ = normalize_from_llm_dict(
        timezone="UTC",
        blocks=[
            {"day": "wednesday", "start": "16:10", "end": "17:50"},
        ],
    )
    assert len(blocks) == 1
    b = blocks[0]
    assert b.day == DayOfWeek.wednesday
    assert b.start == "16:00"
    assert b.end == "18:00"


def test_midnight_split():
    merged = raw_blocks_to_merged_blocks(
        [RawBlock(day=DayOfWeek.monday, start="23:00", end="01:00")],
        tz="America/New_York",
    )
    days = {b.day for b in merged}
    assert DayOfWeek.monday in days
    assert DayOfWeek.tuesday in days


def test_overlap_warning():
    blocks, warns = normalize_from_llm_dict(
        timezone="UTC",
        blocks=[
            {"day": "friday", "start": "10:00", "end": "12:00"},
            {"day": "friday", "start": "11:00", "end": "13:00"},
        ],
    )
    assert blocks
    o = detect_overlaps(blocks)
    assert o or warns


def test_time_to_minutes_end():
    assert time_to_minutes("24:00", end=True) == 1440
