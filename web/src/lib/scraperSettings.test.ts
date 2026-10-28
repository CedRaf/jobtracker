import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import type { ScraperSettings } from '../data/types'
import { changedSections, cleanWords, normalizeSettings, sameValue, settingsProblems } from './scraperSettings'

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
