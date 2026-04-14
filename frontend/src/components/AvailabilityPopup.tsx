import { useNavigate } from 'react-router-dom'
import type { AvailabilityBlock, AvailabilityProfile, BusyInterval } from '../types'
import { conflictingBlockIds } from '../conflicts'
import { dayLabel, periodLabel } from '../conflicts'

type Props = {
  open: boolean
  onClose: () => void
  profile: AvailabilityProfile | null
  busy: BusyInterval[]
  loading?: boolean
  loadError?: string | null
}

export function AvailabilityPopup({ open, onClose, profile, busy, loading, loadError }: Props) {
  const navigate = useNavigate()
  if (!open) return null

  const conflicts =
    profile && profile.blocks.length && busy.length
      ? conflictingBlockIds(profile.blocks, profile.timezone, busy)
      : new Set<string>()

  return (
    <div className="popup-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="popup-card"
        role="dialog"
        aria-labelledby="avail-popup-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="avail-popup-title">Availability</h2>
        <p className="muted" style={{ margin: 0 }}>
          Summary of your current weekly availability (30-minute blocks).
        </p>
        {loadError ? (
          <p className="warnings" style={{ marginTop: '0.75rem' }}>
            {loadError}
          </p>
        ) : loading || !profile ? (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Loading…
          </p>
        ) : profile.blocks.length === 0 ? (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            No availability configured yet.
          </p>
        ) : (
          <ul className="popup-block-list">
            {profile!.blocks.map((b: AvailabilityBlock) => (
              <li key={b.block_id} className="popup-block">
                <span>
                  <strong>{dayLabel(b.day)}</strong> · {b.start}–{b.end}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span className="period-chip">{periodLabel(b.period)}</span>
                  {conflicts.has(b.block_id) ? (
                    <span className="conflict-badge">Calendar conflict</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="popup-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/availability')}>
            Update availability
          </button>
        </div>
      </div>
    </div>
  )
}
