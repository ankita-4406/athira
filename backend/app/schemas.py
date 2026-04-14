from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class DayOfWeek(str, Enum):
    monday = "monday"
    tuesday = "tuesday"
    wednesday = "wednesday"
    thursday = "thursday"
    friday = "friday"
    saturday = "saturday"
    sunday = "sunday"


class Period(str, Enum):
    morning = "morning"
    afternoon = "afternoon"
    evening = "evening"
    night = "night"


class AvailabilityBlock(BaseModel):
    """Single 30-minute-aligned availability window on one calendar day (local TZ)."""

    day: DayOfWeek
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")
    period: Period
    block_id: str = Field(
        description="Stable id for UI/conflicts after normalization",
    )


class BusyInterval(BaseModel):
    start: datetime
    end: datetime


class PendingConflict(BaseModel):
    block_id: str
    busy_start_utc: datetime
    busy_end_utc: datetime


class AvailabilityMetadata(BaseModel):
    last_source: Optional[Literal["nl", "grid", "calendar"]] = None
    updated_at: Optional[datetime] = None


class AvailabilityProfile(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    timezone: str
    blocks: list[AvailabilityBlock] = Field(default_factory=list)
    metadata: Optional[AvailabilityMetadata] = None
    pending_conflicts: list[PendingConflict] = Field(default_factory=list)


class ParseAvailabilityRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    timezone: str = Field(min_length=1, max_length=120)
    previous: Optional[AvailabilityProfile] = None


class ParseAvailabilityResponse(BaseModel):
    availability: AvailabilityProfile
    warnings: list[str] = Field(default_factory=list)


class SaveAvailabilityRequest(BaseModel):
    availability: AvailabilityProfile


class FreeBusyRequest(BaseModel):
    """Uses stored refresh token; optional override timezone for block projection."""

    timezone: Optional[str] = None


class FreeBusyInterval(BaseModel):
    start: datetime
    end: datetime


class FreeBusyResponse(BaseModel):
    busy: list[FreeBusyInterval]
