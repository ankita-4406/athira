import type { AvailabilityBlock, DayOfWeek, Period } from './types'

export const DAY_ORDER: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

export const SLOT_MIN = 0
export const SLOT_MAX = 48

export function slotKey(day: DayOfWeek, slotIndex: number): string {
  return `${day}-${slotIndex}`
}

export function parseSlotKey(key: string): { day: DayOfWeek; slotIndex: number } {
  const [day, idx] = key.split('-') as [DayOfWeek, string]
  return { day, slotIndex: Number(idx) }
}

export function slotIndexToMinutes(slotIndex: number): number {
  return slotIndex * 30
}

export function minutesToHHmm(m: number): string {
  if (m >= 1440) return '24:00'
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function periodForStartMinutes(m: number): Period {
  if (m >= 360 && m < 720) return 'morning'
  if (m >= 720 && m < 1020) return 'afternoon'
  if (m >= 1020 && m < 1320) return 'evening'
  if (m >= 1320 || m < 120) return 'night'
  return 'morning'
}

export function slotsFromBlocks(blocks: AvailabilityBlock[]): Set<string> {
  const set = new Set<string>()
  for (const b of blocks) {
    const sm = timeToMinutes(b.start)
    let em = timeToMinutes(b.end)
    if (b.end === '24:00') em = 1440
    for (let m = sm; m < em; m += 30) {
      const idx = Math.floor(m / 30)
      if (idx >= 0 && idx < SLOT_MAX) set.add(slotKey(b.day, idx))
    }
  }
  return set
}

function timeToMinutes(t: string): number {
  if (t === '24:00') return 1440
  const [h, mm] = t.split(':').map(Number)
  return h * 60 + mm
}

export function blocksFromSlots(selected: Set<string>): AvailabilityBlock[] {
  const byDay: Record<DayOfWeek, number[]> = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  }
  for (const key of selected) {
    const { day, slotIndex } = parseSlotKey(key)
    if (slotIndex >= 0 && slotIndex < SLOT_MAX) byDay[day].push(slotIndex)
  }
  const blocks: AvailabilityBlock[] = []
  for (const day of DAY_ORDER) {
    const idxs = [...new Set(byDay[day])].sort((a, b) => a - b)
    if (!idxs.length) continue
    let runStart = idxs[0]
    let prev = idxs[0]
    const flush = (endSlot: number) => {
      const sm = slotIndexToMinutes(runStart)
      const em = slotIndexToMinutes(endSlot + 1)
      const start = minutesToHHmm(sm)
      const end = minutesToHHmm(em)
      const period = periodForStartMinutes(sm)
      const block_id = `${day}-${start}-${end}`
      blocks.push({ day, start, end, period, block_id })
    }
    for (let i = 1; i < idxs.length; i++) {
      if (idxs[i] === prev + 1) {
        prev = idxs[i]
        continue
      }
      flush(prev)
      runStart = idxs[i]
      prev = idxs[i]
    }
    flush(prev)
  }
  return blocks
}
