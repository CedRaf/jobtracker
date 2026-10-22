import { expect, it } from 'vitest'
import { startVisit } from './lastVisit'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

it('returns the previous visit and records this one', () => {
  const storage = memoryStorage()
  expect(startVisit(storage, new Date('2026-10-20T00:00:00Z'))).toBeNull()
  expect(startVisit(storage, new Date('2026-10-22T00:00:00Z'))).toBe('2026-10-20T00:00:00.000Z')
})

it('copes with storage that throws or is missing', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => {} }
  expect(startVisit(broken)).toBeNull()
  expect(startVisit(undefined)).toBeNull()
})
