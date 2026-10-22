import { describe, expect, it } from 'vitest'
import type { FilteredJob } from '../data/types'
import { groupByReason, reasonDetail, reasonGroup } from './reasons'

describe('reasonGroup', () => {
  it.each([
    ['seniority title (Senior)', 'seniority title'],
    ['seniority title (Lead)', 'seniority title'],
    ['night shift (graveyard)', 'night shift'],
    ['low skill match (score 1)', 'low skill match'],
    ['6+ years experience', '5+ years experience'],
    ['Hybrid outside Cebu', 'hybrid/on-site outside Cebu'],
    ['Hybrid/On-site outside Cebu', 'hybrid/on-site outside Cebu'],
    ['duplicate posting (same title & company)', 'duplicate posting'],
  ])('%s -> %s', (reason, group) => {
    expect(reasonGroup(reason)).toBe(group)
  })
})

it('reasonDetail returns the specific match', () => {
  expect(reasonDetail('seniority title (Senior)')).toBe('Senior')
  expect(reasonDetail('Hybrid outside Cebu')).toBeNull()
})

it('groupByReason puts the biggest group first', () => {
  const job = (external_id: string, reason: string) =>
    ({ external_id, reason }) as FilteredJob
  const groups = groupByReason([
    job('1', 'internship (Intern)'),
    job('2', 'seniority title (Senior)'),
    job('3', 'seniority title (Lead)'),
  ])
  expect(groups.map((g) => [g.reason, g.jobs.length])).toEqual([
    ['seniority title', 2],
    ['internship', 1],
  ])
})
