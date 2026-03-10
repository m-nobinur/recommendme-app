/**
 * Convex-side timezone utilities.
 *
 * Uses date-fns + @date-fns/tz for reliable IANA timezone support.
 * These work in the Convex V8 isolate (no Node.js APIs needed).
 */

import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

const DEFAULT_TIMEZONE = 'UTC'

export function resolveTimezone(tz: string | undefined | null): string {
  if (!tz) return DEFAULT_TIMEZONE
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_TIMEZONE
  }
}

export function todayInTimezone(tz: string, nowMs?: number): string {
  const base = nowMs !== undefined ? new TZDate(nowMs, tz) : new TZDate(Date.now(), tz)
  return format(base, 'yyyy-MM-dd')
}

export function epochToDateInTimezone(epochMs: number, tz: string): string {
  return format(new TZDate(epochMs, tz), 'yyyy-MM-dd')
}

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
