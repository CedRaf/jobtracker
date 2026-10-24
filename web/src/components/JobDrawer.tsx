import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  App, Button, Collapse, Descriptions, Divider, Drawer, Flex, Grid, Input, Skeleton, Space, Typography,
} from 'antd'
import { ExportOutlined, FormOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { Job, JobPatch } from '../data/types'
import { jobKeyString } from '../data/types'
import { useJobDescription, useUpdateJob } from '../data/hooks'
import { dateTime, errorText, fromNow, sourceLabel } from '../lib/format'
import { SHOW_MATCH_SCORE } from '../lib/settings'
import { CompanyAvatar } from './CompanyAvatar'
import { DraftEmailButton } from './DraftEmail'
import { StatusSelect } from './StatusControl'
import { useChangeStatus } from './useChangeStatus'
import { EntryLevelTag, FlagTags, SkillTags } from './Tags'
import { useEntryLevel } from '../lib/entryLevel'

interface Props {
  job: Job | null
  onClose: () => void
  /** Where the job sits in the table's current order, for previous/next. */
  position?: { index: number; total: number }
  onPrev?: () => void
  onNext?: () => void
}

/** True when a key press is typing into a field rather than a shortcut. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function JobDrawer({ job, onClose, position, onPrev, onNext }: Props) {
  const screens = Grid.useBreakpoint()
  const { modal } = App.useApp()
  const dirty = useRef(false)

  // Leaving with unsaved notes or skip reason asks first.
  const guarded = (action?: () => void) => () => {
    if (!action) return
    if (!dirty.current) return action()
    modal.confirm({
      title: 'Discard unsaved changes?',
      content: 'Your notes or skip reason for this job haven’t been saved.',
      okText: 'Discard',
      okButtonProps: { danger: true },
      cancelText: 'Keep editing',
      onOk: () => {
        dirty.current = false
        action()
      },
    })
  }
  const hasPrev = !!position && position.index > 0
  const hasNext = !!position && position.index >= 0 && position.index < position.total - 1
  const prev = guarded(hasPrev ? onPrev : undefined)
  const next = guarded(hasNext ? onNext : undefined)

  // j / k step through the list while the drawer is open.
  const keys = useRef({ prev, next })
  useEffect(() => {
    keys.current = { prev, next }
  })
  const open = job !== null
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (e.key === 'j') keys.current.next()
      if (e.key === 'k') keys.current.prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <Drawer
      open={open}
      onClose={guarded(onClose)}
      size={screens.md ? 720 : '100%'}
      destroyOnHidden
      title={job?.title}
      extra={job && (
        <Button href={job.url} target="_blank" rel="noreferrer" icon={<ExportOutlined />}
          aria-label={screens.sm ? undefined : 'Open listing'}>
          {screens.sm && 'Open listing'}
        </Button>
      )}
      footer={position && position.index >= 0 && (
        <Flex justify="space-between" align="center">
          <Button icon={<LeftOutlined />} disabled={!hasPrev} onClick={prev}>Previous</Button>
          <Typography.Text type="secondary" className="tabular">
            {position.index + 1} of {position.total}
            {screens.md && <span aria-hidden> · j / k</span>}
          </Typography.Text>
          <Button disabled={!hasNext} onClick={next}>Next <RightOutlined /></Button>
        </Flex>
      )}
    >
      {/* Keyed so the edit form resets when another job is opened. */}
      {job && <JobDetails key={jobKeyString(job)} job={job} onDirtyChange={(d) => { dirty.current = d }} />}
    </Drawer>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>{title}</Typography.Text>
      {children}
    </div>
  )
}

