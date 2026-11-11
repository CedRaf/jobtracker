import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  App, Button, Collapse, Descriptions, Divider, Drawer, Flex, Grid, Input, Popover, Select, Skeleton, Space, Tooltip,
  Typography,
} from 'antd'
import {
  EditOutlined, ExportOutlined, FormOutlined, LeftOutlined, RightOutlined, UndoOutlined,
} from '@ant-design/icons'
import type { Job, JobPatch, JobStatus } from '../data/types'
import { jobKeyString } from '../data/types'
import {
  useCorrectStatus, useJobDescription, useRevertStatus, useSourceLabel, useStatusHistory, useUpdateJob,
} from '../data/hooks'
import { STATUS_META } from '../lib/status'
import { CORRECTABLE, undoableChange } from '../lib/transitions'
import { dateTime, errorText, fromNow } from '../lib/format'
import { SHOW_MATCH_SCORE } from '../lib/settings'
import { ApplicationFields } from './ApplicationFields'
import { APPLIED_STATUSES } from '../lib/application'
import { CompanyAvatar } from './CompanyAvatar'
import { DraftEmailButton } from './DraftEmail'
import { StatusDot, StatusSelect } from './StatusControl'
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

const isApplication = (job: Job) => APPLIED_STATUSES.includes(job.status)

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
      extra={job?.url && (
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
  const site = useSourceLabel()

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
            {job.location ?? 'No location'}
            {(site.multi || job.source === 'manual') && ` · ${site.label(job.source)}`}
            {job.source === 'manual' ? ` ${fromNow(job.first_seen)}` : ` · found ${fromNow(job.first_seen)}`}
          </Typography.Text>
          {SHOW_MATCH_SCORE && <Typography.Text type="secondary"> · Match score {job.match_score}</Typography.Text>}
        </div>
      </Flex>

      <EditForm job={job} onDirtyChange={onDirtyChange} />

      {/* Once you've applied (or set something already): how, for the analytics. */}
      {(isApplication(job) || job.channel !== 'unknown' || job.resume_version !== 'unknown') && (
        <ApplicationFields job={job} />
      )}

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
  // Your edit of the saved skip reason; null shows the saved one, which changes
  // with the status (a skip, an undo).
  const [reasonDraft, setReasonDraft] = useState<string | null>(null)
  const skipReason = reasonDraft ?? job.skip_reason ?? ''
  const setSkipReason = (text: string | null) => setReasonDraft(text)
  const [notes, setNotes] = useState(job.notes ?? '')
  // Picking Skip asks for the reason first; both are saved together.
  const [pendingSkip, setPendingSkip] = useState(false)
  const [newSkipReason, setNewSkipReason] = useState('')

  const pick = (status: JobStatus) => {
    if (status === 'skip') {
      setNewSkipReason('')
      setPendingSkip(true)
    } else {
      changeStatus(job, status)
    }
  }
  const confirmSkip = (withReason: boolean) => {
    changeStatus(job, 'skip', { skipReason: withReason ? newSkipReason : null })
    setPendingSkip(false)
  }

  const patch: JobPatch = {}
  if (job.status === 'skip' && skipReason !== (job.skip_reason ?? '')) patch.skip_reason = skipReason || null
  if (notes !== (job.notes ?? '')) patch.notes = notes || null
  const dirty = Object.keys(patch).length > 0
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const save = () =>
    update.mutate({ key: job, patch }, {
      onSuccess: () => {
        setReasonDraft(null)
        message.success('Saved')
      },
      onError: (e) => message.error(`Couldn't save: ${errorText(e)}`),
    })
  const notesId = `notes-${jobKeyString(job)}`

  return (
    <Flex vertical gap={12}>
      <Flex gap={8} wrap align="center">
        <StatusSelect value={job.status} label="Status" width={160} onChange={pick} />
        {job.status === 'skip' && !pendingSkip && (
          <Input placeholder="Why skip? (helps tune the rules)" aria-label="Skip reason" value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        )}
        <StatusHistoryActions job={job} />
      </Flex>
      {pendingSkip && (
        <Flex gap={8} wrap align="center">
          <Input autoFocus placeholder="Why skip? (optional, helps tune the rules)" aria-label="Skip reason"
            value={newSkipReason} onChange={(e) => setNewSkipReason(e.target.value)}
            onPressEnter={() => confirmSkip(true)} style={{ flex: 1, minWidth: 200 }} />
          <Button onClick={() => setPendingSkip(false)}>Cancel</Button>
          <Button onClick={() => confirmSkip(false)}>Skip, no reason</Button>
          <Button type="primary" onClick={() => confirmSkip(true)}>Skip</Button>
        </Flex>
      )}
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
            setSkipReason(null)
            setNotes(job.notes ?? '')
          }}>Discard</Button>
          <Button type="primary" loading={update.isPending} onClick={save}>Save</Button>
        </Flex>
      )}
    </Flex>
  )
}

