import type { AvailabilityProfile, ParseAvailabilityResponse } from './types'

async function handle<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const text = await r.text()
    throw new Error(text || r.statusText)
  }
  return r.json() as Promise<T>
}

export function getAvailability(): Promise<AvailabilityProfile> {
  return handle(fetch('/api/availability'))
}

export function saveAvailability(
  availability: AvailabilityProfile,
): Promise<AvailabilityProfile> {
  return handle(
    fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ availability }),
    }),
  )
}

export function parseAvailability(body: {
  text: string
  timezone: string
  previous?: AvailabilityProfile | null
}): Promise<ParseAvailabilityResponse> {
  return handle(
    fetch('/api/parse-availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

export function googleStatus(): Promise<{ connected: boolean }> {
  return handle(fetch('/api/google/status'))
}

export function googleFreeBusy(): Promise<{ busy: { start: string; end: string }[] }> {
  return handle(
    fetch('/api/google/freebusy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
  )
}

export function googleOAuthStartUrl(): string {
  return '/api/google/oauth/start'
}
