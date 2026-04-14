import { addDays } from 'date-fns'
import { formatInTimeZone, toDate } from 'date-fns-tz'
import { parseSlotKey, slotsFromBlocks } from './gridUtils'
import type { AvailabilityBlock, BusyInterval } from './types'

function hhmmToMinutes(t: string): number {
  if (t === '24:00') return 1440
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function blockUtcIntervalOnDate(
  block: AvailabilityBlock,
  isoDate: string,
  tz: string,
): { start: Date; end: Date } | null {
  const dow = formatInTimeZone(
    toDate(`${isoDate}T12:00:00`, { timeZone: tz }),
    tz,
    'EEEE',
  ).toLowerCase() as AvailabilityBlock['day']
  if (dow !== block.day) return null

  const start = toDate(`${isoDate} ${block.start}:00`, { timeZone: tz })
  let end: Date
  if (block.end === '24:00') {
    const nextIso = formatInTimeZone(addDays(toDate(`${isoDate}T12:00:00`, { timeZone: tz }), 1), tz, 'yyyy-MM-dd')
    end = toDate(`${nextIso} 00:00:00`, { timeZone: tz })
  } else {
    const em = hhmmToMinutes(block.end)
    const eh = Math.floor(em / 60)
    const emin = em % 60
    const pad = (n: number) => n.toString().padStart(2, '0')
    end = toDate(`${isoDate} ${pad(eh)}:${pad(emin)}:00`, { timeZone: tz })
  }
  if (!(end > start)) return null
  return { start, end }
}

function overlapsHalfOpen(a0: Date, a1: Date, b0: Date, b1: Date): boolean {
  return a0 < b1 && b0 < a1
}

/** One 30-minute slot [start, end) in tutor TZ on a concrete calendar date (when weekday matches). */
function slotUtcIntervalOnDate(
  day: AvailabilityBlock['day'],
  slotIndex: number,
  isoDate: string,
  tz: string,
): { start: Date; end: Date } | null {
  const dow = formatInTimeZone(
    toDate(`${isoDate}T12:00:00`, { timeZone: tz }),
    tz,
    'EEEE',
  ).toLowerCase() as AvailabilityBlock['day']
  if (dow !== day) return null

  const sm = slotIndex * 30
  const em = sm + 30
  const pad = (n: number) => n.toString().padStart(2, '0')
  const sh = Math.floor(sm / 60)
  const smin = sm % 60
  const start = toDate(`${isoDate} ${pad(sh)}:${pad(smin)}:00`, { timeZone: tz })

  let end: Date
  if (em >= 1440) {
    const nextIso = formatInTimeZone(
      addDays(toDate(`${isoDate}T12:00:00`, { timeZone: tz }), 1),
      tz,
      'yyyy-MM-dd',
    )
    end = toDate(`${nextIso} 00:00:00`, { timeZone: tz })
  } else {
    const eh = Math.floor(em / 60)
    const emin = em % 60
    end = toDate(`${isoDate} ${pad(eh)}:${pad(emin)}:00`, { timeZone: tz })
  }
  if (!(end > start)) return null
  return { start, end }
}

/** Slot keys (`day-slotIndex`) whose 30m window overlaps Google busy in the rolling 5-day window. */
export function conflictingSlotKeys(
  blocks: AvailabilityBlock[],
  tz: string,
  busy: BusyInterval[],
): Set<string> {
  const out = new Set<string>()
  if (!blocks.length || !busy.length) return out

  const slotKeysOn = slotsFromBlocks(blocks)
  const todayNoon = toDate(
    `${formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')}T12:00:00`,
    { timeZone: tz },
  )

  for (let i = 0; i < 5; i++) {
    const cal = addDays(todayNoon, i)
    const isoDate = formatInTimeZone(cal, tz, 'yyyy-MM-dd')
    for (const key of slotKeysOn) {
      const { day, slotIndex } = parseSlotKey(key)
      const iv = slotUtcIntervalOnDate(day, slotIndex, isoDate, tz)
      if (!iv) continue
      for (const b of busy) {
        const b0 = new Date(b.start)
        const b1 = new Date(b.end)
        if (overlapsHalfOpen(iv.start, iv.end, b0, b1)) {
          out.add(key)
          break
        }
      }
    }
  }
  return out
}

export function conflictingBlockIds(
  blocks: AvailabilityBlock[],
  tz: string,
  busy: BusyInterval[],
): Set<string> {
  const out = new Set<string>()
  if (!blocks.length || !busy.length) return out

  const todayNoon = toDate(
    `${formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')}T12:00:00`,
    { timeZone: tz },
  )

  for (let i = 0; i < 5; i++) {
    const day = addDays(todayNoon, i)
    const isoDate = formatInTimeZone(day, tz, 'yyyy-MM-dd')
    for (const block of blocks) {
      const iv = blockUtcIntervalOnDate(block, isoDate, tz)
      if (!iv) continue
      for (const b of busy) {
        const b0 = new Date(b.start)
        const b1 = new Date(b.end)
        if (overlapsHalfOpen(iv.start, iv.end, b0, b1)) out.add(block.block_id)
      }
    }
  }
  return out
}

export function periodLabel(p: AvailabilityBlock['period']): string {
  switch (p) {
    case 'morning':
      return 'Morning'
    case 'afternoon':
      return 'Afternoon'
    case 'evening':
      return 'Evening'
    case 'night':
      return 'Night'
  }
}

export function dayLabel(d: AvailabilityBlock['day']): string {
  return d.charAt(0).toUpperCase() + d.slice(1)
}
