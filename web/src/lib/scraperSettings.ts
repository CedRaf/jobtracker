import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import type { JobSource, RemoteSearchSite, ScraperSettings, SourceSchedule } from '../data/types'

// The same checks as scraper/settings.py validate(), so a version saved here
// is never rejected by the scraper (which would then fall back to defaults).

const hasAlnum = (word: string) => /[\p{L}\p{N}]/u.test(word)

/** Trimmed, without blanks, de-duplicated ignoring case (first spelling wins). */
export function cleanWords(words: string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of words ?? []) {
    const word = raw.trim()
    if (word && !seen.has(word.toLowerCase())) {
      seen.add(word.toLowerCase())
      out.push(word)
    }
  }
  return out
}

// ---- Schedule (sources) ---------------------------------------------------------
// The same limits as scraper/settings.py: Manila times on the scheduler's
// 15-minute grid, at most MAX_RUNS_PER_DAY per site, and different start times
// at least MIN_GAP_MINUTES apart (GitHub keeps only one run waiting).

export const MAX_RUNS_PER_DAY = 6
export const MIN_GAP_MINUTES = 30
const START_TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/

/** Every time the scheduler can start a run: 00:00, 00:15, … 23:45. */
export const START_TIMES = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)

export const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Trimmed, de-duplicated and in time order. */
export const cleanTimes = (times: string[]) =>
  [...new Set(times.map((t) => t.trim()))].sort((a, b) => a.localeCompare(b))

/**
 * Each site's saved switch and times over its defaults, like the scraper does.
 * Versions saved before the schedule existed have no "sources" at all.
 */
function normalizeSources(saved: Partial<Record<JobSource, Partial<SourceSchedule>>> | undefined) {
  const out = {} as Record<JobSource, SourceSchedule>
  for (const site of Object.keys(DEFAULT_SETTINGS.sources) as JobSource[]) {
    const fallback = DEFAULT_SETTINGS.sources[site]
    const value = saved?.[site]
    out[site] = {
      enabled: typeof value?.enabled === 'boolean' ? value.enabled : fallback.enabled,
      times: cleanTimes(Array.isArray(value?.times) ? value.times : fallback.times),
    }
  }
  return out
}

export const REMOTE_SEARCH_SITES = Object.keys(DEFAULT_SETTINGS.search.remote_elsewhere) as RemoteSearchSite[]

/**
 * Each site's "also search remote jobs outside Cebu" switch. Versions saved
 * before 2026-11-06 have one switch for every site (search_remote_elsewhere).
 */
function normalizeRemote(search: ScraperSettings['search'] & { search_remote_elsewhere?: boolean }) {
  const saved = search.remote_elsewhere
  const shared = search.search_remote_elsewhere
  const out = {} as Record<RemoteSearchSite, boolean>
  for (const site of REMOTE_SEARCH_SITES) {
    const value = saved?.[site]
    out[site] = typeof value === 'boolean' ? value
      : !saved && typeof shared === 'boolean' ? shared
        : DEFAULT_SETTINGS.search.remote_elsewhere[site]
  }
  return out
}

/** Tidies form values into settings: trimmed words, defaults for optional fields. */
export function normalizeSettings(s: ScraperSettings): ScraperSettings {
  // Versions saved before entry_level existed don't have it.
  const entry = s.entry_level ?? DEFAULT_SETTINGS.entry_level
  return {
    schema: 1,
    search: {
      keywords: cleanWords(s.search.keywords),
      listed_within_days: s.search.listed_within_days,
      max_pages_per_search: s.search.max_pages_per_search,
      radius_km: s.search.radius_km,
      remote_elsewhere: normalizeRemote(s.search),
    },
    entry_level: { title_words: cleanWords(entry.title_words), description_signals: !!entry.description_signals },
    min_match_score: s.min_match_score,
    experience: {
      flag_years: s.experience.flag_years ?? null,
      drop_years: s.experience.drop_years ?? null,
    },
    checks: { ...s.checks },
    title_rules: s.title_rules.map((r) => ({ label: r.label.trim(), enabled: r.enabled, words: cleanWords(r.words) })),
    skills: s.skills.map((k) => ({
      name: k.name.trim(),
      weight: k.weight,
      aliases: cleanWords(k.aliases),
      exclude: cleanWords(k.exclude),
      off_stack: !!k.off_stack,
    })),
    other_stacks: s.other_stacks.map((k) => ({
      name: k.name.trim(),
      aliases: cleanWords(k.aliases),
      off_stack: !!k.off_stack,
    })),
    previous_employers: cleanWords(s.previous_employers),
    sources: normalizeSources(s.sources),
  }
}

const intIn = (value: unknown, low: number, high: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high

function duplicates(names: string[]) {
  const seen = new Set<string>()
  return names.filter((name) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return true
    seen.add(key)
    return false
  })
}

