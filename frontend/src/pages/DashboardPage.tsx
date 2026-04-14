import { useCallback, useEffect, useState } from 'react'
import { CursorTrail } from '../components/effects/CursorTrail'
import { AvailabilityPopup } from '../components/AvailabilityPopup'
import { usePointerParallax } from '../hooks/usePointerParallax'
import { getAvailability, googleFreeBusy, googleStatus } from '../api'
import type { AvailabilityProfile, BusyInterval } from '../types'

export function DashboardPage() {
  const { ref, shift } = usePointerParallax(10)
  const [profile, setProfile] = useState<AvailabilityProfile | null>(null)
  const [busy, setBusy] = useState<BusyInterval[]>([])
  const [popupOpen, setPopupOpen] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoadErr(null)
    try {
      const p = await getAvailability()
      setProfile(p)
      const st = await googleStatus()
      if (st.connected) {
        try {
          const fb = await googleFreeBusy()
          setBusy(fb.busy)
        } catch {
          setBusy([])
        }
      } else {
        setBusy([])
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="dashboard-root" ref={ref}>
      <CursorTrail />
      <div
        className="parallax-bg"
        style={{
          transform: `translate3d(${shift.x * 0.4}px, ${shift.y * 0.35}px, 0)`,
        }}
      >
        <div
          className="parallax-plane p1"
          style={{ transform: `translate3d(${shift.x * 1.1}px, ${shift.y * 0.9}px, 0)` }}
        />
        <div
          className="parallax-plane p2"
          style={{ transform: `translate3d(${shift.x * -0.8}px, ${shift.y * -1}px, 0)` }}
        />
        <div
          className="parallax-plane p3"
          style={{ transform: `translate3d(${shift.x * 0.5}px, ${shift.y * 0.6}px, 0)` }}
        />
      </div>

      <div className="dashboard-shell">
        <aside className="dash-side">
          <div className="dash-brand">Athira</div>
          <div className="dash-title">Tutor</div>
          <nav>
            <span className="dash-nav-item">Overview</span>
            <span className="dash-nav-item">Sessions</span>
            <span className="dash-nav-item">Students</span>
            <span className="dash-nav-item" style={{ background: '#f0fdfa', color: 'var(--accent)' }}>
              Schedule
            </span>
          </nav>
        </aside>
        <main className="dash-main">
          <header className="dash-header">
            <h1>Dashboard</h1>
            <button type="button" className="btn" onClick={() => setPopupOpen(true)}>
              Availability
            </button>
          </header>
          {loadErr ? <p className="muted">{loadErr}</p> : null}
          <section className="dash-card">
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
              This is a lightweight shell so the availability popup reads as part of a real tutor
              workspace. Open <strong>Availability</strong> to review your weekly blocks or go to
              the full editor.
            </p>
          </section>
        </main>
      </div>

      <AvailabilityPopup
        open={popupOpen}
        onClose={() => setPopupOpen(false)}
        profile={profile}
        busy={busy}
        loading={!loadErr && profile === null}
        loadError={loadErr}
      />
    </div>
  )
}
