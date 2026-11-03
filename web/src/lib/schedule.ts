import { useMemo } from 'react'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import { useSettingsVersions } from '../data/hooks'
import type { JobSource, ScraperDispatch, SourceSchedule } from '../data/types'
import { normalizeSettings, toMinutes } from './scraperSettings'

// Schedules are Manila time, which has no daylight saving: always UTC+8.
const MANILA_OFFSET_MINUTES = 8 * 60
const DAY_MINUTES = 24 * 60

export interface NextStart {
  /** "HH:MM", Manila time. */
  time: string
  /** False when the next start is tomorrow (every time today has passed). */
  today: boolean
  /** The switched-on sites starting then, in the order given. */
  sources: JobSource[]
}

/**
 * The next scheduled start after `now` among the given sites, or null when
 * none of them is switched on with a time. A start in the current minute
 * counts as still to come.
 */
export function nextStart(
  schedules: Record<JobSource, SourceSchedule>, sources: JobSource[], now = new Date(),
): NextStart | null {
  const manilaNow = (now.getUTCHours() * 60 + now.getUTCMinutes() + MANILA_OFFSET_MINUTES) % DAY_MINUTES
  let best: { at: number; time: string } | null = null
  for (const source of sources) {
    const { enabled, times } = schedules[source]
    if (!enabled) continue
    for (const time of times) {
      const at = (toMinutes(time) - manilaNow + DAY_MINUTES) % DAY_MINUTES
      if (!best || at < best.at) best = { at, time }
    }
  }
  if (!best) return null
  const time = best.time
  return {
    time,
    today: manilaNow + best.at < DAY_MINUTES,
    sources: sources.filter((s) => schedules[s].enabled && schedules[s].times.includes(time)),
  }
}

/** Sites that are switched on and have at least one start time. */
export const scheduledSources = (schedules: Record<JobSource, SourceSchedule>, sources: JobSource[]) =>
  sources.filter((s) => schedules[s].enabled && schedules[s].times.length > 0)

/**
 * GitHub replies within seconds (pg_net gives up after 10), but the reply is
 * only copied into the log by the next 15-minute check.
 */
const REPLY_WAIT_MS = 20 * 60_000

/**
 * Why the scheduler's request didn't start a run, in plain words, or null if
 * it did (or its reply is still on the way).
 */
export function dispatchProblem(dispatch: ScraperDispatch, now = Date.now()): string | null {
  if (dispatch.error) return dispatch.error
  if (dispatch.status_code === null) {
    return now - Date.parse(dispatch.created_at) > REPLY_WAIT_MS ? 'GitHub never replied to the request.' : null
  }
  return dispatch.status_code >= 200 && dispatch.status_code < 300 ? null : `GitHub replied HTTP ${dispatch.status_code}.`
}

/** The current settings' schedule (or the defaults while loading or when nothing is saved). */
export function useSchedule(): Record<JobSource, SourceSchedule> {
  const versions = useSettingsVersions()
  const current = versions.data?.[0]?.settings
  return useMemo(() => normalizeSettings(current ?? DEFAULT_SETTINGS).sources, [current])
}
