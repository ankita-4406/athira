# Athira tutor availability (standalone simulation)

A small full-stack demo that simulates an **Athira** tutor dashboard popup plus a full **availability configuration** surface. The backend is **FastAPI + SQLite**; the frontend is **React (Vite + TypeScript)**. Natural-language input is parsed with **Google Gemini** (JSON mode + response schema), then passed through a **deterministic normalization** layer before storage or display. **Google Calendar** integration uses OAuth 2.0 and the **free/busy** API only (no event titles or details).

## LLM provider

**Google Gemini** via the `google-generativeai` SDK. Default preferred id is **`gemini-2.5-flash`** (`GEMINI_MODEL`). If that model returns **404** for your key/API version, the server **automatically tries** other common Flash ids (`gemini-2.5-flash-lite`, `gemini-2.0-flash`, …). Older names like `gemini-1.5-flash` are often **removed from v1beta**—use the [official models list](https://ai.google.dev/gemini-api/docs/models) and set `GEMINI_MODEL` if needed. The API key is the same style as **Google AI Studio** / “Gemini API” keys (not the Calendar OAuth client). Parsing logic lives in [`backend/app/services/llm_parse.py`](backend/app/services/llm_parse.py). Google is deprecating `google.generativeai` in favor of `google.genai`; upgrading later is a small dependency swap.

### Why Gemini (vs ChatGPT / Claude)

This assignment combines **natural-language extraction**, a **strict JSON contract**, and **Google Calendar (free/busy)**. Gemini was chosen for **product fit and evaluator clarity**, not because it “beats” other models on every benchmark.

#### At a glance (read left → right)

| Criterion |                                        Gemini | OpenAI | Claude |
|-----------|                                       :------:|:------:|:------:|
| Strict JSON / schema for `blocks[]`               | Strong | Strong | Strong |
| Same **vendor** as **Google Calendar** | **Best** | Separate | Separate |
| Fast API key for demos                            | Strong | Strong | Strong |
| Free tier (easy start, may throttle)              | 429s possible | Varies | Varies |
| Normalization & overlaps (authoritative)          | Python | Python | Python |

Legend: **Best** = strongest fit *for this repo* because Calendar + NL are both Google surfaces.

---

#### 1 — Structured extraction (NL → JSON)

| Provider | Notes |
|----------|--------|
| **Gemini** | Native **JSON MIME type** + **response schema** for a `blocks[]` object; good fit for extraction-only calls. |
| **OpenAI** | **Structured outputs / JSON schema** are mature and well documented. |
| **Anthropic (Claude)** | **Tool-style** and JSON outputs are mature; schema patterns are common in production. |

#### 2 — Same vendor as Google Calendar (OAuth + free/busy)

| Provider | Notes |
|----------|--------|
| **Gemini** | **One Google story:** AI Studio / Cloud for the **Gemini key** plus the **Calendar API** client and OAuth—less context-switching for reviewers. |
| **OpenAI** | **Calendar stays Google**; you still run **Google OAuth** beside **OpenAI** keys and billing. |
| **Claude** | Same as OpenAI: **no** first-party alignment with Google Calendar. |

#### 3 — Fast path for assessors & demos

| Provider | Notes |
|----------|--------|
| **Gemini** | **AI Studio** key in minutes; **Flash** models tuned for low-latency structured replies. |
| **OpenAI** | Fast onboarding; small models like **`gpt-4o-mini`** are excellent for structured tasks. |
| **Claude** | Fast onboarding; **Haiku**-class models are very responsive. |

#### 4 — Free tier and rate limits

| Provider | Notes |
|----------|--------|
| **Gemini** | Free tier is **easy** but **RPM/RPD** can be tight (**429**); this repo adds **retries + backoff** from the API’s “retry in Xs” hint. |
| **OpenAI** | Free credits / tiers **change over time**; paid usage is usually predictable. |
| **Claude** | Trials / credits **vary**; real deployments assume billing and limits. |

#### 5 — Deterministic scheduling (not LLM-dependent)

| Provider | Notes |
|----------|--------|
| **All three** | **Normalization**, **30-minute grid**, **period labels**, **overlap checks**, and **save validation** are implemented in **Python**—the LLM only proposes `day` / `start` / `end` rows. |

---

**Conclusion:** For *this* repo, **Gemini minimizes integration story fragmentation** (Google NL + Google Calendar), ships **strict JSON extraction** cleanly, and matches the **“Google AI Studio key”** setup many candidates already have. **OpenAI** or **Claude** would also be technically solid for NL-only extraction; the main delta here is **ecosystem alignment with Calendar** and a **single reviewer narrative** (“Google stack end-to-end”). Either alternative would be a reasonable tradeoff if the product owner standardized on a different vendor.

**Honest limits:** NL quality still depends on **prompting + model + quotas**; the comparison above is about **engineering fit**, not a claim that Gemini is universally superior on messy English.

## Quick start

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # add GEMINI_API_KEY; optional Calendar OAuth vars
mkdir -p data
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` to `http://127.0.0.1:8000` (see [`frontend/vite.config.ts`](frontend/vite.config.ts)).

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | For NL parsing | Google Gemini API key from AI Studio / Google AI (never commit) |
| `GEMINI_MODEL` | Optional | Default `gemini-2.5-flash` (fallbacks used automatically on 404) |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth client |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth secret |
| `GOOGLE_REDIRECT_URI` | Optional | Must match Google Cloud console, e.g. `http://127.0.0.1:8000/api/google/oauth/callback` |
| `FRONTEND_URL` | Optional | Post-OAuth browser redirect, default `http://localhost:5173` |
| `DATABASE_URL` | Optional | Default `sqlite:///./data/athira.db` |

## Output JSON schema (`schema_version` **1.0**)

Stored in SQLite (`tutor_state.availability_json`) and returned by `GET /api/availability`.

```jsonc
{
  "schema_version": "1.0",
  "timezone": "IANA string, e.g. Asia/Kolkata (app default)",
  "blocks": [
    {
      "day": "monday | tuesday | wednesday | thursday | friday | saturday | sunday",
      "start": "HH:MM 24h, aligned to :00 or :30",
      "end": "HH:MM 24h exclusive end of last slot, or \"24:00\" for end of local day",
      "period": "morning | afternoon | evening | night",
      "block_id": "stable string: {day}-{start}-{end} after normalization"
    }
  ],
  "metadata": {
    "last_source": "nl | grid | calendar",
    "updated_at": "ISO-8601 UTC timestamp"
  },
  "pending_conflicts": []
}
```

**Rules**

- All tutor-facing times are interpreted in `timezone`.
- **30-minute grid**: `start` and `end` sit on 30-minute boundaries; storage rejects misaligned saves.
- **Period labels** (from block **start** local time): morning `06:00–12:00`, afternoon `12:00–17:00`, evening `17:00–22:00`, night `22:00–24:00` or `00:00–02:00`.
- **Night across midnight** is split into separate `blocks` on adjacent calendar days (each row has `end > start` in local time, except `24:00` end-of-day sentinel).
- **Overlaps** on the same weekday produce validation errors; the UI blocks **Confirm and save** until resolved.

`pending_conflicts` is reserved for future use; conflict badges are derived client-side from free/busy intervals.

## API summary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness |
| GET | `/api/availability` | Current profile |
| POST | `/api/availability` | Validate + save profile |
| POST | `/api/parse-availability` | NL → structured blocks + normalization |
| GET | `/api/google/status` | Whether a refresh token is stored |
| GET | `/api/google/oauth/start` | Begin OAuth (redirect) |
| GET | `/api/google/oauth/callback` | OAuth callback (redirects to `FRONTEND_URL`) |
| POST | `/api/google/freebusy` | Next **5 days** of busy intervals (UTC), free/busy scope only |

## Google Calendar setup

1. Create an OAuth client (Web application) in Google Cloud Console.
2. Add authorized redirect URI: `http://127.0.0.1:8000/api/google/oauth/callback` (or your `GOOGLE_REDIRECT_URI`).
3. Enable **Google Calendar API** for the project.
4. OAuth scope requested: `https://www.googleapis.com/auth/calendar.freebusy` only.

**Security note (demo):** refresh tokens are stored as plaintext in SQLite. For production, encrypt at rest, rotate, and bind tokens to authenticated tutor accounts.

## Design

**Product shape:** A single implicit “demo tutor” row backs the API—no login—so the UI reads as an embedded module. The **dashboard** is a minimal shell with sidebar and a compact **availability popup** showing labeled blocks, optional **calendar conflict** badges, and a single primary action to open the **configuration page**.

**Normalization:** The LLM only proposes coarse `day` / `start` / `end` rows. All snapping, midnight splits, period labels, adjacency merges (touching slots only—overlaps are preserved for validation), and overlap detection run in Python ([`backend/app/services/normalize.py`](backend/app/services/normalize.py)) so behavior is **deterministic** and testable.

**Conflicts:** Busy intervals from Google (UTC) are intersected with each projected weekly block over the **next five days** in the tutor timezone ([`frontend/src/conflicts.ts`](frontend/src/conflicts.ts)). Conflicting blocks are highlighted; **Keep** is implicit and **Remove block** drops that availability row—no auto-resolution.

**Speech:** Natural-language mode uses the **Web Speech API** (no extra keys). Works best in Chromium; Safari/Firefox support varies.

**Motion:** Cursor-following dots and light pointer-based parallax on dashboard/config backgrounds keep the UI modern without breaking the restrained, **light, desktop-first** Athira-like aesthetic ([`frontend/src/components/effects/CursorTrail.tsx`](frontend/src/components/effects/CursorTrail.tsx), [`frontend/src/hooks/usePointerParallax.ts`](frontend/src/hooks/usePointerParallax.ts)).

## Example natural-language inputs (normalized JSON)

The **exact** LLM output varies; below are **representative normalized profiles** after the deterministic layer (same as you would get if the model emitted the shown `blocks` rows). Warnings appear when overlapping rows are supplied.

### 1) “Weekday afternoons (Mon–Tue)”

Input: `Monday and Tuesday afternoons, 12 to 5.`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "12:00", "end": "17:00", "period": "afternoon", "block_id": "monday-12:00-17:00" },
    { "day": "tuesday", "start": "12:00", "end": "17:00", "period": "afternoon", "block_id": "tuesday-12:00-17:00" }
  ]
}
```

### 2) “Friday evening block”

Input: `Open Friday 5pm to 10pm.`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "friday", "start": "17:00", "end": "22:00", "period": "evening", "block_id": "friday-17:00-22:00" }
  ]
}
```

