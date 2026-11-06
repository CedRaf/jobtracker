import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import type { ScraperSettings } from '../data/types'
import {
  changedSections, cleanTimes, cleanWords, normalizeSettings, sameValue, settingsProblems, START_TIMES,
} from './scraperSettings'

describe('schedule (sources)', () => {
  const withSources = (change: (s: ScraperSettings) => void) => {
    const copy = structuredClone(DEFAULT_SETTINGS)
    change(copy)
    return copy
  }

  it('fills the schedule for versions saved before it existed', () => {
    const old: Partial<ScraperSettings> = structuredClone(DEFAULT_SETTINGS)
    delete old.sources
    expect(normalizeSettings(old as ScraperSettings).sources).toEqual(DEFAULT_SETTINGS.sources)
  })

  it('keeps saved values over each site’s defaults and sorts the times', () => {
    const s = withSources((x) => { x.sources.linkedin = { enabled: false, times: ['15:00', ' 09:30', '15:00'] } })
    expect(normalizeSettings(s).sources.linkedin).toEqual({ enabled: false, times: ['09:30', '15:00'] })
    expect(normalizeSettings(s).sources.jobstreet).toEqual(DEFAULT_SETTINGS.sources.jobstreet)
  })

  it('applies the old shared remote switch to each site', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as ScraperSettings & { search: { search_remote_elsewhere?: boolean } }
    delete (old.search as Partial<ScraperSettings['search']>).remote_elsewhere
    old.search.search_remote_elsewhere = false
    const { search } = normalizeSettings(old)
    expect(search.remote_elsewhere).toEqual({ jobstreet: false, linkedin: false })
    expect(search).not.toHaveProperty('search_remote_elsewhere')
  })

  it('keeps each site’s remote switch, with defaults for missing sites', () => {
    const s = withSources((x) => { x.search.remote_elsewhere = { linkedin: false } as ScraperSettings['search']['remote_elsewhere'] })
    expect(normalizeSettings(s).search.remote_elsewhere).toEqual({ jobstreet: true, linkedin: false })
  })

  it('offers every 15-minute start time of the day', () => {
    expect(START_TIMES).toHaveLength(96)
    expect([START_TIMES[0], START_TIMES[1], START_TIMES[95]]).toEqual(['00:00', '00:15', '23:45'])
    expect(cleanTimes(['15:00', '09:00', '15:00'])).toEqual(['09:00', '15:00'])
  })

  it.each([
    ['off the 15-minute grid', (s: ScraperSettings) => { s.sources.linkedin.times = ['11:10'] }, 'on the hour or at :15'],
    ['too many runs', (s: ScraperSettings) => { s.sources.linkedin.times = START_TIMES.filter((_, i) => i % 12 === 0) },
      'at most 6 runs'],
    ['times too close', (s: ScraperSettings) => { s.sources.linkedin.times = ['11:15'] },
      '11:00 and 11:15 are less than 30 minutes apart'],
    ['too close around midnight', (s: ScraperSettings) => {
      s.sources.jobstreet.times = ['23:45']
      s.sources.linkedin.times = ['00:00']
      s.sources.himalayas.times = []
    }, '23:45 and 00:00'],
  ])('rejects %s', (_label, change, message) => {
    expect(settingsProblems(withSources(change)).join('\n')).toContain(message)
  })

  it('lets sites share a time, be 30 minutes apart, or sit inside the gap while switched off', () => {
    expect(settingsProblems(withSources((s) => {
      s.sources.jobstreet.times = ['11:00']
      s.sources.linkedin.times = ['11:30']
      s.sources.himalayas = { enabled: false, times: ['11:15'] }
    }))).toEqual([])
  })

  it('never names a site in its messages', () => {
    const problems = settingsProblems(withSources((s) => { s.sources.himalayas.times = ['11:15'] }))
    expect(problems.join(' ')).not.toMatch(/jobstreet|linkedin|himalayas/i)
  })

  it('reports a schedule change in the history', () => {
    expect(changedSections(DEFAULT_SETTINGS, withSources((s) => { s.sources.linkedin.enabled = false })))
      .toEqual(['schedule'])
  })
})

const withChanges = (change: (s: ScraperSettings) => void) => {
  const copy = structuredClone(DEFAULT_SETTINGS)
  change(copy)
  return copy
}

it('cleanWords trims, drops blanks and de-duplicates ignoring case', () => {
  expect(cleanWords([' React ', 'react', '', 'Vue'])).toEqual(['React', 'Vue'])
})

it('normalizeSettings fills optional skill fields', () => {
  const s = normalizeSettings(DEFAULT_SETTINGS)
  expect(s.skills.every((k) => Array.isArray(k.exclude) && typeof k.off_stack === 'boolean')).toBe(true)
})

describe('settingsProblems', () => {
  it('accepts the defaults', () => {
    expect(settingsProblems(DEFAULT_SETTINGS)).toEqual([])
  })

  it.each([
    ['no keywords', (s: ScraperSettings) => { s.search.keywords = ['  '] }, 'add at least one keyword'],
    ['days out of range', (s: ScraperSettings) => { s.search.listed_within_days = 0 }, 'days back'],
    ['flag not below drop', (s: ScraperSettings) => { s.experience = { flag_years: 5, drop_years: 5 } }, 'lower than'],
    ['enabled rule without words', (s: ScraperSettings) => { s.title_rules[0].words = [] }, 'is on but has no words'],
    ['duplicate rule names', (s: ScraperSettings) => { s.title_rules[1].label = 'Seniority Title' }, 'appears twice'],
    ['skill without spellings', (s: ScraperSettings) => { s.skills[0].aliases = [] }, 'needs at least one spelling'],
    ['skill without name', (s: ScraperSettings) => { s.skills[0].name = ' ' }, 'needs a name'],
    ['punctuation-only word', (s: ScraperSettings) => { s.other_stacks[0].aliases = ['--'] }, 'no letters or digits'],
  ])('reports %s', (_, change, message) => {
    expect(settingsProblems(withChanges(change)).join('\n')).toContain(message)
  })

  it('allows a switched-off rule with no words, and "never" for experience', () => {
    expect(settingsProblems(withChanges((s) => {
      s.title_rules[0] = { ...s.title_rules[0], enabled: false, words: [] }
      s.experience = { flag_years: null, drop_years: null }
    }))).toEqual([])
  })
})

it('changedSections lists what differs', () => {
  const after = withChanges((s) => {
    s.search.listed_within_days = 7
    s.previous_employers = ['Acme']
  })
  expect(changedSections(DEFAULT_SETTINGS, after)).toEqual(['search', 'previous employers'])
})

it('sameValue ignores key order but not values', () => {
  expect(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true)
  expect(sameValue({ a: 1 }, { a: 2 })).toBe(false)
  expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  expect(sameValue([1, 2], [2, 1])).toBe(false)
  expect(sameValue({ a: null }, { a: undefined })).toBe(false)
})

it('changedSections sees no change when only key order differs (as jsonb returns it)', () => {
  const reordered = withChanges((s) => {
    s.search = Object.fromEntries(Object.entries(s.search).reverse()) as ScraperSettings['search']
    s.checks = Object.fromEntries(Object.entries(s.checks).reverse()) as ScraperSettings['checks']
  })
  expect(changedSections(DEFAULT_SETTINGS, reordered)).toEqual([])
})
