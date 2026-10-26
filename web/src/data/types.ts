// Mirrors supabase/migrations/*_init.sql. Keep the two in sync.

export type JobSource = 'jobstreet' | 'linkedin'

export type JobStatus =
  | 'new'
  | 'applied'
  | 'emailed'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'skip'

export interface JobKey {
  source: JobSource
  external_id: string
}

/** A kept job, without its (large) description; see DataApi.getDescription. */
export interface Job extends JobKey {
  title: string
  company: string | null
  location: string | null
  work_arrangements: string[]
  work_type: string | null
  salary_text: string | null
  seniority: string | null
  posted_at: string | null
  apply_type: string | null
  apply_link: string | null
  match_score: number
  matched_skills: string[]
  missing_skills: string[]
  flags: string[]
  emails: string[]
  email_source: string | null
  url: string
  search_terms: string[]
  status: JobStatus
  status_changed_at: string | null
  skip_reason: string | null
  notes: string | null
  email_drafted_at: string | null
  first_seen: string
}

/** The columns the dashboard may change (the database only grants these). */
export type JobPatch = Partial<Pick<Job, 'status' | 'skip_reason' | 'notes' | 'email_drafted_at'>>

export interface FilteredJob extends JobKey {
  title: string
  company: string | null
  location: string | null
  work_arrangements: string[]
  search_terms: string[]
  reason: string
  url: string
  first_seen: string
}

/** One scraper run for one source (the scrape_runs table). Counts are null until it finishes. */
export interface ScrapeRun {
  source: JobSource
  started_at: string
  /** Null while running, or forever if the run was cancelled or killed. */
  finished_at: string | null
  found: number | null
  evaluated: number | null
  kept: number | null
  filtered: number | null
  expired: number | null
  /** Null = the run succeeded. */
  error: string | null
  github_run_id: string | null
  /** The scraper settings version the run used; null = the built-in defaults. */
  settings_version: number | null
}

// ---- Scraper settings (mirrors scraper/settings.py; defaults in defaultSettings.json) ----

export type DropOrOff = 'drop' | 'off'

export interface TitleRule {
  label: string
  enabled: boolean
  words: string[]
}

export interface SkillSetting {
  name: string
  /** 3 core, 2 secondary, 1 adjacent */
  weight: 1 | 2 | 3
  aliases: string[]
  /** Phrases that don't count even though they contain an alias ("react native" for React). */
  exclude?: string[]
  off_stack?: boolean
}

export interface StackSetting {
  name: string
  aliases: string[]
  off_stack?: boolean
}

export interface ScraperSettings {
  schema: 1
  search: {
    keywords: string[]
    listed_within_days: number
    max_pages_per_search: number
    radius_km: number
    search_remote_elsewhere: boolean
  }
  /** Dashboard only: which jobs get the Entry-level marker and sort first. Never drops anything. */
  entry_level: {
    title_words: string[]
    /** Also count descriptions flagged "fresh grads OK", "entry level" or "no experience required". */
    description_signals: boolean
  }
  min_match_score: number
  experience: { flag_years: number | null; drop_years: number | null }
  checks: {
    night_shift: DropOrOff
    foreign_hours: DropOrOff
    language_requirement: DropOrOff
    training_bond: 'flag' | 'off'
  }
  title_rules: TitleRule[]
  skills: SkillSetting[]
  other_stacks: StackSetting[]
  previous_employers: string[]
}

/** One saved version of the settings (the scraper_settings_versions table). The newest is current. */
export interface SettingsVersion {
  version: number
  settings: ScraperSettings
  note: string | null
  created_at: string
}

/** One status change, recorded by a database trigger (the status_history table). */
export interface StatusChange {
  job_source: JobSource
  job_external_id: string
  from_status: JobStatus | null
  to_status: JobStatus
  changed_at: string
}

export interface AppUser {
  id: string
  email: string | null
}

export interface DataApi {
  /** True when running on built-in sample data instead of Supabase. */
  demo: boolean
  /** The job sites this deployment shows (the public demo shows one). */
  sources: JobSource[]
  /** Display names for the sites. */
  sourceLabels: Record<JobSource, string>
  listJobs(): Promise<Job[]>
  getDescription(key: JobKey): Promise<string | null>
  updateJob(key: JobKey, patch: JobPatch): Promise<Job>
  /** Filtered-out jobs first seen in the last `days` days. */
  listFilteredJobs(days: number): Promise<FilteredJob[]>
  /** The most recent run for each source (at most one per source). */
  latestScrapeRuns(): Promise<ScrapeRun[]>
  /** Scraper runs started in the last `days` days, newest first. */
  listScrapeRuns(days: number): Promise<ScrapeRun[]>
  /** Every recorded status change, oldest first. */
  listStatusHistory(): Promise<StatusChange[]>
  /** Saved scraper settings, newest (= current) first. */
  listSettingsVersions(): Promise<SettingsVersion[]>
  /** Saves settings as a new version, which the next scraper run uses. */
  saveSettings(settings: ScraperSettings, note: string | null): Promise<SettingsVersion>
  auth: {
    getUser(): Promise<AppUser | null>
    /** Calls back on sign-in/out; returns an unsubscribe function. */
    onChange(callback: (user: AppUser | null) => void): () => void
    signIn(email: string, password: string): Promise<void>
    signOut(): Promise<void>
    /** Whether the signed-in user is listed in app_users (and so can see data). */
    isAppUser(): Promise<boolean>
  }
}

export const jobKeyString = (key: JobKey) => `${key.source}:${key.external_id}`
