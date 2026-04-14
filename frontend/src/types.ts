export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export type Period = 'morning' | 'afternoon' | 'evening' | 'night'

export interface AvailabilityBlock {
  day: DayOfWeek
  start: string
  end: string
  period: Period
  block_id: string
}

export interface PendingConflict {
  block_id: string
  busy_start_utc: string
  busy_end_utc: string
}

export interface AvailabilityMetadata {
  last_source?: 'nl' | 'grid' | 'calendar'
  updated_at?: string
}

export interface AvailabilityProfile {
  schema_version: '1.0'
  timezone: string
  blocks: AvailabilityBlock[]
  metadata?: AvailabilityMetadata | null
  pending_conflicts?: PendingConflict[]
}

export interface ParseAvailabilityResponse {
  availability: AvailabilityProfile
  warnings: string[]
}

export interface BusyInterval {
  start: string
  end: string
}
