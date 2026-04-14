from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import TutorState
from app.schemas import AvailabilityProfile


def _default_profile() -> AvailabilityProfile:
    return AvailabilityProfile(
        timezone="Asia/Kolkata",
        blocks=[],
        metadata=None,
        pending_conflicts=[],
    )


def get_tutor_row(db: Session) -> TutorState:
    row = db.scalars(select(TutorState).limit(1)).first()
    if row is None:
        row = TutorState(
            availability_json=_default_profile().model_dump_json(),
            google_refresh_token=None,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def load_profile(db: Session) -> AvailabilityProfile:
    row = get_tutor_row(db)
    try:
        return AvailabilityProfile.model_validate_json(row.availability_json)
    except Exception:
        return _default_profile()


def save_profile_json(db: Session, profile: AvailabilityProfile) -> None:
    row = get_tutor_row(db)
    row.availability_json = profile.model_dump_json()
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()


def save_google_refresh_token(db: Session, token: Optional[str]) -> None:
    row = get_tutor_row(db)
    row.google_refresh_token = token
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()


def get_google_refresh_token(db: Session) -> Optional[str]:
    row = get_tutor_row(db)
    return row.google_refresh_token