/**
 * Undo for the job's latest status change, for as long as it stays the latest
 * (the toast is just a shortcut to it), and Correct status for any decision
 * made earlier: it sets any status and replaces the corrected one in the history.
 */
function StatusHistoryActions({ job }: { job: Job }) {
  const { message } = App.useApp()
  const history = useStatusHistory()
  const revert = useRevertStatus()
  const correct = useCorrectStatus()
  const [correcting, setCorrecting] = useState(false)
  const [to, setTo] = useState<JobStatus | null>(null)
  const [reason, setReason] = useState('')
  const latest = undoableChange(job, history.data ?? [])
  const onError = (e: Error) => message.error(`Couldn't save: ${errorText(e)}`)

  const undo = () => {
    if (!latest) return
    // The move's toast (useChangeStatus) offers the same Undo: close it.
    message.destroy(`status:${jobKeyString(job)}`)
    revert.mutate({ key: job, historyId: latest.id }, {
      onSuccess: (saved) => message.success(`Undone: back to ${STATUS_META[saved.status].label}`),
      onError,
    })
  }
  const save = () => {
    if (!to) return
    correct.mutate({ key: job, from: job.status, to, skipReason: to === 'skip' ? reason : null }, {
      onSuccess: () => {
        message.success(`Corrected to ${STATUS_META[to].label}`)
        setCorrecting(false)
      },
      onError,
    })
  }

  return (
    <Flex gap={4} wrap>
      {latest && (
        <Tooltip title={`Back to ${STATUS_META[latest.from_status ?? 'new'].label}, as it was before`}>
          <Button type="text" icon={<UndoOutlined />} loading={revert.isPending} onClick={undo}>
            Undo {STATUS_META[latest.to_status].label}
          </Button>
        </Tooltip>
      )}
      <Popover
        open={correcting}
        onOpenChange={(open) => {
          setCorrecting(open)
          if (open) {
            setTo(null)
            setReason('')
          }
        }}
        trigger="click"
        placement="bottomLeft"
        title="Correct the status"
        content={
          <Flex vertical gap={8} style={{ width: 280 }}>
            <Typography.Text type="secondary">
              For a decision made earlier. The job gets this status, and the history counts it instead of{' '}
              {STATUS_META[job.status].label}.
            </Typography.Text>
            <Select<JobStatus> aria-label="Corrected status" placeholder="Pick the right status" value={to}
              onChange={setTo}
              options={CORRECTABLE.filter((s) => s !== job.status)
                .map((s) => ({ value: s, label: <Flex gap={8} align="center"><StatusDot status={s} />{STATUS_META[s].label}</Flex> }))} />
            {to === 'skip' && (
              <Input placeholder="Why skip? (optional)" aria-label="Skip reason for the correction" value={reason}
                onChange={(e) => setReason(e.target.value)} />
            )}
            {to && ['new', 'skip', 'expired'].includes(to) && APPLIED_STATUSES.includes(job.status) && (
              <Typography.Text type="warning">This clears the applied and response dates.</Typography.Text>
            )}
            <Flex gap={8} justify="end">
              <Button size="small" onClick={() => setCorrecting(false)}>Cancel</Button>
              <Button size="small" type="primary" disabled={!to} loading={correct.isPending} onClick={save}>
                Correct
              </Button>
            </Flex>
          </Flex>
        }
      >
        <Button type="text" icon={<EditOutlined />}>Correct status</Button>
      </Popover>
    </Flex>
  )
}
