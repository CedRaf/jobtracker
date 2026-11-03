import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import type { JobSource, ScraperDispatch, SourceSchedule } from '../data/types'
import { dispatchProblem, nextStart, scheduledSources } from './schedule'

const ALL: JobSource[] = ['jobstreet', 'linkedin', 'himalayas']
const schedule = (change: Partial<Record<JobSource, SourceSchedule>> = {}) =>
  ({ ...structuredClone(DEFAULT_SETTINGS.sources), ...change })
/** A moment given in Manila time (UTC+8). */
const manila = (hhmm: string, day = '2026-11-03') => new Date(`${day}T${hhmm}:00+08:00`)

describe('nextStart', () => {
  it('finds the next time today, with every site due then', () => {
    expect(nextStart(schedule(), ALL, manila('09:00'))).toEqual({ time: '11:00', today: true, sources: ALL })
  })

  it('counts a start in the current minute as still to come', () => {
    expect(nextStart(schedule(), ALL, manila('15:00'))?.time).toBe('15:00')
  })

  it('wraps to tomorrow after the last time', () => {
    expect(nextStart(schedule(), ALL, manila('16:00'))).toEqual({ time: '11:00', today: false, sources: ALL })
  })

  it('uses Manila time whatever the UTC date', () => {
    // 00:30 Manila is 16:30 UTC the day before.
    const s = schedule({ himalayas: { enabled: true, times: ['00:30'] } })
    expect(nextStart(s, ['himalayas'], manila('23:30'))).toEqual({ time: '00:30', today: false, sources: ['himalayas'] })
    expect(nextStart(s, ['himalayas'], manila('00:10', '2026-11-04'))?.today).toBe(true)
  })

  it('skips switched-off sites and lists only the sites due at that time', () => {
    const s = schedule({
      linkedin: { enabled: false, times: ['09:30'] },
      himalayas: { enabled: true, times: ['10:00'] },
    })
    expect(nextStart(s, ALL, manila('09:00'))).toEqual({ time: '10:00', today: true, sources: ['himalayas'] })
  })

  it('is null when nothing is scheduled', () => {
    const off = { enabled: false, times: ['11:00'] }
    expect(nextStart(schedule({ jobstreet: off, linkedin: off, himalayas: off }), ALL)).toBeNull()
    expect(nextStart(schedule({ jobstreet: { enabled: true, times: [] } }), ['jobstreet'])).toBeNull()
  })
})

it('scheduledSources leaves out switched-off sites and sites without times', () => {
  const s = schedule({ linkedin: { enabled: false, times: ['11:00'] }, himalayas: { enabled: true, times: [] } })
  expect(scheduledSources(s, ALL)).toEqual(['jobstreet'])
})

describe('dispatchProblem', () => {
  const now = Date.parse('2026-11-03T03:30:00Z')
  const dispatch = (fields: Partial<ScraperDispatch>): ScraperDispatch => ({
    slot: '2026-11-03T03:00:00Z', sources: ['jobstreet'], status_code: null, error: null,
    created_at: '2026-11-03T03:00:01Z', ...fields,
  })

  it.each([
    ['started (204)', { status_code: 204 }, null],
    ['reply still on the way', { created_at: '2026-11-03T03:20:00Z' }, null],
    ['an error', { error: 'No GitHub token: add the Vault secret' }, 'No GitHub token: add the Vault secret'],
    ['GitHub refused', { status_code: 401 }, 'GitHub replied HTTP 401.'],
    ['no reply after 20 minutes', {}, 'GitHub never replied to the request.'],
  ])('%s', (_label, fields, problem) => {
    expect(dispatchProblem(dispatch(fields), now)).toBe(problem)
  })
})
