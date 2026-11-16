import type { MouseEvent } from 'react'
import { App, Button, theme, Tooltip } from 'antd'
import { StarFilled, StarOutlined } from '@ant-design/icons'
import type { Job } from '../data/types'
import { useUpdateJob } from '../data/hooks'
import { errorText } from '../lib/format'

/**
 * Stars a job to come back to it later, or unstars it. Your own highlight,
 * separate from the scraper's flags. Clicks don't reach the row underneath,
 * so starring from the table doesn't open the job.
 */
export function StarButton({ job, size = 'small', onToggled }: {
  job: Job
  size?: 'small' | 'middle'
  /** Called as soon as the star is toggled (before it's saved). */
  onToggled?: (job: Job) => void
}) {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const update = useUpdateJob()
  const starred = job.starred_at !== null
  const label = starred ? 'Unstar' : 'Star to come back to it'

  const toggle = (e: MouseEvent) => {
    e.stopPropagation()
    onToggled?.(job)
    update.mutate(
      { key: job, patch: { starred_at: starred ? null : new Date().toISOString() } },
      { onError: (err) => message.error(`Couldn't save: ${errorText(err)}`) },
    )
  }

  return (
    <Tooltip title={label}>
      <Button
        type="text"
        size={size}
        aria-label={`${label}: ${job.title}`}
        aria-pressed={starred}
        icon={starred
          ? <StarFilled style={{ color: token.colorWarning }} />
          : <StarOutlined style={{ color: token.colorTextTertiary }} />}
        onClick={toggle}
        // Enter/Space on the button shouldn't also trigger the row's own key handler.
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
      />
    </Tooltip>
  )
}
