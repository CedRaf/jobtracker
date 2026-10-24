import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import type { ScraperSettings } from '../data/types'

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

/** Tidies form values into settings: trimmed words, defaults for optional fields. */
export function normalizeSettings(s: ScraperSettings): ScraperSettings {
  // Versions saved before entry_level existed don't have it.
  const entry = s.entry_level ?? DEFAULT_SETTINGS.entry_level
  return {
    schema: 1,
    search: { ...s.search, keywords: cleanWords(s.search.keywords) },
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
  return problems
}

/** Which top-level sections differ between two settings, for the history list. */
export function changedSections(before: ScraperSettings, after: ScraperSettings): string[] {
  const sections: [keyof ScraperSettings, string][] = [
    ['search', 'search'], ['entry_level', 'entry-level words'], ['title_rules', 'title rules'], ['checks', 'description checks'],
    ['experience', 'experience'], ['skills', 'skills'], ['min_match_score', 'minimum score'],
    ['other_stacks', 'other stacks'], ['previous_employers', 'previous employers'],
  ]
  return sections
    .filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(([, label]) => label)
}
