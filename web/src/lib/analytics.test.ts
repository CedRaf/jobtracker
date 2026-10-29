import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import type { ScrapeRun, StatusChange } from '../data/types'
import { makeJob } from '../test/fixtures'
import {
  funnel, jobsPerDay, median, reasonCounts, responseDays, runState, skillDemand, staleSources, successRate,
} from './analytics'

const change = (id: string, to: StatusChange['to_status'], at: string, from: StatusChange['from_status'] = null): StatusChange =>
  ({ job_source: 'jobstreet', job_external_id: id, from_status: from, to_status: to, changed_at: at })

describe('jobsPerDay', () => {
  it('counts per day and source, including empty days', () => {
    const now = dayjs('2026-10-22T12:00:00')
    const days = jobsPerDay([
      makeJob({ source: 'jobstreet', first_seen: dayjs('2026-10-22T09:00:00').toISOString() }),
      makeJob({ source: 'linkedin', first_seen: dayjs('2026-10-22T10:00:00').toISOString() }),
      makeJob({ source: 'jobstreet', first_seen: dayjs('2026-10-20T10:00:00').toISOString() }),
      makeJob({ source: 'jobstreet', first_seen: dayjs('2026-10-01T10:00:00').toISOString() }), // too old
    ], 3, now)
    expect(days).toEqual([
      { day: '2026-10-20', jobstreet: 1, linkedin: 0, himalayas: 0 },
      { day: '2026-10-21', jobstreet: 0, linkedin: 0, himalayas: 0 },
      { day: '2026-10-22', jobstreet: 1, linkedin: 1, himalayas: 0 },
    ])
  })
})

it('skillDemand counts each skill once per job, most common first', () => {
  const demand = skillDemand([
    makeJob({ matched_skills: ['React', 'SQL'], missing_skills: ['PHP'] }),
    makeJob({ matched_skills: ['React', 'React'], missing_skills: ['PHP', 'Docker'] }),
  ])
  expect(demand.yours).toEqual([{ skill: 'React', count: 2 }, { skill: 'SQL', count: 1 }])
  expect(demand.others).toEqual([{ skill: 'PHP', count: 2 }, { skill: 'Docker', count: 1 }])
})

describe('funnel', () => {
  const jobs = [
    makeJob({ external_id: 'a', status: 'new' }),
    makeJob({ external_id: 'b', status: 'skip' }),
    makeJob({ external_id: 'c', status: 'applied' }),
    makeJob({ external_id: 'd', status: 'rejected' }), // imported: no history
    makeJob({ external_id: 'e', status: 'offer' }),
  ]
  const history = [
    change('e', 'applied', '2026-10-01T00:00:00Z', 'new'),
    change('e', 'interview', '2026-10-05T00:00:00Z', 'applied'),
    change('e', 'offer', '2026-10-10T00:00:00Z', 'interview'),
  ]

  it('counts jobs that ever reached each stage', () => {
    const { stages } = funnel(jobs, history)
    expect(Object.fromEntries(stages.map((s) => [s.key, s.count]))).toEqual({
      found: 5, reviewed: 4, applied: 3, heard: 2, interview: 1, offer: 1,
    })
  })

  it('gives the response rate among applications, or null with none', () => {
    expect(funnel(jobs, history).responseRate).toBeCloseTo(2 / 3)
    expect(funnel([makeJob()], []).responseRate).toBeNull()
  })
})

describe('responseDays', () => {
  it('measures from the first application to the first response', () => {
    expect(responseDays([
      change('a', 'applied', '2026-10-01T00:00:00Z'),
      change('a', 'emailed', '2026-10-02T00:00:00Z'),
      change('a', 'interview', '2026-10-05T00:00:00Z'),
      change('a', 'offer', '2026-10-09T00:00:00Z'), // not a first response
      change('b', 'rejected', '2026-10-03T00:00:00Z'), // never applied in the history
      change('c', 'emailed', '2026-10-02T12:00:00Z'),
      change('c', 'rejected', '2026-10-04T00:00:00Z'),
    ]).sort()).toEqual([1.5, 4])
  })
})

it('median handles odd, even and empty lists', () => {
  expect(median([5, 1, 3])).toBe(3)
  expect(median([4, 1, 2, 3])).toBe(2.5)
  expect(median([])).toBeNull()
})

it('reasonCounts groups filtered jobs by rule', () => {
  const job = (reason: string) => ({ reason }) as Parameters<typeof reasonCounts>[0][number]
  expect(reasonCounts([job('seniority title (Senior)'), job('seniority title (Lead)'), job('internship (Intern)')]))
    .toEqual([{ reason: 'seniority title', count: 2 }, { reason: 'internship', count: 1 }])
})

describe('scraper health', () => {
  const now = Date.parse('2026-10-22T12:00:00Z')
  const run = (overrides: Partial<ScrapeRun>): ScrapeRun => ({
    source: 'jobstreet', started_at: '2026-10-22T03:00:00Z', finished_at: '2026-10-22T03:03:00Z',
    found: 100, evaluated: 20, kept: 3, filtered: 17, expired: 0, error: null, github_run_id: null,
    settings_version: 1, ...overrides,
  })

  it('tells finished, failed, running and interrupted runs apart', () => {
    expect(runState(run({}), now)).toBe('ok')
    expect(runState(run({ error: 'boom' }), now)).toBe('failed')
    expect(runState(run({ started_at: '2026-10-22T11:50:00Z', finished_at: null }), now)).toBe('running')
    expect(runState(run({ finished_at: null }), now)).toBe('interrupted')
  })

  it('flags sources with no run in the last 24 hours', () => {
    expect(staleSources([run({}), run({ source: 'linkedin', started_at: '2026-10-20T03:00:00Z' })], ['jobstreet', 'linkedin'], now))
      .toEqual(['linkedin'])
  })

  it('computes the success rate, ignoring runs still going', () => {
    expect(successRate([run({}), run({ error: 'boom' }), run({ started_at: '2026-10-22T11:59:00Z', finished_at: null })], now))
      .toBe(0.5)
    expect(successRate([], now)).toBeNull()
  })
})
