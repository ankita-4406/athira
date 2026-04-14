const FALLBACK = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Sydney',
]

export function listTimezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (typeof fn === 'function') {
      return fn.call(Intl, 'timeZone').slice().sort()
    }
  } catch {
    /* ignore */
  }
  return FALLBACK
}

/** App default (India); IANA uses Asia/Kolkata (same zone as legacy Asia/Calcutta). */
const APP_DEFAULT_TZ = 'Asia/Kolkata'

export function defaultTimezone(): string {
  return APP_DEFAULT_TZ
}
