import { describe, expect, it } from 'vitest'
import { makeJob } from '../test/fixtures'
import { activeFilterCount, applyFilters, DEFAULT_FILTERS, filterOptions, isNewSince, NOT_LISTED, type JobFilters } from './filters'

const ALL: JobFilters = { ...DEFAULT_FILTERS, statuses: [] }

describe('isNewSince', () => {
  it('is new only when first seen after the last visit', () => {
    const job = makeJob({ first_seen: '2026-10-20T12:00:00Z' })
    expect(isNewSince(job, '2026-10-20T11:00:00Z')).toBe(true)
    expect(isNewSince(job, '2026-10-20T13:00:00Z')).toBe(false)
  })

  it('treats nothing as new on a first visit', () => {
    expect(isNewSince(makeJob(), null)).toBe(false)
  })
})

describe('applyFilters', () => {
  const react = makeJob({ external_id: 'a', title: 'React Developer', matched_skills: ['React', 'TypeScript'], match_score: 12 })
  const dotnet = makeJob({ external_id: 'b', title: '.NET Developer', company: 'Harbor', matched_skills: ['C#'], match_score: 6, source: 'linkedin', work_arrangements: [] })
  const skipped = makeJob({ external_id: 'c', status: 'skip', flags: ['!training bond'], notes: 'bond' })
  const jobs = [react, dotnet, skipped]
  const ids = (f: JobFilters, lastVisit: string | null = null) =>
    applyFilters(jobs, f, lastVisit).map((j) => j.external_id)

  it('hides skipped and rejected jobs by default', () => {
    expect(ids(DEFAULT_FILTERS)).toEqual(['a', 'b'])
  })

  it('matches text in title, company, skills and notes, ignoring case', () => {
    expect(ids({ ...ALL, text: 'harbor' })).toEqual(['b'])
    expect(ids({ ...ALL, text: 'typescript' })).toEqual(['a', 'c'])
    expect(ids({ ...ALL, text: 'BOND' })).toEqual(['c'])
  })

  it('filters by source, score, skills and flags', () => {
    expect(ids({ ...ALL, sources: ['linkedin'] })).toEqual(['b'])
    expect(ids({ ...ALL, minScore: 10 })).toEqual(['a', 'c'])
    expect(ids({ ...ALL, skills: ['React', 'TypeScript'] })).toEqual(['a', 'c'])
    expect(ids({ ...ALL, flags: ['!training bond'] })).toEqual(['c'])
  })

  it('treats a blank arrangement as "Not listed"', () => {
    expect(ids({ ...ALL, arrangements: [NOT_LISTED] })).toEqual(['b'])
    expect(ids({ ...ALL, arrangements: ['On-site', 'Remote'] })).toEqual(['a', 'c'])
  })

  it('can show only jobs new since the last visit', () => {
    const recent = makeJob({ external_id: 'd', first_seen: '2026-10-22T00:00:00Z' })
    expect(applyFilters([react, recent], { ...ALL, newOnly: true }, '2026-10-21T00:00:00Z').map((j) => j.external_id))
      .toEqual(['d'])
  })
})

describe('filterOptions', () => {
  it('lists the distinct values present, sorted', () => {
    const options = filterOptions([
      makeJob({ matched_skills: ['React', 'C#'], flags: ['+entry level'] }),
      makeJob({ matched_skills: ['C#'], work_arrangements: [] }),
    ])
    expect(options.skills).toEqual(['C#', 'React'])
    expect(options.flags).toEqual(['+entry level'])
    expect(options.arrangements).toEqual([NOT_LISTED, 'On-site'])
  })
})

describe('activeFilterCount', () => {
  it('counts filters changed from the defaults', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...DEFAULT_FILTERS, text: 'react', minScore: 5 })).toBe(2)
  })
})
