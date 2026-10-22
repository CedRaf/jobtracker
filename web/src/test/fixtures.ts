import type { Job } from '../data/types'

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    source: 'jobstreet',
    external_id: '1',
    title: 'Junior Developer',
    company: 'Acme',
    location: 'Cebu City, Cebu',
    work_arrangements: ['On-site'],
    work_type: 'Full time',
    salary_text: null,
    seniority: null,
    posted_at: null,
    apply_type: 'JobStreet',
    apply_link: null,
    match_score: 10,
    matched_skills: ['React', 'TypeScript'],
    missing_skills: [],
    flags: [],
    emails: [],
    email_source: null,
    url: 'https://example.com/1',
    search_terms: ['junior developer'],
    status: 'new',
    status_changed_at: null,
    skip_reason: null,
    notes: null,
    email_drafted_at: null,
    first_seen: '2026-10-20T00:00:00Z',
    ...overrides,
  }
}
