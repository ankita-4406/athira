"""Google Gemini JSON extraction for natural-language availability."""

from __future__ import annotations

import json
import logging
import re
import time
import datetime as dt
from typing import Any

import google.generativeai as genai

from app.config import settings
from app.schemas import AvailabilityMetadata, AvailabilityProfile, ParseAvailabilityResponse
from app.services.normalize import normalize_from_llm_dict

logger = logging.getLogger(__name__)

# JSON Schema subset for Gemini controlled generation (see Gemini API docs).
_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "blocks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "day": {
                        "type": "string",
                        "enum": [
                            "monday",
                            "tuesday",
                            "wednesday",
                            "thursday",
                            "friday",
                            "saturday",
                            "sunday",
                        ],
                    },
                    "start": {"type": "string"},
                    "end": {"type": "string"},
                },
                "required": ["day", "start", "end"],
            },
        }
    },
    "required": ["blocks"],
}

# Older IDs like gemini-1.5-flash often 404 on v1beta; try current Flash variants in order.
_MODEL_FALLBACKS: tuple[str, ...] = (
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
)


class _TryNextModel(Exception):
    """Raised when this model id should be skipped (e.g. 404)."""


def _ordered_model_names() -> list[str]:
    primary = (settings.gemini_model or "").strip()
    out: list[str] = []
    seen: set[str] = set()
    for m in ([primary, *_MODEL_FALLBACKS] if primary else list(_MODEL_FALLBACKS)):
        if not m or m in seen:
            continue
        seen.add(m)
        out.append(m)
    return out or ["gemini-2.5-flash"]


def _is_model_not_found_error(exc: BaseException) -> bool:
    s = str(exc).lower()
    return (
        "404" in s
        or "not found" in s
        or "is not supported for generatecontent" in s
        or "not available for" in s
    )


def _is_quota_or_rate_limit_error(exc: BaseException) -> bool:
    s = str(exc).lower()
    return (
        "429" in s
        or "quota" in s
        or "resource exhausted" in s
        or "rate limit" in s
        or "too many requests" in s
    )


def _quota_retry_delay_seconds(exc: BaseException) -> float:
    """Honor Gemini's 'Please retry in Xs' when present; otherwise default pause."""
    m = re.search(r"retry in ([\d.]+)\s*s", str(exc), re.I)
    if m:
        return min(float(m.group(1)) + 1.0, 120.0)
    return 25.0


def _generate_with_quota_retries(
    model: genai.GenerativeModel,
    user_content: str,
    *,
    use_response_schema: bool,
    max_quota_attempts: int = 6,
) -> Any:
    """Retry generate_content on free-tier / RPM 429s with backoff."""
    last: BaseException | None = None
    for attempt in range(max_quota_attempts):
        try:
            return _generate(model, user_content, use_response_schema=use_response_schema)
        except Exception as e:
            last = e
            if _is_quota_or_rate_limit_error(e) and attempt < max_quota_attempts - 1:
                wait = _quota_retry_delay_seconds(e)
                logger.warning(
                    "Gemini rate limit or quota (attempt %s/%s), sleeping %.1fs before retry",
                    attempt + 1,
                    max_quota_attempts,
                    wait,
                )
                time.sleep(wait)
                continue
            raise
    assert last is not None
    raise last


def _system_prompt() -> str:
    return """You extract recurring weekly tutor availability from messy English.
Rules:
- Output only a single JSON object matching the schema (a "blocks" array). No markdown fences, no commentary.
- Each block is one contiguous range on a single calendar day in the tutor's local timezone.
- Use 24-hour HH:MM strings. Prefer realistic quarter-hour times; downstream code quantizes to 30 minutes.
- day must be lowercase English weekday.
- If the user says 'weekdays' use monday,tuesday,wednesday,thursday,friday as separate blocks when ranges differ; otherwise one block per day if identical.
- If text is ambiguous, make best-effort conservative blocks and avoid inventing all-day availability.
- If previous availability JSON is attached: treat the message as an edit unless the user clearly
  wants a full replacement (e.g. "ignore previous", "start over"), in which case output a fresh
  blocks array and ignore prior rows."""


