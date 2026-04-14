from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TutorState(Base):
    __tablename__ = "tutor_state"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    availability_json: Mapped[str] = mapped_column(Text, default="{}")
    google_refresh_token: Mapped[Optional[str]] = mapped_column(String(4096), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
