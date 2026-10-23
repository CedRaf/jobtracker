import { App, Button } from 'antd'
import type { Job, JobStatus } from '../data/types'
import { jobKeyString } from '../data/types'
import { useUpdateJob } from '../data/hooks'
import { errorText } from '../lib/format'
import { STATUS_META } from '../lib/status'

const short = (text: string, max = 36) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Saves a status change right away, then offers Undo for a few seconds. */
export function useChangeStatus() {
  const { message } = App.useApp()
  const update = useUpdateJob()
  const onError = (e: Error) => message.error(`Couldn't save: ${errorText(e)}`)

  return (job: Job, status: JobStatus) => {
    const previous = job.status
    if (status === previous) return
    const key = `status:${jobKeyString(job)}`
    update.mutate({ key: job, patch: { status } }, {
      onError,
      onSuccess: () =>
        message.open({
          key,
          type: 'success',
          duration: 6,
          content: (
            <span>
              “{short(job.title)}” → {STATUS_META[status].label}
              <Button type="link" size="small" onClick={() => {
                message.destroy(key)
                update.mutate({ key: job, patch: { status: previous } }, { onError })
              }}>Undo</Button>
            </span>
          ),
        }),
    })
  }
}
