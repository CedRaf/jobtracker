import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATE, fillTemplate, gmailComposeUrl, loadTemplate, saveTemplate } from './emailTemplate'

describe('fillTemplate', () => {
  it('fills the title and company', () => {
    expect(fillTemplate('{title}{at_company} / {company}', { title: 'Junior Dev', company: 'Acme' }))
      .toBe('Junior Dev at Acme / Acme')
  })

  it('leaves out anonymous or missing companies', () => {
    expect(fillTemplate('{title}{at_company}', { title: 'Dev', company: 'Private Advertiser' })).toBe('Dev')
    expect(fillTemplate('{title}{at_company}', { title: 'Dev', company: null })).toBe('Dev')
    expect(fillTemplate('Hello {company}', { title: 'Dev', company: '' })).toBe('Hello your company')
  })
})

describe('gmailComposeUrl', () => {
  it('encodes recipients, subject and body', () => {
    const url = new URL(gmailComposeUrl({ to: ['a@x.test', 'b@x.test'], subject: 'Hi & bye', body: 'Line 1\nLine 2' }))
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/')
    expect(url.searchParams.get('view')).toBe('cm')
    expect(url.searchParams.get('to')).toBe('a@x.test,b@x.test')
    expect(url.searchParams.get('su')).toBe('Hi & bye')
    expect(url.searchParams.get('body')).toBe('Line 1\nLine 2')
    expect(url.searchParams.has('authuser')).toBe(false)
  })

  it('picks the Gmail account when given', () => {
    const url = new URL(gmailComposeUrl({ to: [], subject: '', body: '', account: ' me@gmail.com ' }))
    expect(url.searchParams.get('authuser')).toBe('me@gmail.com')
  })
})

describe('template storage', () => {
  const memory = () => {
    const data = new Map<string, string>()
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  }

  it('round-trips a saved template and defaults when empty or broken', () => {
    const storage = memory()
    expect(loadTemplate(storage)).toEqual(DEFAULT_TEMPLATE)
    saveTemplate({ ...DEFAULT_TEMPLATE, subject: 'Custom' }, storage)
    expect(loadTemplate(storage).subject).toBe('Custom')
    storage.setItem('jobtracker.emailTemplate', '{not json')
    expect(loadTemplate(storage)).toEqual(DEFAULT_TEMPLATE)
  })
})
