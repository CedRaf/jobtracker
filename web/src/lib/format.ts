import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

/** "3 hours ago" */
export const fromNow = (iso: string | null) => (iso ? dayjs(iso).fromNow() : '—')

/** "Oct 22, 2026 11:24" */
export const dateTime = (iso: string | null) => (iso ? dayjs(iso).format('MMM D, YYYY HH:mm') : '—')

export const sourceLabel = (source: string) => (source === 'linkedin' ? 'LinkedIn' : 'JobStreet')

/** "today 11:04", "yesterday 15:02", "Oct 20 11:04" */
export function dayTime(iso: string | null, now = dayjs()) {
  if (!iso) return '—'
  const d = dayjs(iso)
  const day = d.isSame(now, 'day') ? 'today' : d.isSame(now.subtract(1, 'day'), 'day') ? 'yesterday' : d.format('MMM D')
  return `${day} ${d.format('HH:mm')}`
}

/** An error's message, without the "Error: " prefix String() adds. */
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error
    ? String((error as { message: unknown }).message) : String(error)
