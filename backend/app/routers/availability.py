from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.repo import load_profile, save_profile_json
from app.schemas import AvailabilityMetadata, AvailabilityProfile, SaveAvailabilityRequest
from app.services.validation import reconcile_blocks, validate_profile

router = APIRouter(prefix="/api", tags=["availability"])


@router.get("/availability", response_model=AvailabilityProfile)
def read_availability(db: Session = Depends(get_db)) -> AvailabilityProfile:
    return load_profile(db)


@router.post("/availability", response_model=AvailabilityProfile)
def write_availability(body: SaveAvailabilityRequest, db: Session = Depends(get_db)) -> AvailabilityProfile:
    profile = body.availability
    profile.blocks = reconcile_blocks(profile.blocks)
    errors, _warnings = validate_profile(profile)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    meta = profile.metadata or AvailabilityMetadata()
    meta.updated_at = datetime.now(timezone.utc)
    profile.metadata = meta

    save_profile_json(db, profile)
    return profile
