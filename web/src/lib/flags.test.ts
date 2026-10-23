import { expect, it } from 'vitest'
import { FLAG_CATEGORIES, flagCategories, flagFilterOptions } from './flags'

it('groups flag variants into one category', () => {
  expect(flagCategories(['!off-stack (PHP, Laravel)', '!off-stack (Java)'])).toEqual(new Set(['off-stack']))
  expect(flagCategories(['!3+ yrs exp', '!4+ yrs exp'])).toEqual(new Set(['experience']))
})

// Every flag scraper/rules.py and scraper.py can emit (keep in sync).
it.each([
  ['+fresh grads OK', 'fresh-grads'],
  ['+no exp required', 'no-experience'],
  ['+entry level', 'entry-level'],
  ['+will train', 'will-train'],
  ['+honors preferred', 'honors'],
  ['!3+ yrs exp', 'experience'],
  ['!off-stack (PHP)', 'off-stack'],
  ['!training bond', 'training-bond'],
  ['!no work arrangement listed', 'no-arrangement'],
  ['!previous employer', 'previous-employer'],
  ['!details unavailable', 'details-unavailable'],
])('%s is in category %s', (flag, key) => {
  expect(flagCategories([flag])).toEqual(new Set([key]))
})

it('offers every category once, split into good signs and concerns', () => {
  const offered = flagFilterOptions.flatMap((group) => group.options.map((o) => o.value))
  expect(offered.sort()).toEqual(FLAG_CATEGORIES.map((c) => c.key).sort())
  expect(flagFilterOptions.map((g) => g.label)).toEqual(['Good signs', 'Concerns'])
})
