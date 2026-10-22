import type { FilteredJob } from '../data/types'

/**
 * The rule behind a filter reason, without the specific match, so similar
 * reasons group together:
 *   "seniority title (Senior)"   -> "seniority title"
 *   "6+ years experience"        -> "5+ years experience"
 *   "Hybrid/On-site outside Cebu" -> "hybrid/on-site outside Cebu"
 */
export function reasonGroup(reason: string): string {
  const base = reason.replace(/\s*\(.*\)\s*$/, '').trim()
  if (/^\d+\+ years experience$/.test(base)) return '5+ years experience'
  if (/outside cebu$/i.test(base)) return 'hybrid/on-site outside Cebu'
  return base
}

/** The specific match inside the parentheses, if any. */
export function reasonDetail(reason: string): string | null {
  return reason.match(/\(([^)]*)\)\s*$/)?.[1] ?? null
}

export interface ReasonGroup {
  reason: string
  jobs: FilteredJob[]
}

/** Groups filtered jobs by rule, biggest group first. */
export function groupByReason(jobs: FilteredJob[]): ReasonGroup[] {
  const groups = new Map<string, FilteredJob[]>()
  for (const job of jobs) {
    const key = reasonGroup(job.reason)
    groups.set(key, [...(groups.get(key) ?? []), job])
  }
  return [...groups]
    .map(([reason, jobs]) => ({ reason, jobs }))
    .sort((a, b) => b.jobs.length - a.jobs.length || a.reason.localeCompare(b.reason))
}
