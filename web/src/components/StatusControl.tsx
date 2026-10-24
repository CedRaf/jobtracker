import { useState } from 'react'
import { Button, Flex, Input, Popover, Select, theme, Typography } from 'antd'
import type { Job, JobStatus } from '../data/types'
import { useUpdateJob } from '../data/hooks'
import { STATUS_META, statusDotColor, statusOptions } from '../lib/status'
import { useChangeStatus } from './useChangeStatus'

export function StatusDot({ status }: { status: JobStatus }) {
  const { token } = theme.useToken()
  return (
    <span aria-hidden style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: statusDotColor(status, token),
    }} />
  )
}

interface SelectProps {
  value: JobStatus
  onChange: (status: JobStatus) => void
  label: string
  size?: 'small' | 'middle'
  width?: number | string
}

/** A status picker whose value and options carry the status colour. */
export function StatusSelect({ value, onChange, label, size = 'middle', width = 140 }: SelectProps) {
  const withDot = (status: JobStatus) => (
    <Flex gap={8} align="center"><StatusDot status={status} />{STATUS_META[status].label}</Flex>
  )
  return (
    <Select<JobStatus>
      size={size}
      value={value}
      onChange={onChange}
      aria-label={label}
      style={{ width }}
      options={statusOptions.map((o) => ({ ...o, title: o.label, label: withDot(o.value) }))}
      labelRender={({ value: v }) => withDot(v as JobStatus)}
    />
  )
}

/** The status control in a table row: picking Skip asks for an optional reason. */
interface CellProps {
  job: Job
  size?: 'small' | 'middle'
  width?: number | string
  /** Called after a new status is picked. */
  onChanged?: (job: Job) => void
  /** Phones: a New job gets three big buttons (Applied / Emailed / Skip) instead of the 7-option select. */
  quick?: boolean
}

/** The three outcomes of triaging a new job. */
const TRIAGE: JobStatus[] = ['applied', 'emailed', 'skip']

export function StatusCell({ job, size, width, onChanged, quick }: CellProps) {
  const change = useChangeStatus()
  const update = useUpdateJob()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState(job.skip_reason ?? '')

  const pick = (status: JobStatus) => {
    change(job, status)
    onChanged?.(job)
    if (status === 'skip') setAsking(true)
  }

  const saveReason = () => {
    const text = reason.trim()
    if (text !== (job.skip_reason ?? '')) update.mutate({ key: job, patch: { skip_reason: text || null } })
    setAsking(false)
  }

  return (
    // Stop clicks and keys reaching the row, which would open the drawer.
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Popover
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        trigger="click"
        placement="bottomRight"
        title="Why skip? (optional)"
        content={
          <Flex vertical gap={8} style={{ width: 260 }}>
            <Input autoFocus value={reason} aria-label="Skip reason" placeholder="e.g. wants 3 years of Java"
              onChange={(e) => setReason(e.target.value)} onPressEnter={saveReason}
              onKeyDown={(e) => e.key === 'Escape' && setAsking(false)} />
            <Typography.Text type="secondary">Reasons help you tune the rules.</Typography.Text>
            <Flex gap={8} justify="end">
              <Button size="small" onClick={() => setAsking(false)}>No reason</Button>
              <Button size="small" type="primary" onClick={saveReason}>Save reason</Button>
            </Flex>
          </Flex>
        }
      >
        {quick && job.status === 'new' ? (
          <Flex gap={8} role="group" aria-label={`Triage ${job.title}`}>
            {TRIAGE.map((status) => (
              <Button key={status} onClick={() => pick(status)} style={{ flex: 1, height: 40 }}
                aria-label={`Mark ${job.title} as ${STATUS_META[status].label}`}>
                <StatusDot status={status} />{STATUS_META[status].label}
              </Button>
            ))}
          </Flex>
        ) : (
          <span>
            <StatusSelect value={job.status} size={size} width={width} label={`Status of ${job.title}`} onChange={pick} />
          </span>
        )}
      </Popover>
    </div>
  )
}
