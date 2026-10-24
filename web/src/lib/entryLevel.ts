import { useMemo } from 'react'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import { useSettingsVersions } from '../data/hooks'
import type { Job } from '../data/types'
import { normalizeSettings } from './scraperSettings'

/**
 * The same phrase matching as scraper/rules.py phrase_pattern(): case-
 * insensitive whole words, spaces and hyphens interchangeable (or absent),
 * "/" may have spaces around it, longest phrase first.
 */
export function phrasePattern(phrases: string[]): RegExp | null {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = [...new Set(phrases.map((phrase) =>
    phrase.trim().toLowerCase().split(/(\s+|-|\/)/).filter(Boolean).map((part) =>
      /^\s+$/.test(part) || part === '-' ? '[\\s-]*' : part === '/' ? '\\s*/\\s*' : escape(part),
    ).join(''),
  ))].filter(Boolean).sort((a, b) => b.length - a.length)
  return parts.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${parts.join('|')})(?![\\p{L}\\p{N}_])`, 'iu') : null
}

/** Why a job counts as entry-level, or null. */
export type EntryLevel =
  | { kind: 'title'; match: string }
  | { kind: 'description'; signal: string }
  | null

/** Positive flags (from the scraper) that mean the job takes fresh grads or juniors. */
const DESCRIPTION_SIGNALS: Record<string, string> = {
  '+fresh grads OK': 'fresh grads OK',
  '+entry level': 'entry level',
  '+no exp required': 'no experience required',
}

export function entryLevel(
  job: Pick<Job, 'title' | 'flags'>,
  titlePattern: RegExp | null,
  useDescription: boolean,
): EntryLevel {
  const match = titlePattern?.exec(job.title)
  if (match) return { kind: 'title', match: match[0] }
  if (useDescription) {
    const flag = job.flags.find((f) => f in DESCRIPTION_SIGNALS)
    if (flag) return { kind: 'description', signal: DESCRIPTION_SIGNALS[flag] }
  }
  return null
}

/** Sort rank: junior-level title first, then a fresh-grads description, then the rest. */
export const entryRank = (level: EntryLevel) => (level?.kind === 'title' ? 0 : level ? 1 : 2)

export const entryReason = (level: NonNullable<EntryLevel>) =>
  level.kind === 'title' ? `Title says “${level.match}”` : `Description: ${level.signal}`

/** A function telling whether a job is entry-level, using the current Rules settings (or the defaults). */
export function useEntryLevel(): (job: Pick<Job, 'title' | 'flags'>) => EntryLevel {
  const versions = useSettingsVersions()
  const current = versions.data?.[0]?.settings
  return useMemo(() => {
    const { entry_level: settings } = normalizeSettings(current ?? DEFAULT_SETTINGS)
    const pattern = phrasePattern(settings.title_words)
    return (job) => entryLevel(job, pattern, settings.description_signals)
  }, [current])
}
