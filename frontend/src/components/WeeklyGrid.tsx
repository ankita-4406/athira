import type { AvailabilityBlock } from '../types'
import { DAY_ORDER, minutesToHHmm, slotIndexToMinutes, slotKey, slotsFromBlocks } from '../gridUtils'

type Props = {
  timezone: string
  displayBlocks: AvailabilityBlock[]
  readOnly?: boolean
  selectedSlots?: Set<string>
  onToggleSlot?: (key: string) => void
  /** When set, only these half-hour cells are marked conflicting (precise vs whole block). */
  conflictSlotKeys?: Set<string>
}

export function WeeklyGrid({
  timezone,
  displayBlocks,
  readOnly = false,
  selectedSlots,
  onToggleSlot,
  conflictSlotKeys,
}: Props) {
  const fromBlocks = slotsFromBlocks(displayBlocks)
  const slotIndices = Array.from({ length: 48 }, (_, i) => i)

  const isSelected = (day: (typeof DAY_ORDER)[number], idx: number) => {
    const k = slotKey(day, idx)
    if (selectedSlots) return selectedSlots.has(k)
    return fromBlocks.has(k)
  }

  return (
    <div className="weekly-grid-wrap">
      <div className="weekly-grid-meta">
        <span className="muted">Timezone: {timezone}</span>
      </div>
      <div className="weekly-grid-scroll">
        <table className="weekly-grid">
          <thead>
            <tr>
              <th className="wg-corner" />
              {Array.from({ length: 24 }, (_, h) => (
                <th
                  key={h}
                  colSpan={2}
                  className={`wg-hour ${h < 6 || h >= 22 ? 'wg-offpeak' : ''}`}
                >
                  {String(h).padStart(2, '0')}:00
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_ORDER.map((day) => (
              <tr key={day}>
                <th className="wg-day">{day.slice(0, 3)}</th>
                {slotIndices.map((i) => {
                  const k = slotKey(day, i)
                  const on = isSelected(day, i)
                  const conflict = Boolean(conflictSlotKeys?.has(k))
                  const startM = slotIndexToMinutes(i)
                  const endM = startM + 30
                  return (
                    <td
                      key={k}
                      className={`wg-cell-wrap${i > 0 && i % 2 === 0 ? ' wg-hour-start' : ''}`}
                    >
                      <button
                        type="button"
                        className={`wg-cell ${on ? 'on' : ''} ${conflict ? 'conflict' : ''} ${readOnly ? 'readonly' : ''}`}
                        disabled={readOnly}
                        onClick={() => !readOnly && onToggleSlot?.(k)}
                        title={`${day} ${minutesToHHmm(startM)}–${minutesToHHmm(endM)}`}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