def _safe_api_error_message(exc: BaseException, max_len: int = 500) -> str:
    """Single-line, truncated message for HTTP responses (no secrets)."""
    msg = str(exc).strip().replace("\n", " ")
    if len(msg) > max_len:
        msg = msg[: max_len - 3] + "..."
    return msg or repr(exc)


def _generate(
    model: genai.GenerativeModel,
    user_content: str,
    *,
    use_response_schema: bool,
) -> Any:
    if use_response_schema:
        gen_cfg = genai.GenerationConfig(
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=_RESPONSE_SCHEMA,
        )
    else:
        gen_cfg = genai.GenerationConfig(
            temperature=0.2,
            response_mime_type="application/json",
        )
    return model.generate_content(user_content, generation_config=gen_cfg)


def _generate_with_model(model_name: str, user_content: str) -> Any:
    """Try schema JSON then plain JSON; skip model on 404; retry on 429/quota."""
    model = genai.GenerativeModel(model_name, system_instruction=_system_prompt())
    for use_schema in (True, False):
        try:
            return _generate_with_quota_retries(
                model, user_content, use_response_schema=use_schema
            )
        except Exception as e:
            logger.warning(
                "Gemini generate_content failed model=%s schema=%s: %s",
                model_name,
                use_schema,
                _safe_api_error_message(e, 280),
            )
            if _is_model_not_found_error(e):
                raise _TryNextModel() from e
            if use_schema:
                continue
            raise RuntimeError(f"gemini_request_failed:{_safe_api_error_message(e)}") from e
    raise RuntimeError("gemini_request_failed:exhausted_schema_retries")


def _strip_code_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def parse_natural_language(
    *,
    text: str,
    timezone: str,
    previous: AvailabilityProfile | None = None,
    last_source: str = "nl",
) -> ParseAvailabilityResponse:
    if not settings.gemini_api_key:
        raise RuntimeError("gemini_missing")

    genai.configure(api_key=settings.gemini_api_key)

    user_parts: list[str] = [f"Timezone (IANA): {timezone}", f"Availability text:\n{text}"]
    if previous:
        user_parts.append(
            "Previous structured availability (apply edits relative to this):\n"
            + previous.model_dump_json()
        )
    user_content = "\n\n".join(user_parts)

    response = None
    last_not_found: BaseException | None = None
    for model_name in _ordered_model_names():
        try:
            response = _generate_with_model(model_name, user_content)
            break
        except _TryNextModel as e:
            last_not_found = e.__cause__ or e
            logger.info("Skipping Gemini model %s (not available for this API key)", model_name)
            continue

    if response is None:
        hint = (
            _safe_api_error_message(last_not_found)
            if last_not_found
            else "No model succeeded. Set GEMINI_MODEL to an id from https://ai.google.dev/gemini-api/docs/models"
        )
        raise RuntimeError(f"gemini_request_failed:{hint}") from last_not_found

    raw_text = ""
    try:
        raw_text = (response.text or "").strip()
    except ValueError:
        raise RuntimeError("gemini_no_text") from None

    if not raw_text:
        raise RuntimeError("gemini_no_text")

    try:
        data = json.loads(_strip_code_fence(raw_text))
    except json.JSONDecodeError as e:
        raise RuntimeError("gemini_invalid_json") from e

    blocks_raw = data.get("blocks") or []
    normalized, norm_warnings = normalize_from_llm_dict(timezone=timezone, blocks=blocks_raw)

    profile = AvailabilityProfile(
        timezone=timezone,
        blocks=normalized,
        metadata=AvailabilityMetadata(
            last_source=last_source,  # type: ignore[arg-type]
            updated_at=dt.datetime.now(dt.timezone.utc),
        ),
        pending_conflicts=[],
    )
    return ParseAvailabilityResponse(
        availability=profile,
        warnings=norm_warnings,
    )
