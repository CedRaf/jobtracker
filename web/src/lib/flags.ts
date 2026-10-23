// The scraper prefixes flags with "!" (a concern) or "+" (a good sign).
// Every flag it can emit is listed in FLAG_CATEGORIES (see scraper/rules.py
// evaluate() and scraper.py "!details unavailable"); keep the two in sync.

export type FlagTone = 'warning' | 'positive' | 'neutral'

export function flagTone(flag: string): FlagTone {
  if (flag.startsWith('!')) return 'warning'
  if (flag.startsWith('+')) return 'positive'
  return 'neutral'
}

export const flagLabel = (flag: string) => flag.replace(/^[!+]/, '')

export const FLAG_COLORS: Record<FlagTone, string> = {
  warning: 'orange',
  positive: 'green',
  neutral: 'default',
}

interface FlagCategory {
  key: string
  label: string
  tone: Exclude<FlagTone, 'neutral'>
  match: RegExp
}

/**
 * A fixed set of categories for filtering, so similar flags group together:
 * "!off-stack (PHP)" and "!off-stack (Java)" are both "Off-stack".
 */
export const FLAG_CATEGORIES: FlagCategory[] = [
  { key: 'fresh-grads', label: 'Fresh grads OK', tone: 'positive', match: /^\+fresh grads OK/ },
  { key: 'no-experience', label: 'No experience required', tone: 'positive', match: /^\+no exp required/ },
  { key: 'entry-level', label: 'Entry level', tone: 'positive', match: /^\+entry level/ },
  { key: 'will-train', label: 'Will train', tone: 'positive', match: /^\+will train/ },
  { key: 'honors', label: 'Honors preferred', tone: 'positive', match: /^\+honors preferred/ },
  { key: 'experience', label: '3–4 years experience', tone: 'warning', match: /^!\d+\+ yrs exp/ },
  { key: 'off-stack', label: 'Off-stack', tone: 'warning', match: /^!off-stack/ },
  { key: 'training-bond', label: 'Training bond', tone: 'warning', match: /^!training bond/ },
  { key: 'no-arrangement', label: 'No work arrangement listed', tone: 'warning', match: /^!no work arrangement/ },
  { key: 'previous-employer', label: 'Previous employer', tone: 'warning', match: /^!previous employer/ },
  { key: 'details-unavailable', label: 'Details unavailable', tone: 'warning', match: /^!details unavailable/ },
]

/** The category keys a job's flags fall into. */
export function flagCategories(flags: string[]): Set<string> {
  return new Set(
    flags.flatMap((flag) => FLAG_CATEGORIES.filter((c) => c.match.test(flag)).map((c) => c.key)),
  )
}

/** Options for the flag filter, grouped into good signs and concerns. */
export const flagFilterOptions = [
  { label: 'Good signs', tone: 'positive' as const },
  { label: 'Concerns', tone: 'warning' as const },
].map(({ label, tone }) => ({
  label,
  title: label,
  options: FLAG_CATEGORIES.filter((c) => c.tone === tone).map((c) => ({ value: c.key, label: c.label })),
}))