### 3) “Saturday late night through midnight”

Input: `Saturday 11pm until midnight.`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "saturday", "start": "23:00", "end": "24:00", "period": "night", "block_id": "saturday-23:00-24:00" }
  ]
}
```

### 4) “Cross-midnight (split across days)”

Input: `Monday 11pm to 1am.`  
Normalization splits into Monday night + Tuesday early-night window.

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "23:00", "end": "24:00", "period": "night", "block_id": "monday-23:00-24:00" },
    { "day": "tuesday", "start": "00:00", "end": "01:00", "period": "night", "block_id": "tuesday-00:00-01:00" }
  ]
}
```

### 5) “Messy times snap to 30 minutes”

Input: `Wednesday roughly 4:10pm to 5:50pm.`  
Start floors to `:00`, end ceils to half-hour.

```json
{
  "schema_version": "1.0",
  "timezone": "UTC",
  "blocks": [
    { "day": "wednesday", "start": "16:00", "end": "18:00", "period": "afternoon", "block_id": "wednesday-16:00-18:00" }
  ]
}
```

### 6) “Overlapping extractions (warnings + save blocked)”

If the model (or a test fixture) emitted two **overlapping** Friday rows, normalization keeps both separate rows and `detect_overlaps` yields warnings such as `overlap_on_friday:10:00-12:00_vs_11:00-13:00` until the tutor edits the grid or NL.

