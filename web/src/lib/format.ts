import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

/** "3 hours ago" */
export const fromNow = (iso: string | null) => (iso ? dayjs(iso).fromNow() : '—')

/** "Oct 22, 2026 11:24" */
export const dateTime = (iso: string | null) => (iso ? dayjs(iso).format('MMM D, YYYY HH:mm') : '—')

export const sourceLabel = (source: string) => (source === 'linkedin' ? 'LinkedIn' : 'JobStreet')