/** Problems that would make the scraper reject the settings, in plain words. Empty = OK. */
export function settingsProblems(raw: ScraperSettings): string[] {
  const s = normalizeSettings(raw)
  const problems: string[] = []
  const words = (list: string[], where: string) => {
    const bad = list.filter((w) => !hasAlnum(w))
    if (bad.length) problems.push(`${where}: "${bad[0]}" has no letters or digits`)
  }

  if (!s.search.keywords.length) problems.push('Search: add at least one keyword')
  words(s.search.keywords, 'Search keywords')
  if (!intIn(s.search.listed_within_days, 1, 30)) problems.push('Search: days back must be 1–30')
  if (!intIn(s.search.max_pages_per_search, 1, 10)) problems.push('Search: pages per search must be 1–10')
  if (!intIn(s.search.radius_km, 1, 500)) problems.push('Search: radius must be 1–500 km')
  if (!intIn(s.min_match_score, 0, 100)) problems.push('Skills: minimum match score must be 0–100')

  const { flag_years: flag, drop_years: drop } = s.experience
  if (flag !== null && !intIn(flag, 1, 15)) problems.push('Experience: "flag at" must be 1–15 years')
  if (drop !== null && !intIn(drop, 1, 15)) problems.push('Experience: "drop at" must be 1–15 years')
  if (flag !== null && drop !== null && flag >= drop) problems.push('Experience: "flag at" must be lower than "drop at"')

  s.title_rules.forEach((r, i) => {
    const name = r.label || `rule ${i + 1}`
    if (!r.label) problems.push(`Title rules: rule ${i + 1} needs a name`)
    if (r.enabled && !r.words.length) problems.push(`Title rules: "${name}" is on but has no words`)
    words(r.words, `Title rule "${name}"`)
  })
  for (const name of duplicates(s.title_rules.map((r) => r.label).filter(Boolean))) {
    problems.push(`Title rules: "${name}" appears twice`)
  }

  const items: [string, { name: string; aliases: string[]; exclude?: string[] }[]][] =
    [['Skills', s.skills], ['Other stacks', s.other_stacks]]
  for (const [section, list] of items) {
    list.forEach((item, i) => {
      const name = item.name || `row ${i + 1}`
      if (!item.name) problems.push(`${section}: row ${i + 1} needs a name`)
      if (!item.aliases.length) problems.push(`${section}: "${name}" needs at least one spelling to match`)
      words([...item.aliases, ...(item.exclude ?? [])], `${section} "${name}"`)
    })
    for (const name of duplicates(list.map((item) => item.name).filter(Boolean))) {
      problems.push(`${section}: "${name}" appears twice`)
    }
  }
  words(s.previous_employers, 'Previous employers')
  words(s.entry_level.title_words, 'Entry-level words')

  // No site names in these messages: the public demo never names a real site.
  const schedules = Object.values(s.sources)
  if (schedules.some((site) => site.times.some((t) => !START_TIME.test(t)))) {
    problems.push('Schedule: times must be on the hour or at :15, :30 or :45')
  }
  if (schedules.some((site) => site.times.length > MAX_RUNS_PER_DAY)) {
    problems.push(`Schedule: at most ${MAX_RUNS_PER_DAY} runs a day per site`)
  }
  const starts = [...new Set(schedules.filter((site) => site.enabled)
    .flatMap((site) => site.times.filter((t) => START_TIME.test(t)).map(toMinutes)))].sort((a, b) => a - b)
  starts.forEach((earlier, i) => {
    // Around the clock too: 23:45 and 00:00 are 15 minutes apart.
    const later = starts[(i + 1) % starts.length]
    const gap = (later - earlier + 1440) % 1440
    if (gap > 0 && gap < MIN_GAP_MINUTES) {
      problems.push(`Schedule: ${clock(earlier)} and ${clock(later)} are less than ${MIN_GAP_MINUTES} minutes apart. `
        + 'Give sites the same time (they then run together) or keep them further apart.')
    }
  })
  return problems
}

const clock = (minutes: number) => START_TIMES[minutes / 15]

/** Which top-level sections differ between two settings, for the history list. */
export function changedSections(before: ScraperSettings, after: ScraperSettings): string[] {
  const sections: [keyof ScraperSettings, string][] = [
    ['search', 'search'], ['entry_level', 'entry-level words'], ['title_rules', 'title rules'], ['checks', 'description checks'],
    ['experience', 'experience'], ['skills', 'skills'], ['min_match_score', 'minimum score'],
    ['other_stacks', 'other stacks'], ['previous_employers', 'previous employers'], ['sources', 'schedule'],
  ]
  return sections
    .filter(([key]) => !sameValue(before[key], after[key]))
    .map(([, label]) => label)
}

/**
 * Deep equality that ignores object key order. Saved settings come back from
 * Postgres jsonb with their keys re-sorted, so comparing JSON strings would see
 * a change where there is none.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((k) => k in y && sameValue(x[k], y[k]))
}