## Stress-test prompts (messy / ambiguous) — representative normalized JSON

Same disclaimer as above: **Gemini’s raw rows vary**; these JSON blobs are **representative** of what you get **after** [`normalize.py`](backend/app/services/normalize.py) (30-minute floor/ceil, midnight split, `block_id` / `period` rules). For ambiguous phrases, different runs may differ—notes call that out.

### 7) Messy punctuation and mixed formats

Input: `avail: mon/wed/fri ... um 2:30p til 4p?? (zoom ok)`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "14:30", "end": "16:00", "period": "afternoon", "block_id": "monday-14:30-16:00" },
    { "day": "wednesday", "start": "14:30", "end": "16:00", "period": "afternoon", "block_id": "wednesday-14:30-16:00" },
    { "day": "friday", "start": "14:30", "end": "16:00", "period": "afternoon", "block_id": "friday-14:30-16:00" }
  ]
}
```

### 8) Mixed 24h / AM-PM / ALL CAPS

Input: `TUE 0900-1030, thursday 9-11am, SATURDAY 14:00-16:00 thanks`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "tuesday", "start": "09:00", "end": "11:00", "period": "morning", "block_id": "tuesday-09:00-11:00" },
    { "day": "thursday", "start": "09:00", "end": "11:00", "period": "morning", "block_id": "thursday-09:00-11:00" },
    { "day": "saturday", "start": "14:00", "end": "16:00", "period": "afternoon", "block_id": "saturday-14:00-16:00" }
  ]
}
```

