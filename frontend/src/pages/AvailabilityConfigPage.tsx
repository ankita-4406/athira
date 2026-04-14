import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { WeeklyGrid } from '../components/WeeklyGrid'
import { CursorTrail } from '../components/effects/CursorTrail'
import { usePointerParallax } from '../hooks/usePointerParallax'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import {
  getAvailability,
  googleFreeBusy,
  googleOAuthStartUrl,
  googleStatus,
  parseAvailability,
  saveAvailability,
} from '../api'
import { conflictingBlockIds, conflictingSlotKeys } from '../conflicts'
import { blocksFromSlots, slotsFromBlocks } from '../gridUtils'
import { hasOverlappingBlocks } from '../overlap'
import { defaultTimezone, listTimezones } from '../timezones'
import type { AvailabilityProfile, BusyInterval } from '../types'

type Mode = 'nl' | 'grid' | 'calendar'

function emptyProfile(tz: string): AvailabilityProfile {
  return {
    schema_version: '1.0',
    timezone: tz,
    blocks: [],
    metadata: {},
    pending_conflicts: [],
  }
}

export function AvailabilityConfigPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { ref, shift } = usePointerParallax(8)
  const speech = useSpeechRecognition()

  const [mode, setMode] = useState<Mode>('nl')
  const [tz, setTz] = useState(defaultTimezone)
  const [draft, setDraft] = useState<AvailabilityProfile>(() => emptyProfile(defaultTimezone()))
  const [nlText, setNlText] = useState('')
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<BusyInterval[]>([])
  const [keptConflictAck, setKeptConflictAck] = useState<Set<string>>(() => new Set())
  const [googleConnected, setGoogleConnected] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const timezones = useMemo(() => listTimezones(), [])

  const refreshBusy = useCallback(async () => {
    if (!googleConnected) return
    try {
      const fb = await googleFreeBusy()
      setBusy(fb.busy)
    } catch {
      setBusy([])
    }
  }, [googleConnected])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadErr(null)
      try {
        const p = await getAvailability()
        if (cancelled) return
        setDraft(p)
        setTz(p.timezone || defaultTimezone())
        setSelectedSlots(slotsFromBlocks(p.blocks))
        const st = await googleStatus()
        if (cancelled) return
        setGoogleConnected(st.connected)
        if (st.connected) {
          try {
            const fb = await googleFreeBusy()
            if (!cancelled) setBusy(fb.busy)
          } catch {
            if (!cancelled) setBusy([])
          }
        }
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'Load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const g = searchParams.get('google')
    if (g === 'connected') {
      void (async () => {
        const st = await googleStatus()
        setGoogleConnected(st.connected)
        if (st.connected) await refreshBusy()
      })()
    }
  }, [searchParams, refreshBusy])

  useEffect(() => {
    setDraft((d) => ({ ...d, timezone: tz }))
  }, [tz])

  const lastMode = useRef(mode)
  useEffect(() => {
    if (mode === 'grid' && lastMode.current !== 'grid') {
      setSelectedSlots(slotsFromBlocks(draft.blocks))
    }
    lastMode.current = mode
  }, [mode, draft.blocks])

  const gridBlocks = useMemo(() => blocksFromSlots(selectedSlots), [selectedSlots])

  const displayBlocks = mode === 'grid' ? gridBlocks : draft.blocks

  const conflictIds = useMemo(
    () =>
      busy.length && displayBlocks.length
        ? conflictingBlockIds(displayBlocks, draft.timezone, busy)
        : new Set<string>(),
    [busy, displayBlocks, draft.timezone],
  )

  const conflictSlotKeys = useMemo(
    () =>
      busy.length && displayBlocks.length
        ? conflictingSlotKeys(displayBlocks, draft.timezone, busy)
        : new Set<string>(),
    [busy, displayBlocks, draft.timezone],
  )

  useEffect(() => {
    setKeptConflictAck((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (conflictIds.has(id)) next.add(id)
      }
      return next
    })
  }, [conflictIds])

  const overlaps = hasOverlappingBlocks(mode === 'grid' ? gridBlocks : draft.blocks)

  const onToggleSlot = (key: string) => {
    setSelectedSlots((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
    setMode('grid')
  }

  useEffect(() => {
    if (mode !== 'grid') return
    setDraft((d) => ({
      ...d,
      blocks: blocksFromSlots(selectedSlots),
      metadata: { ...d.metadata, last_source: 'grid' },
    }))
  }, [selectedSlots, mode])

  const runParse = async () => {
    setParseErr(null)
    setParseWarnings([])
    try {
      const res = await parseAvailability({
        text: nlText,
        timezone: tz,
        previous: draft.blocks.length ? { ...draft, timezone: tz } : null,
      })
      setDraft(res.availability)
      setParseWarnings(res.warnings)
      setSelectedSlots(slotsFromBlocks(res.availability.blocks))
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : 'Parse failed')
    }
  }

  const removeBlock = (blockId: string) => {
    setKeptConflictAck((prev) => {
      const next = new Set(prev)
      next.delete(blockId)
      return next
    })
    setDraft((d) => ({
      ...d,
      blocks: d.blocks.filter((b) => b.block_id !== blockId),
    }))
  }

  const connectGoogle = () => {
    window.location.href = googleOAuthStartUrl()
  }

  const onSave = async () => {
    const blocks = mode === 'grid' ? gridBlocks : draft.blocks
    const body: AvailabilityProfile = {
      ...draft,
      timezone: tz,
      blocks,
      metadata: {
        ...draft.metadata,
        last_source: mode === 'nl' ? 'nl' : mode === 'grid' ? 'grid' : 'calendar',
        updated_at: new Date().toISOString(),
      },
      pending_conflicts: [],
    }
    if (hasOverlappingBlocks(body.blocks)) {
      setParseErr('Overlapping blocks must be resolved before saving.')
      return
    }
    setSaving(true)
    setParseErr(null)
    try {
      await saveAvailability(body)
      navigate('/')
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dashboard-root" ref={ref}>
      <CursorTrail count={10} />
      <div
        className="parallax-bg"
        style={{
          transform: `translate3d(${shift.x * 0.35}px, ${shift.y * 0.3}px, 0)`,
        }}
      >
        <div className="parallax-plane p1" style={{ transform: `translate3d(${shift.x}px, ${shift.y}px, 0)` }} />
        <div className="parallax-plane p2" style={{ transform: `translate3d(${shift.x * -0.7}px, ${shift.y * -0.8}px, 0)` }} />
      </div>

      <div className="config-page">
        <div className="config-head">
          <div>
            <h1>Availability</h1>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              Configure recurring weekly windows. All times use the timezone below.
            </p>
          </div>
          <Link to="/" className="btn">
            Back to dashboard
          </Link>
        </div>

        <div className="panel" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="muted">
            Timezone{' '}
            <select className="tz-select" value={tz} onChange={(e) => setTz(e.target.value)}>
              {timezones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          {loading ? <span className="muted">Loading…</span> : null}
          {loadErr ? <span className="muted">{loadErr}</span> : null}
        </div>

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`tab ${mode === 'nl' ? 'active' : ''}`}
            onClick={() => setMode('nl')}
          >
            Natural language
          </button>
          <button
            type="button"
            role="tab"
            className={`tab ${mode === 'grid' ? 'active' : ''}`}
            onClick={() => setMode('grid')}
          >
            Weekly grid
          </button>
          <button
            type="button"
            role="tab"
            className={`tab ${mode === 'calendar' ? 'active' : ''}`}
            onClick={() => setMode('calendar')}
          >
            Calendar sync
          </button>
        </div>

        {mode === 'nl' ? (
          <div className="panel">
            <p className="muted" style={{ marginTop: 0 }}>
              Describe when you are available. Parse applies deterministic normalization (30-minute
              blocks, period labels). Follow up in the same box to refine.
            </p>
            <div className="nl-row">
              <textarea
                value={nlText}
                onChange={(e) => setNlText(e.target.value)}
                placeholder="e.g. Free most weekdays after 4pm except Tuesday."
              />
              <div className="nl-actions">
                <button type="button" className="btn btn-primary" onClick={() => void runParse()}>
                  Parse
                </button>
                {speech.supported ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={speech.listening}
                    onClick={() =>
                      speech.listen(
                        (t) => setNlText((prev) => (prev ? `${prev.trim()} ${t}` : t)),
                        (err) => setParseErr(err),
                      )
                    }
                  >
                    {speech.listening ? 'Listening…' : 'Speak'}
                  </button>
                ) : null}
              </div>
            </div>
            {parseErr ? <p className="warnings">{parseErr}</p> : null}
            {parseWarnings.length ? (
              <ul className="warnings">
                {parseWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {mode === 'grid' ? (
          <div className="panel">
            <p className="muted" style={{ marginTop: 0 }}>
              Click half-hour cells to toggle. Output matches the same JSON schema as natural
              language mode.
            </p>
          </div>
        ) : null}

        {mode === 'calendar' ? (
          <div className="panel">
            <p className="muted" style={{ marginTop: 0 }}>
              Busy times for the next five days are overlaid on your blocks. You choose whether to
              keep or remove conflicting availability.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {googleConnected ? (
                <>
                  <span className="muted">Google Calendar connected</span>
                  <button type="button" className="btn" onClick={() => void refreshBusy()}>
                    Refresh busy times
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-primary" onClick={connectGoogle}>
                  Connect Google Calendar
                </button>
              )}
            </div>
            {displayBlocks.length && googleConnected && busy.length ? (
              <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
                {displayBlocks
                  .filter((b) => conflictIds.has(b.block_id))
                  .map((b) => (
                    <li
                      key={b.block_id}
                      style={{
                        marginBottom: '0.35rem',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.35rem',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        <strong>{b.day}</strong> {b.start}–{b.end}
                      </span>
                      <button type="button" className="btn" onClick={() => removeBlock(b.block_id)}>
                        Remove block
                      </button>
                      {keptConflictAck.has(b.block_id) ? (
                        <span className="muted">Kept</span>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setKeptConflictAck((prev) => new Set(prev).add(b.block_id))
                          }
                        >
                          Keep As Is
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="panel">
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 600 }}>Weekly blocks</h2>
          <WeeklyGrid
            timezone={tz}
            displayBlocks={displayBlocks}
            readOnly={mode === 'nl'}
            selectedSlots={mode === 'grid' ? selectedSlots : undefined}
            onToggleSlot={mode === 'grid' ? onToggleSlot : undefined}
            conflictSlotKeys={googleConnected && busy.length ? conflictSlotKeys : undefined}
          />
        </div>

        <div className="config-footer">
          <span className="muted">
            {overlaps ? 'Overlapping blocks detected — adjust the grid before confirming.' : '\u00a0'}
          </span>
          <button type="button" className="btn btn-primary" disabled={saving || overlaps} onClick={() => void onSave()}>
            {saving ? 'Saving…' : 'Confirm and save'}
          </button>
        </div>
      </div>
    </div>
  )
}
