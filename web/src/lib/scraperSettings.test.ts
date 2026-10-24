import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import type { ScraperSettings } from '../data/types'
import { changedSections, cleanWords, normalizeSettings, settingsProblems } from './scraperSettings'

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