*(End time `10:30` is ceiled to the next half-hour boundary → `11:00`.)*

### 9) Pseudo-structure noise

Input: `blocks: [[mon 8-10],[tue 8-10]]`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "08:00", "end": "10:00", "period": "morning", "block_id": "monday-08:00-10:00" },
    { "day": "tuesday", "start": "08:00", "end": "10:00", "period": "morning", "block_id": "tuesday-08:00-10:00" }
  ]
}
```

### 10) Misspelled weekday + informal range

Input: `fridy mornng 8 till noon`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "friday", "start": "08:00", "end": "12:00", "period": "morning", "block_id": "friday-08:00-12:00" }
  ]
}
```

*(Assumes the model maps `fridy` → `friday`.)*

### 11) Fuzzy “ish” times

Input: `wed 4ish to 6ish pm`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "wednesday", "start": "16:00", "end": "18:00", "period": "afternoon", "block_id": "wednesday-16:00-18:00" }
  ]
}
```

### 12) Words instead of digits

Input: `open tuesdays from nine thirty am until eleven`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "tuesday", "start": "09:30", "end": "11:00", "period": "morning", "block_id": "tuesday-09:30-11:00" }
  ]
}
```

### 13) Noon vs afternoon (`12pm`)

Input: `Monday 12pm to 2pm`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "12:00", "end": "14:00", "period": "afternoon", "block_id": "monday-12:00-14:00" }
  ]
}
```

### 14) Midnight start (`12am`)

Input: `Sunday 12am to 2am`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "sunday", "start": "00:00", "end": "02:00", "period": "night", "block_id": "sunday-00:00-02:00" }
  ]
}
```

### 15) Cross-midnight with non-half-hour edges

