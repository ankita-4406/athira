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
  'Asia/Calcutta',
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

/** App default (India); Asia/Calcutta is the legacy IANA name for UTC+5:30. */
const APP_DEFAULT_TZ = 'Asia/Calcutta'

export function defaultTimezone(): string {
  return APP_DEFAULT_TZ
}
