import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import { entryLevel, entryRank, entryReason, phrasePattern } from './entryLevel'

const words = DEFAULT_SETTINGS.entry_level.title_words
const pattern = phrasePattern(words)
const check = (title: string, flags: string[] = [], description = true) => entryLevel({ title, flags }, pattern, description)

describe('phrasePattern (same rules as the scraper)', () => {
  it.each([
    ['Junior Developer', 'Junior'],
    ['Jr. React Developer', 'Jr'],
    ['Associate Software Engineer', 'Associate'],
    ['Entry-Level Developer', 'Entry-Level'],
    ['Software Engineer Trainee', 'Trainee'],
    ['Graduate Developer Program', 'Graduate'],
    ['IT Support L1', 'L1'],
    ['Level-1 Support', 'Level-1'],
    ['New Grad Engineer', 'New Grad'],
  ])('%s matches %s', (title, match) => {
    expect(check(title)).toEqual({ kind: 'title', match })
  })

  it.each(['Senior Developer', 'Juniper Networks Engineer', 'Associated Press Writer', 'Level 10 Engineer'])(
    'leaves %s alone', (title) => {
      expect(check(title)).toBeNull()
    },
  )

  it('returns null with no words', () => {
    expect(phrasePattern([])).toBeNull()
  })
})

describe('entryLevel', () => {
  it('falls back to description signals, if switched on', () => {
    expect(check('Software Developer', ['+fresh grads OK'])).toEqual({ kind: 'description', signal: 'fresh grads OK' })
    expect(check('Software Developer', ['+fresh grads OK'], false)).toBeNull()
    expect(check('Software Developer', ['+will train'])).toBeNull() // not about seniority
  })

  it('prefers the title as the reason', () => {
    expect(check('Junior Developer', ['+entry level'])?.kind).toBe('title')
  })

  it('ranks title, then description, then the rest', () => {
    expect([check('Developer'), check('Junior Dev'), check('Dev', ['+entry level'])].map(entryRank)).toEqual([2, 0, 1])
  })

  it('explains itself', () => {
    expect(entryReason(check('Associate Engineer')!)).toBe('Title says “Associate”')
    expect(entryReason(check('Dev', ['+no exp required'])!)).toBe('Description: no experience required')
  })
})
