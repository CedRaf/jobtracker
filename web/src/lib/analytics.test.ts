import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'
import type { Job, JobStatus, ScrapeRun, StatusChange } from '../data/types'
import { makeJob } from '../test/fixtures'
import {
  MIN_SAMPLE, applications, breakdown, daysToResponse, deriveOutcome, dropOff, funnel, jobsPerDay, median,
  reasonCounts, runState, skillDemand, staleSources, successRate,
} from './analytics'

let historyId = 0
const change = (
  id: string, to: StatusChange['to_status'], at: string, from: StatusChange['from_status'] = null,
  reverted_at: string | null = null,
): StatusChange => ({
  id: ++historyId, job_source: 'jobstreet', job_external_id: id, from_status: from, to_status: to, changed_at: at,
  kind: 'change', reverted_at, undoable: true,
})

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

  it('ignores changes that were undone or corrected away', () => {
    // A misclick into Offer, undone: the job only ever reached Applied.
    const misclick = [
      change('m', 'applied', '2026-10-01T00:00:00Z', 'new'),
      change('m', 'offer', '2026-10-02T00:00:00Z', 'applied', '2026-10-02T00:01:00Z'),
    ]
    const { stages } = funnel([makeJob({ external_id: 'm', status: 'applied' })], misclick)
    expect(Object.fromEntries(stages.map((s) => [s.key, s.count]))).toMatchObject({ applied: 1, heard: 0, offer: 0 })
  })

  it("doesn't count an expired job as reviewed", () => {
    const { stages } = funnel([makeJob({ external_id: 'x', status: 'expired' })], [])
    expect(stages.find((s) => s.key === 'reviewed')?.count).toBe(0)
  })

  it('counts an exam as hearing back', () => {
    const { stages } = funnel([makeJob({ external_id: 'x', status: 'exam' })], [])
    expect(stages.find((s) => s.key === 'heard')?.count).toBe(1)
  })

  it('gives the response rate among applications, or null with none', () => {
    expect(funnel(jobs, history).responseRate).toBeCloseTo(2 / 3)
    expect(funnel([makeJob()], []).responseRate).toBeNull()
  })
})

it('daysToResponse needs both dates', () => {
  expect(daysToResponse({ applied_at: '2026-10-02T12:00:00Z', first_response_at: '2026-10-04T00:00:00Z' })).toBe(1.5)
  expect(daysToResponse({ applied_at: '2026-10-02T12:00:00Z', first_response_at: null })).toBeNull()
  expect(daysToResponse({ applied_at: null, first_response_at: '2026-10-04T00:00:00Z' })).toBeNull()
})

describe('deriveOutcome', () => {
  it.each([
    [[], 'no_reply'],
    [['new', 'applied'], 'no_reply'],
    [['applied', 'rejected'], 'rejected'],
    [['applied', 'exam', 'rejected'], 'exam'],
    [['applied', 'exam', 'interview', 'rejected'], 'interview'], // an interview, even though it ended in a rejection
    [['applied', 'interview', 'offer'], 'offer'],
  ] as [JobStatus[], string][])('%j -> %s', (statuses, outcome) => {
    expect(deriveOutcome(new Set(statuses))).toBe(outcome)
  })
})

describe('applications', () => {
  it('keeps the jobs you applied to, with outcomes from the history and current status', () => {
    const apps = applications([
      makeJob({ external_id: 'new', status: 'new' }),
      makeJob({ external_id: 'skip', status: 'skip' }),
      makeJob({ external_id: 'waiting', status: 'applied' }),
      makeJob({ external_id: 'imported', status: 'rejected' }), // no history
      makeJob({
        external_id: 'interviewed', status: 'rejected',
        applied_at: '2026-10-01T00:00:00Z', first_response_at: '2026-10-04T00:00:00Z',
      }),
    ], [
      change('interviewed', 'applied', '2026-10-01T00:00:00Z', 'new'),
      change('interviewed', 'interview', '2026-10-04T00:00:00Z', 'applied'),
      change('interviewed', 'rejected', '2026-10-09T00:00:00Z', 'interview'),
    ])
    expect(apps.map((a) => [a.job.external_id, a.outcome, a.days])).toEqual([
      ['waiting', 'no_reply', null],
      ['imported', 'rejected', null],
      ['interviewed', 'interview', 3],
    ])
  })
})