Input: `Friday 11:45 pm - 12:15 am`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "friday", "start": "23:30", "end": "24:00", "period": "night", "block_id": "friday-23:30-24:00" },
    { "day": "saturday", "start": "00:00", "end": "00:30", "period": "night", "block_id": "saturday-00:00-00:30" }
  ]
}
```

*(Start floors to `23:30`, segment after midnight ceils to `00:30`.)*

### 16) Vague “open next week mornings”

Input: `I'm pretty open next week mornings`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "08:00", "end": "12:00", "period": "morning", "block_id": "monday-08:00-12:00" },
    { "day": "tuesday", "start": "08:00", "end": "12:00", "period": "morning", "block_id": "tuesday-08:00-12:00" },
    { "day": "wednesday", "start": "08:00", "end": "12:00", "period": "morning", "block_id": "wednesday-08:00-12:00" },
    { "day": "thursday", "start": "08:00", "end": "12:00", "period": "morning", "block_id": "thursday-08:00-12:00" },
    { "day": "friday", "start": "08:00", "end": "12:00", "period": "morning", "block_id": "friday-08:00-12:00" }
  ]
}
```

*(Highly **model-dependent**; another run might emit fewer days, different hours, or an empty `blocks` list.)*

### 17) Idiomatic range without clocks

Input: `after lunch weekdays`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "13:00", "end": "17:00", "period": "afternoon", "block_id": "monday-13:00-17:00" },
    { "day": "tuesday", "start": "13:00", "end": "17:00", "period": "afternoon", "block_id": "tuesday-13:00-17:00" },
    { "day": "wednesday", "start": "13:00", "end": "17:00", "period": "afternoon", "block_id": "wednesday-13:00-17:00" },
    { "day": "thursday", "start": "13:00", "end": "17:00", "period": "afternoon", "block_id": "thursday-13:00-17:00" },
    { "day": "friday", "start": "13:00", "end": "17:00", "period": "afternoon", "block_id": "friday-13:00-17:00" }
  ]
}
```

### 18) Contradiction on the same day (model usually picks the later correction)

Input: `Monday 9-5 but actually only 10-2`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "10:00", "end": "14:00", "period": "morning", "block_id": "monday-10:00-14:00" }
  ]
}
```

### 19) Directly conflicting instructions

Input: `No Fridays. Also Fridays 3-4pm.`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "friday", "start": "15:00", "end": "16:00", "period": "afternoon", "block_id": "friday-15:00-16:00" }
  ]
}
```

*(Or `blocks: []` if the model honors “No Fridays” only—expect variance.)*

### 20) Weekdays with an exception window

Input: `weekdays 9-5 except Wednesday meetings 12-1`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "09:00", "end": "17:00", "period": "morning", "block_id": "monday-09:00-17:00" },
    { "day": "tuesday", "start": "09:00", "end": "17:00", "period": "morning", "block_id": "tuesday-09:00-17:00" },
    { "day": "wednesday", "start": "09:00", "end": "12:00", "period": "morning", "block_id": "wednesday-09:00-12:00" },
    { "day": "wednesday", "start": "13:00", "end": "17:00", "period": "afternoon", "block_id": "wednesday-13:00-17:00" },
    { "day": "thursday", "start": "09:00", "end": "17:00", "period": "morning", "block_id": "thursday-09:00-17:00" },
    { "day": "friday", "start": "09:00", "end": "17:00", "period": "morning", "block_id": "friday-09:00-17:00" }
  ]
}
```

*(Wednesday uses two blocks; spans crossing `12:00–13:00` “meeting” vary by model.)*

### 21) Explicit two-day overnight wording

Input: `Thursday 10pm to Friday 2am`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "thursday", "start": "22:00", "end": "24:00", "period": "night", "block_id": "thursday-22:00-24:00" },
    { "day": "friday", "start": "00:00", "end": "02:00", "period": "night", "block_id": "friday-00:00-02:00" }
  ]
}
```

### 22) Colloquial “Saturday night until 2”

Input: `Saturday night until 2`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "saturday", "start": "22:00", "end": "24:00", "period": "night", "block_id": "saturday-22:00-24:00" },
    { "day": "sunday", "start": "00:00", "end": "02:00", "period": "night", "block_id": "sunday-00:00-02:00" }
  ]
}
```

*(Interprets “2” as **2:00 a.m.**; other parses are possible.)*

### 23) One-off phrasing mapped to a recurring weekday template

Input: `this Thursday only 4-6`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "thursday", "start": "16:00", "end": "18:00", "period": "afternoon", "block_id": "thursday-16:00-18:00" }
  ]
}
```

