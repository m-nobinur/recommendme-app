/**
 * Timezone utilities for the agent and chat tool layer.
 *
 * Uses date-fns + @date-fns/tz for reliable IANA timezone support.
 *
 * Appointment dates are stored as YYYY-MM-DD and times as HH:MM -- these
 * represent the user's local time, not UTC. When the system needs to compute
 * "today" or "hours until appointment", it must interpret these strings in
 * the user's timezone.
 *
 * The canonical timezone comes from `organizations.settings.timezone` (IANA
 * name, e.g. "America/New_York"). If unset, falls back to UTC.
 */

import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'

const DEFAULT_TIMEZONE = 'UTC'

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function resolveTimezone(tz: string | undefined | null): string {
  if (!tz) return DEFAULT_TIMEZONE
  return isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE
}

export function todayInTimezone(tz: string, now?: number): string {
  const base = now !== undefined ? new TZDate(now, tz) : new TZDate(Date.now(), tz)
  return format(base, 'yyyy-MM-dd')
}

/**
 * Parse appointment wall-clock time (YYYY-MM-DD HH:MM) in the given timezone
 * and return UTC epoch milliseconds.
 *
 * Uses TZDate.tz() to construct a date at the specified wall-clock time in
 * the given timezone, correctly handling DST transitions.
 */
export function appointmentToEpoch(date: string, time: string, tz: string): number {
  try {
    const [y, m, d] = date.split('-').map(Number)
    const [h, min] = time.split(':').map(Number)
    if ([y, m, d, h, min].some((v) => Number.isNaN(v))) return Number.NaN
    const tzDate = TZDate.tz(tz, y, m - 1, d, h, min, 0)
    return tzDate.getTime()
  } catch {
    return Number.NaN
  }
}

export function dateInTimezone(tz: string, daysOffset: number, now?: number): string {
  const base = now !== undefined ? new TZDate(now, tz) : new TZDate(Date.now(), tz)
  const shifted = addDays(base, daysOffset)
  return format(shifted, 'yyyy-MM-dd')
}

export function epochToDateInTimezone(epochMs: number, tz: string): string {
  return format(new TZDate(epochMs, tz), 'yyyy-MM-dd')
}