let nextId = 0
/** An application with the given fields, reaching `stages` (its current status is the last one). */
const app = (stages: JobStatus[], fields: Partial<Job> = {}, n = 1) =>
  Array.from({ length: n }, () => {
    const job = makeJob({ external_id: String(nextId++), status: stages.at(-1)!, ...fields })
    return { job, reached: new Set(stages), outcome: deriveOutcome(new Set(stages)), days: daysToResponse(job) }
  })

describe('breakdown', () => {
  const timed = (days: number) => ({
    applied_at: '2026-10-01T00:00:00Z',
    first_response_at: new Date(Date.parse('2026-10-01T00:00:00Z') + days * 86_400_000).toISOString(),
  })
  const apps = [
    ...app(['applied'], { channel: 'job_board' }, 8),
    ...app(['applied', 'rejected'], { channel: 'job_board', ...timed(10) }, 2),
    ...app(['applied', 'interview'], { channel: 'job_board', ...timed(4) }, 2),
    ...app(['applied', 'exam', 'interview', 'offer'], { channel: 'referral', ...timed(2) }),
    ...app(['applied', 'exam'], { channel: 'referral' }), // a response without dates
    ...app(['applied'], { channel: 'unknown' }, 20),
  ]

  it('counts responses and interviews per value, most applications first and unknown last', () => {
    const { rows } = breakdown(apps, 'channel')
    expect(rows.map((r) => r.key)).toEqual(['job_board', 'referral', 'unknown'])
    expect(rows[0]).toMatchObject({
      applications: 12, responses: 4, responseRate: 4 / 12, interviews: 2, interviewRate: 2 / 12,
      medianDays: 7, timedResponses: 4, lowSample: false,
    })
    expect(rows[1]).toMatchObject({
      applications: 2, responses: 2, responseRate: 1, interviews: 1, medianDays: 2, timedResponses: 1, lowSample: true,
    })
    expect(rows[2]).toMatchObject({ applications: 20, responses: 0, responseRate: 0, medianDays: null })
  })

  it('gives the total across every value', () => {
    expect(breakdown(apps, 'channel').total).toMatchObject({ key: 'all', applications: 34, responses: 6, interviews: 3 })
  })

  it('flags groups with fewer than MIN_SAMPLE applications', () => {
    const rows = breakdown([...app(['applied'], { role_type: 'ai' }, MIN_SAMPLE - 1), ...app(['applied'], { role_type: 'web' }, MIN_SAMPLE)], 'role_type').rows
    expect(rows.map((r) => [r.key, r.lowSample])).toEqual([['web', false], ['ai', true]])
  })

  it('handles no applications', () => {
    const { rows, total } = breakdown([], 'work_setup')
    expect(rows).toEqual([])
    expect(total).toMatchObject({ applications: 0, responseRate: 0, interviewRate: 0, medianDays: null, lowSample: true })
  })
})

describe('dropOff', () => {
  it('splits each stage into progressed, rejected, waiting and other', () => {
    const stages = dropOff([
      ...app(['applied', 'exam']), // waiting at the exam
      ...app(['applied', 'exam', 'rejected']),
      ...app(['applied', 'exam', 'skip']), // withdrew
      ...app(['applied', 'exam', 'interview']), // progressed, now waiting at the interview
      ...app(['applied', 'exam', 'interview', 'offer']),
      ...app(['applied', 'interview', 'rejected']),
      ...app(['applied', 'offer']), // imported: an offer implies an interview
      ...app(['applied', 'rejected']), // never reached either
    ])
    expect(stages).toEqual([
      { stage: 'exam', reached: 5, progressed: 2, rejected: 1, waiting: 1, other: 1 },
      { stage: 'interview', reached: 4, progressed: 2, rejected: 1, waiting: 1, other: 0 },
    ])
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
