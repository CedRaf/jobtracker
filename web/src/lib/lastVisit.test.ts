import { expect, it } from 'vitest'
import { startVisit, touchVisit } from './lastVisit'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

const at = (iso: string) => new Date(iso)

it('returns when the previous visit ended', () => {
  const storage = memoryStorage()
  expect(startVisit(storage, at('2026-10-20T00:00:00Z'))).toBeNull()
  touchVisit(storage, at('2026-10-20T00:10:00Z'))
  expect(startVisit(storage, at('2026-10-22T00:00:00Z'))).toBe('2026-10-20T00:10:00.000Z')
})

it('keeps the same cut-off across a reload within one visit', () => {
  const storage = memoryStorage()
  startVisit(storage, at('2026-10-20T00:00:00Z'))
  expect(startVisit(storage, at('2026-10-22T03:00:00Z'))).toBe('2026-10-20T00:00:00.000Z')
  expect(startVisit(storage, at('2026-10-22T03:05:00Z'))).toBe('2026-10-20T00:00:00.000Z')
})

it('reads the older bare-timestamp format', () => {
  const storage = memoryStorage()
  storage.setItem('jobtracker.lastVisit', '2026-10-20T00:00:00.000Z')
  expect(startVisit(storage, at('2026-10-22T00:00:00Z'))).toBe('2026-10-20T00:00:00.000Z')
})

it('copes with storage that throws or is missing', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => {} }
  expect(startVisit(broken)).toBeNull()
  expect(startVisit(undefined)).toBeNull()
  expect(() => touchVisit(broken)).not.toThrow()
})