*(The schema is **weekly recurring**; there is no true “one-off only” field—reviewers should treat this as a template.)*

### 24) Vague “next week afternoons”

Input: `next week I'm free afternoons`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "12:00", "end": "17:00", "period": "afternoon", "block_id": "monday-12:00-17:00" },
    { "day": "tuesday", "start": "12:00", "end": "17:00", "period": "afternoon", "block_id": "tuesday-12:00-17:00" },
    { "day": "wednesday", "start": "12:00", "end": "17:00", "period": "afternoon", "block_id": "wednesday-12:00-17:00" },
    { "day": "thursday", "start": "12:00", "end": "17:00", "period": "afternoon", "block_id": "thursday-12:00-17:00" },
    { "day": "friday", "start": "12:00", "end": "17:00", "period": "afternoon", "block_id": "friday-12:00-17:00" }
  ]
}
```

### 25) Refinement: replace schedule (uses `previous` in API)

**First parse** — Input: `Mon 9-12, Wed 9-12`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "09:00", "end": "12:00", "period": "morning", "block_id": "monday-09:00-12:00" },
    { "day": "wednesday", "start": "09:00", "end": "12:00", "period": "morning", "block_id": "wednesday-09:00-12:00" }
  ]
}
```

**Second parse (same session, with previous JSON attached)** — Input: `scratch that, only mondays 10-11 and drop wednesday entirely`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "10:00", "end": "11:00", "period": "morning", "block_id": "monday-10:00-11:00" }
  ]
}
```

### 26) Long, chatty, buried constraints

Input: `Hey so for tutoring I can usually do Tue/Thu after my class ends around 3:15 until like 5:45 maybe 6 if traffic is ok, and sometimes Saturday mornings 9:30-12 but not every week — ignore Saturday for now — oh and Monday mornings 8-9:30 before work.`

```json
{
  "schema_version": "1.0",
  "timezone": "America/New_York",
  "blocks": [
    { "day": "monday", "start": "08:00", "end": "09:30", "period": "morning", "block_id": "monday-08:00-09:30" },
    { "day": "tuesday", "start": "15:00", "end": "18:00", "period": "afternoon", "block_id": "tuesday-15:00-18:00" },
    { "day": "thursday", "start": "15:00", "end": "18:00", "period": "afternoon", "block_id": "thursday-15:00-18:00" }
  ]
}
```

*(Rough times snap: `3:15` → `15:00`, `5:45`/`6` → end `18:00`; Saturday omitted per “ignore Saturday”.)*

## Tradeoffs

- **Gemini free tier** enforces low RPM/RPD limits (see [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). The backend **retries** `generate_content` on **429 / quota** responses, sleeping for the **“retry in Xs”** hint when Google sends it, then falls back to JSON-without-schema if needed. Burst “Parse” clicks can still hit quota—wait a minute or enable billing for higher limits.
- **Single tutor / no auth** keeps the assessment focused on parsing, normalization, and UX—not account systems.
- **OAuth state** for Google lives in an in-memory dict (single-process demo); use Redis + short TTL in production.
- **Web Speech API** avoids extra vendor keys but is browser-dependent.
- **NL + existing saved blocks**: the client sends `previous` whenever `blocks.length > 0`, so the model sees the current schedule; the system prompt instructs full replacement when the user clearly asks to start over.

## Tests

```bash
cd backend && source .venv/bin/activate && pytest
```

Normalization golden behaviors live in [`backend/tests/test_normalize.py`](backend/tests/test_normalize.py).

## Repository layout

- [`backend/app`](backend/app) — FastAPI app, SQLite models, routers, normalization, LLM adapter
- [`frontend/src`](frontend/src) — React UI, conflict math, grid editor, motion layers
