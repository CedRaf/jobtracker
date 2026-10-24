import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import { filteredHref, ruleLocation, rulesHref } from './ruleLinks'

it('finds title rules by name and fixed checks by group', () => {
  const titleRule = DEFAULT_SETTINGS.title_rules[0].label
  expect(ruleLocation(titleRule, DEFAULT_SETTINGS)).toEqual({ tab: 'titles', rule: titleRule })
  expect(ruleLocation('night shift', DEFAULT_SETTINGS)).toEqual({ tab: 'checks' })
  expect(ruleLocation('low skill match', DEFAULT_SETTINGS)).toEqual({ tab: 'skills' })
  expect(ruleLocation('duplicate posting', DEFAULT_SETTINGS)).toBeNull()
})

it('builds links both ways', () => {
  expect(rulesHref({ tab: 'titles', rule: 'seniority title' })).toBe('/rules?tab=titles&rule=seniority+title')
  expect(filteredHref('night shift', 30)).toBe('/filtered?days=30&rule=night+shift')
})