function JobDetails({ job, onDirtyChange }: { job: Job; onDirtyChange: (dirty: boolean) => void }) {
  const description = useJobDescription(job)
  const screens = Grid.useBreakpoint()
  const details = (
    <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered
      items={[
        { label: 'Arrangement', children: job.work_arrangements.join(', ') || 'Not listed' },
        { label: 'Work type', children: job.work_type ?? '—' },
        { label: 'Salary', children: job.salary_text ?? 'Not shown' },
        { label: 'Apply via', children: job.apply_type ?? '—' },
        { label: 'Posted', children: dateTime(job.posted_at) },
        { label: 'First seen', children: dateTime(job.first_seen) },
        ...(job.seniority ? [{ label: 'Seniority', children: job.seniority }] : []),
        { label: 'Found by', children: job.search_terms.join(', ') || '—', span: 'filled' as const },
      ]}
    />
  )
  const entry = useEntryLevel()(job)

  return (
    <Flex vertical gap={20}>
      <Flex gap={12} align="center">
        <CompanyAvatar company={job.company} size={40} />
        <div style={{ minWidth: 0 }}>
          <Flex gap={8} align="center" wrap>
            <Typography.Text strong>{job.company ?? 'Unknown company'}</Typography.Text>
            <EntryLevelTag level={entry} />
          </Flex>
          <Typography.Text type="secondary">
            {job.location ?? 'No location'} · {sourceLabel(job.source)} · found {fromNow(job.first_seen)}
          </Typography.Text>
          {SHOW_MATCH_SCORE && <Typography.Text type="secondary"> · Match score {job.match_score}</Typography.Text>}
        </div>
      </Flex>

      <EditForm job={job} onDirtyChange={onDirtyChange} />

      {(job.flags.length > 0 || job.matched_skills.length > 0 || job.missing_skills.length > 0) && (
        <Flex vertical gap={12}>
          {job.flags.length > 0 && <Section title="Flags"><FlagTags flags={job.flags} /></Section>}
          <Section title="Your skills it mentions">
            {job.matched_skills.length ? <SkillTags skills={job.matched_skills} /> : '—'}
          </Section>
          {job.missing_skills.length > 0 && (
            <Section title="Other stacks it mentions"><SkillTags skills={job.missing_skills} /></Section>
          )}
        </Flex>
      )}

      {/* Phones fold the details away, so the description isn't pushed below an 8-row table. */}
      {screens.md ? details : (
        <Collapse ghost size="small" items={[{ key: 'details', label: 'Details: salary, arrangement, dates', children: details }]} />
      )}

      <Section title="Apply">
        <Flex vertical gap={8} align="start">
          {job.emails.length > 0 && (
            <Space wrap size={4}>
              {job.emails.map((email) => (
                <Typography.Text key={email} copyable style={{ overflowWrap: 'anywhere' }}>{email}</Typography.Text>
              ))}
            </Space>
          )}
          <Space wrap>
            <DraftEmailButton job={job} />
            {job.apply_link && (
              <Button href={job.apply_link} target="_blank" rel="noreferrer" icon={<FormOutlined />}>
                Application form
              </Button>
            )}
          </Space>
        </Flex>
      </Section>

      <div>
        <Divider titlePlacement="start" style={{ marginTop: 0 }}>Description</Divider>
        {description.isPending ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : description.isError ? (
          <Flex vertical gap={8} align="start">
            <Typography.Text type="danger">Couldn't load the description: {errorText(description.error)}</Typography.Text>
            <Button size="small" onClick={() => description.refetch()}>Try again</Button>
          </Flex>
        ) : (
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxWidth: '72ch', marginBottom: 0 }}>
            {description.data || 'No description was saved for this job.'}
          </Typography.Paragraph>
        )}
      </div>
    </Flex>
  )
}

function EditForm({ job, onDirtyChange }: { job: Job; onDirtyChange: (dirty: boolean) => void }) {
  const { message } = App.useApp()
  const update = useUpdateJob()
  const changeStatus = useChangeStatus()
  const [skipReason, setSkipReason] = useState(job.skip_reason ?? '')
  const [notes, setNotes] = useState(job.notes ?? '')

  const patch: JobPatch = {}
  if (job.status === 'skip' && skipReason !== (job.skip_reason ?? '')) patch.skip_reason = skipReason || null
  if (notes !== (job.notes ?? '')) patch.notes = notes || null
  const dirty = Object.keys(patch).length > 0
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const save = () =>
    update.mutate({ key: job, patch }, {
      onSuccess: () => message.success('Saved'),
      onError: (e) => message.error(`Couldn't save: ${errorText(e)}`),
    })
  const notesId = `notes-${jobKeyString(job)}`

  return (
    <Flex vertical gap={12}>
      <Flex gap={8} wrap align="center">
        <StatusSelect value={job.status} label="Status" width={160} onChange={(s) => changeStatus(job, s)} />
        {job.status === 'skip' && (
          <Input placeholder="Why skip? (helps tune the rules)" aria-label="Skip reason" value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        )}
      </Flex>
      <div>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          <label htmlFor={notesId}>Notes</label>
        </Typography.Text>
        <Input.TextArea id={notesId} placeholder="Contacts, dates, follow-ups" value={notes}
          onChange={(e) => setNotes(e.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} />
      </div>
      {dirty && (
        <Flex gap={8} justify="end">
          <Button onClick={() => {
            setSkipReason(job.skip_reason ?? '')
            setNotes(job.notes ?? '')
          }}>Discard</Button>
          <Button type="primary" loading={update.isPending} onClick={save}>Save</Button>
        </Flex>
      )}
    </Flex>
  )
}
