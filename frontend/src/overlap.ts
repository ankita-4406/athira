import type { AvailabilityBlock, DayOfWeek } from './types'
import { DAY_ORDER } from './gridUtils'

function startMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function endMin(b: AvailabilityBlock): number {
  if (b.end === '24:00') return 1440
  const [h, m] = b.end.split(':').map(Number)
  return h * 60 + m
}

export function hasOverlappingBlocks(blocks: AvailabilityBlock[]): boolean {
  const byDay: Record<DayOfWeek, AvailabilityBlock[]> = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  }
  for (const b of blocks) byDay[b.day].push(b)
  for (const d of DAY_ORDER) {
    const bs = byDay[d].sort((a, b) => startMin(a.start) - startMin(b.start))
    for (let i = 0; i < bs.length - 1; i++) {
      const a = bs[i]
      const b = bs[i + 1]
      if (startMin(b.start) < endMin(a)) return true
    }
  }
  return false
}
