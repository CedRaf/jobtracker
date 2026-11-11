import { App, Button } from 'antd'
import type { Job, JobStatus, MoveOptions } from '../data/types'
import { jobKeyString } from '../data/types'
import { useMoveJob, useRevertStatus } from '../data/hooks'
import { errorText } from '../lib/format'
import { STATUS_META } from '../lib/status'
import { canMove } from '../lib/transitions'

const short = (text: string, max = 36) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * Moves a job to an allowed status right away, then offers Undo in a toast.
 * The toast is only a shortcut: the drawer keeps an Undo for a job's latest
 * change for as long as it stays the latest.
 */
export function useChangeStatus() {
  const { message } = App.useApp()
  const move = useMoveJob()
  const revert = useRevertStatus()
  const onError = (e: Error) => message.error(`Couldn't save: ${errorText(e)}`)

  return (job: Job, to: JobStatus, options?: MoveOptions) => {
    if (to === job.status || !canMove(job.status, to)) return
    const key = `status:${jobKeyString(job)}`
    move.mutate({ key: job, from: job.status, to, options }, {
      onError,
      onSuccess: ({ historyId }) =>
        message.open({
          key,
          type: 'success',
          duration: 10,
          content: (
            <span>
              “{short(job.title)}” → {STATUS_META[to].label}
              <Button type="link" size="small" onClick={() => {
                message.destroy(key)
                revert.mutate({ key: job, historyId }, { onError })
              }}>Undo</Button>
            </span>
          ),
        }),
    })
  }
}
