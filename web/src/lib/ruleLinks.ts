import type { ScraperSettings } from '../data/types'

/** Where a filter reason's rule is edited on the Rules page. */
export interface RuleLocation {
  tab: 'search' | 'titles' | 'checks' | 'skills'
  /** A title rule's name, to scroll to and highlight. */
  rule?: string
}

/** Groups (see reasonGroup) that come from fixed checks rather than title rules. */
const FIXED: Record<string, RuleLocation> = {
  'night shift': { tab: 'checks' },
  'US/foreign hours': { tab: 'checks' },
  'language requirement': { tab: 'checks' },
  '5+ years experience': { tab: 'checks' },
  'hybrid/on-site outside Cebu': { tab: 'search' },
  'low skill match': { tab: 'skills' },
}

/** The Rules page spot for a reason group, or null when no setting controls it. */
export function ruleLocation(group: string, settings: ScraperSettings | undefined): RuleLocation | null {
  if (FIXED[group]) return FIXED[group]
  const rule = settings?.title_rules.find((r) => r.label.trim().toLowerCase() === group.toLowerCase())
  return rule ? { tab: 'titles', rule: rule.label } : null
}

export function rulesHref(location: RuleLocation): string {
  const params = new URLSearchParams({ tab: location.tab })
  if (location.rule) params.set('rule', location.rule)
  return `/rules?${params}`
}

/** The Filtered page, opened on one rule's group. */
export const filteredHref = (group: string, days: number) =>
  `/filtered?${new URLSearchParams({ days: String(days), rule: group })}`
