import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appointmentToEpoch,
  dateInTimezone,
  epochToDateInTimezone,
  isValidTimezone,
  resolveTimezone,
  todayInTimezone,
} from './timezone'

describe('isValidTimezone', () => {
  it('accepts known IANA zones', () => {
    assert.ok(isValidTimezone('America/New_York'))
    assert.ok(isValidTimezone('Europe/London'))
    assert.ok(isValidTimezone('Asia/Tokyo'))
    assert.ok(isValidTimezone('UTC'))
  })

  it('rejects invalid zones', () => {
    assert.equal(isValidTimezone('Fake/City'), false)
    assert.equal(isValidTimezone(''), false)
    assert.equal(isValidTimezone('Not_A_Zone'), false)
  })
})

describe('resolveTimezone', () => {
  it('returns valid timezone as-is', () => {
    assert.equal(resolveTimezone('America/New_York'), 'America/New_York')
  })

  it('returns UTC for null/undefined/empty', () => {
    assert.equal(resolveTimezone(null), 'UTC')
    assert.equal(resolveTimezone(undefined), 'UTC')
    assert.equal(resolveTimezone(''), 'UTC')
  })

  it('returns UTC for invalid timezone', () => {
    assert.equal(resolveTimezone('Fake/City'), 'UTC')
  })
})

describe('todayInTimezone', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = todayInTimezone('UTC')
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/)
  })

  it('respects timezone offset', () => {
    const midnight_utc = Date.UTC(2026, 2, 10, 0, 30, 0)
    const utcDate = todayInTimezone('UTC', midnight_utc)
    assert.equal(utcDate, '2026-03-10')

    const nyDate = todayInTimezone('America/New_York', midnight_utc)
    assert.equal(nyDate, '2026-03-09', 'NYC at UTC 00:30 is still Mar 9 (UTC-4 DST)')
  })
})

describe('epochToDateInTimezone', () => {
  it('converts epoch to local date', () => {
    const epoch = Date.UTC(2026, 2, 10, 3, 0, 0)
    assert.equal(epochToDateInTimezone(epoch, 'UTC'), '2026-03-10')
    assert.equal(
      epochToDateInTimezone(epoch, 'America/New_York'),
      '2026-03-09',
      'NYC at UTC 03:00 is still Mar 9 (UTC-4 DST)'
    )
  })
})

describe('dateInTimezone', () => {
  it('returns YYYY-MM-DD for offset days', () => {
    const base = Date.UTC(2026, 2, 10, 12, 0, 0)
    assert.equal(dateInTimezone('UTC', 0, base), '2026-03-10')
    assert.equal(dateInTimezone('UTC', 1, base), '2026-03-11')
    assert.equal(dateInTimezone('UTC', -1, base), '2026-03-09')
  })
})

describe('appointmentToEpoch', () => {
  it('converts UTC appointment correctly', () => {
    const epoch = appointmentToEpoch('2026-03-10', '14:00', 'UTC')
    const expected = Date.UTC(2026, 2, 10, 14, 0, 0)
    assert.equal(epoch, expected)
  })

  it('converts timezone-aware appointment correctly', () => {
    const epoch = appointmentToEpoch('2026-03-10', '14:00', 'America/New_York')
    const expectedUtc = Date.UTC(2026, 2, 10, 18, 0, 0)
    assert.ok(
      Math.abs(epoch - expectedUtc) <= 1000,
      `NYC 14:00 should be ~UTC 18:00 (DST). Got diff: ${epoch - expectedUtc}ms`
    )
  })

  it('returns NaN for invalid date', () => {
    assert.ok(Number.isNaN(appointmentToEpoch('bad-date', '14:00', 'UTC')))
  })
})
