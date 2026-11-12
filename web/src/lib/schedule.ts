import { useMemo } from 'react'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import { useSettingsVersions } from '../data/hooks'
import type { JobSource, ScrapeRun, ScraperDispatch, SourceSchedule } from '../data/types'
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

/** GitHub usually starts an accepted run within a minute or two; after this, it didn't. */
const START_WAIT_MS = 30 * 60_000

/**
 * Whether a run started for this request: one that records the request's id,
 * or (for runs before ids were recorded) one of its sites started within
 * START_WAIT_MS of it.
 */
const runStarted = (dispatch: ScraperDispatch, runs: Pick<ScrapeRun, 'source' | 'started_at' | 'dispatch_id'>[]) =>
  runs.some((r) => r.dispatch_id === dispatch.id || (dispatch.sources.includes(r.source)
    && Date.parse(r.started_at) >= Date.parse(dispatch.created_at) - 60_000
    && Date.parse(r.started_at) <= Date.parse(dispatch.created_at) + START_WAIT_MS))

/**
 * Why the scheduler's request didn't start a run, in plain words, or null if
 * it did (or GitHub's reply or the run is still on the way).
 */
export function dispatchProblem(
  dispatch: ScraperDispatch, runs: Pick<ScrapeRun, 'source' | 'started_at' | 'dispatch_id'>[], now = Date.now(),
): string | null {
  const age = now - Date.parse(dispatch.created_at)
  switch (dispatch.status) {
    case 'no_token':
      return dispatch.error ?? 'No GitHub token is set up.'
    case 'failed':
      return dispatch.error
        ?? (dispatch.status_code ? `GitHub replied HTTP ${dispatch.status_code}.` : 'GitHub refused the request.')
    case 'lost':
      return 'GitHub never replied to the request.'
    case 'pending':
      return age > REPLY_WAIT_MS ? 'GitHub never replied to the request.' : null
    case 'accepted':
      return age > START_WAIT_MS && !runStarted(dispatch, runs)
        ? 'GitHub accepted the request, but no run started within 30 minutes.'
        : null
  }
}

/** The current settings' schedule (or the defaults while loading or when nothing is saved). */
export function useSchedule(): Record<JobSource, SourceSchedule> {
  const versions = useSettingsVersions()
  const current = versions.data?.[0]?.settings
  return useMemo(() => normalizeSettings(current ?? DEFAULT_SETTINGS).sources, [current])
}
