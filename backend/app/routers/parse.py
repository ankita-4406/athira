from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import ParseAvailabilityRequest, ParseAvailabilityResponse
from app.services.llm_parse import parse_natural_language

router = APIRouter(prefix="/api", tags=["parse"])


@router.post("/parse-availability", response_model=ParseAvailabilityResponse)
def parse_availability(body: ParseAvailabilityRequest) -> ParseAvailabilityResponse:
    try:
        return parse_natural_language(
            text=body.text.strip(),
            timezone=body.timezone,
            previous=body.previous,
            last_source="nl",
        )
    except RuntimeError as e:
        code = str(e)
        if code == "gemini_missing":
            raise HTTPException(
                status_code=503,
                detail="Gemini API key is not configured (set GEMINI_API_KEY in .env)",
            ) from e
        if code.startswith("gemini_request_failed"):
            hint = (
                code.split(":", 1)[1]
                if ":" in code
                else "Check GEMINI_API_KEY, try GEMINI_MODEL=gemini-2.0-flash or gemini-1.5-flash, "
                "and ensure the Generative Language API is enabled for your Google Cloud project."
            )
            lc = hint.lower()
            status = (
                429
                if ("429" in lc or "quota" in lc or "resource exhausted" in lc or "rate limit" in lc)
                else 502
            )
            raise HTTPException(status_code=status, detail=f"Gemini request failed: {hint}") from e
        if code in ("gemini_no_text", "gemini_invalid_json"):
            raise HTTPException(status_code=502, detail=f"Gemini error: {code}") from e
        raise HTTPException(status_code=500, detail="parse_failed") from e
