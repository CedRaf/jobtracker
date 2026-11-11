// Mirrors supabase/migrations/*.sql. Keep the two in sync (scraper/tests/test_migrations.py
// checks the enums).

/** The job sites the scraper searches. */
export type JobSource = 'jobstreet' | 'linkedin' | 'himalayas'
/** Where a job came from: a scraped site, or 'manual' for an application you logged yourself. */
export type JobOrigin = JobSource | 'manual'
/** Sites with a Cebu search that can also search remote jobs outside Cebu (Himalayas only lists remote jobs). */
export type RemoteSearchSite = Exclude<JobSource, 'himalayas'>

export type JobStatus =
  | 'new'
  | 'applied'
  | 'emailed'
  | 'exam'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'skip'
  | 'expired'

export interface JobKey {
  source: JobOrigin
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
  /** Changed only through DataApi.changeStatus / correctStatus / revertStatus. */
  status: JobStatus
  status_changed_at: string | null
  skip_reason: string | null
  notes: string | null
  email_drafted_at: string | null
  first_seen: string
  // How you applied (application tracking). 'unknown' until set.
  channel: ApplicationChannel
  /** A key from resume_versions (DataApi.listResumeVersions). */
  resume_version: string
  role_type: RoleType
  work_setup: WorkSetup
  /** Set by the move to Applied; editable, but not clearable once you applied. */
  applied_at: string | null
  /** Set by the first move to exam/interview/offer/rejected; editable, not clearable after. */
  first_response_at: string | null
}

export type ApplicationChannel = 'unknown' | 'job_board' | 'direct_message' | 'referral' | 'company_site' | 'other'
export type RoleType = 'unknown' | 'web' | 'ai' | 'other'
export type WorkSetup = 'unknown' | 'cebu_onsite' | 'manila_onsite' | 'remote' | 'hybrid'

/** The application fields you can edit. */
export const APPLICATION_FIELDS = [
  'channel', 'resume_version', 'role_type', 'work_setup', 'applied_at', 'first_response_at',
] as const
export type ApplicationFields = Pick<Job, (typeof APPLICATION_FIELDS)[number]>

/** The columns the dashboard may change directly (the database only grants these). The status isn't one. */
export type JobPatch = Partial<Pick<Job, 'skip_reason' | 'notes' | 'email_drafted_at'> & ApplicationFields>

/** Extra details for a status move (public.change_job_status). */
export interface MoveOptions {
  /** Saved with a move to Skip. */
  skipReason?: string | null
  /** How you applied, for a move to Applied. */
  channel?: ApplicationChannel
  /** The day you applied, for a move to Applied (default: now). */
  appliedAt?: string
}

/** A status move's result: the saved job, and the history row Undo reverts. */
export interface MoveResult {
  job: Job
  historyId: number
}

/** An application you log yourself (a referral, a direct message, ...): stored as a 'manual' job. */
export interface NewApplication extends Partial<ApplicationFields> {
  title: string
  company: string | null
  location: string | null
  url: string
  status: JobStatus
  notes: string | null
}

/** A resume variant (the resume_versions table). 'unknown' is always there. */
export interface ResumeVersion {
  key: string
  label: string
}

export interface FilteredJob extends JobKey {
  source: JobSource
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
  /** Keep the job anyway when its title also has one of these (e.g. "developer"). */
  unless?: string[]
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
    /** Per site: also search remote jobs outside Cebu. */
    remote_elsewhere: Record<RemoteSearchSite, boolean>
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
  /** Which job sites run, and when. Read by the scraper and the database scheduler. */
  sources: Record<JobSource, SourceSchedule>
}

/** One job site's on/off switch and start times: Manila time, "HH:MM" on a 15-minute grid. */
export interface SourceSchedule {
  enabled: boolean
  times: string[]
}

/** One request from the database scheduler (public.scraper_dispatches) to start a GitHub run. */
export interface ScraperDispatch {
  /** The scheduled 15-minute slot; null for a run started by hand. */
  slot: string | null
  sources: JobSource[]
  /** GitHub's reply: 204 = run started. Null until the reply arrives, or if it never did. */
  status_code: number | null
  error: string | null
  created_at: string
}

/** One saved version of the settings (the scraper_settings_versions table). The newest is current. */
export interface SettingsVersion {
  version: number
  settings: ScraperSettings
  note: string | null
  created_at: string
}

/** One status change (the status_history table), written by the status functions. */
export interface StatusChange {
  id: number
  job_source: JobOrigin
  job_external_id: string
  from_status: JobStatus | null
  to_status: JobStatus
  changed_at: string
  /** A move you made, a Correct status, or the daily expiry. */
  kind: 'change' | 'correction' | 'expiry'
  /** Set when the change was undone or replaced by a correction: the analytics skip it. */
  reverted_at: string | null
  /** Whether it has a snapshot to undo from (rows from before Undo existed don't). */
  undoable: boolean
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
  /** Display names for the sites, and for applications you logged yourself. */
  sourceLabels: Record<JobOrigin, string>
  listJobs(): Promise<Job[]>
  getDescription(key: JobKey): Promise<string | null>
  updateJob(key: JobKey, patch: JobPatch): Promise<Job>
  /**
   * Moves a job to another status, if the move is allowed (lib/transitions.ts).
   * `from` is the status you saw: refused if the job has moved on since.
   */
  changeStatus(key: JobKey, from: JobStatus, to: JobStatus, options?: MoveOptions): Promise<MoveResult>
  /** Undoes a job's latest status change exactly (the history row's id). */
  revertStatus(historyId: number): Promise<Job>
  /** Sets any status after the fact, replacing the current one in the history. */
  correctStatus(key: JobKey, from: JobStatus, to: JobStatus, options?: Pick<MoveOptions, 'skipReason'>): Promise<MoveResult>
  /** Logs an application no scraper found, as a 'manual' job. */
  logApplication(application: NewApplication): Promise<Job>
  /** Resume variants, 'unknown' first. */
  listResumeVersions(): Promise<ResumeVersion[]>
  /** Adds a resume variant; its key is made from the label. */
  addResumeVersion(label: string): Promise<ResumeVersion>
  /** Filtered-out jobs first seen in the last `days` days. */
  listFilteredJobs(days: number): Promise<FilteredJob[]>
  /** The most recent run for each source (at most one per source). */
  latestScrapeRuns(): Promise<ScrapeRun[]>
  /** Scraper runs started in the last `days` days, newest first. */
  listScrapeRuns(days: number): Promise<ScrapeRun[]>
  /** The scheduler's latest requests to GitHub, newest first. */
  listDispatches(limit: number): Promise<ScraperDispatch[]>
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
