import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor,
  useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { Alert, Button, Flex, Input, Modal, Segmented, Skeleton, Switch, theme, Typography } from 'antd'
import type { Job, JobSource, JobStatus } from '../data/types'
import { jobKeyString } from '../data/types'
import { useJobs, useUpdateJob } from '../data/hooks'
import { CompanyAvatar } from '../components/CompanyAvatar'
import { JobDrawer } from '../components/JobDrawer'
import { StatusDot } from '../components/StatusControl'
import { useChangeStatus } from '../components/useChangeStatus'
import { errorText, fromNow, sourceLabel } from '../lib/format'
import { STATUS_META } from '../lib/status'
import { useEntryLevel, type EntryLevel } from '../lib/entryLevel'
import { EntryLevelTag } from '../components/Tags'

const OPEN_COLUMNS: JobStatus[] = ['new', 'applied', 'emailed', 'interview', 'offer']
const CLOSED_COLUMNS: JobStatus[] = ['rejected', 'skip']

type SourceFilter = JobSource | 'all'
const SOURCE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'JobStreet', value: 'jobstreet' },
  { label: 'LinkedIn', value: 'linkedin' },
]

/** Most recently moved (or found) first. */
const byRecent = (a: Job, b: Job) =>
  (b.status_changed_at ?? b.first_seen).localeCompare(a.status_changed_at ?? a.first_seen)

export function BoardPage() {
  const jobs = useJobs()
  const change = useChangeStatus()
  const update = useUpdateJob()
  const [source, setSource] = useState<SourceFilter>('all')
  const [showClosed, setShowClosed] = useState(false)
  const [dragging, setDragging] = useState<Job | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [skipping, setSkipping] = useState<Job | null>(null)
  const [skipReason, setSkipReason] = useState('')
  const entryLevelOf = useEntryLevel()

  const all = useMemo(() => jobs.data ?? [], [jobs.data])
  const columns = showClosed ? [...OPEN_COLUMNS, ...CLOSED_COLUMNS] : OPEN_COLUMNS
  const byStatus = useMemo(() => {
    const groups = new Map<JobStatus, Job[]>()
    for (const job of all) {
      if (source !== 'all' && job.source !== source) continue
      groups.set(job.status, [...(groups.get(job.status) ?? []), job])
    }
    for (const list of groups.values()) list.sort(byRecent)
    return groups
  }, [all, source])
  const openJob = all.find((j) => jobKeyString(j) === openKey) ?? null

  // A small move threshold keeps a plain click (open the job) working; on
  // touch, a short press starts a drag so the board can still scroll.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const onDragStart = ({ active }: DragStartEvent) =>
    setDragging(all.find((j) => jobKeyString(j) === active.id) ?? null)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    const job = all.find((j) => jobKeyString(j) === active.id)
    const status = over?.id as JobStatus | undefined
    if (!job || !status || status === job.status) return
    change(job, status)
    if (status === 'skip') {
      setSkipReason(job.skip_reason ?? '')
      setSkipping(job)
    }
  }

  const saveSkipReason = () => {
    const text = skipReason.trim()
    if (skipping && text !== (skipping.skip_reason ?? '')) {
      update.mutate({ key: skipping, patch: { skip_reason: text || null } })
    }
    setSkipping(null)
  }

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="end" wrap gap={12}>
        <div>
          <Typography.Title level={1} style={{ margin: 0 }}>Board</Typography.Title>
          <Typography.Text type="secondary">
            Drag a card to change its status, or open it to change it there.
          </Typography.Text>
        </div>
        <Flex gap={16} align="center" wrap>
          <Segmented options={SOURCE_OPTIONS} value={source} onChange={(v) => setSource(v as SourceFilter)}
            aria-label="Source" />
          <Flex gap={8} align="center">
            <Switch checked={showClosed} onChange={setShowClosed} id="show-closed" size="small" />
            <label htmlFor="show-closed">Show rejected and skipped</label>
          </Flex>
        </Flex>
      </Flex>

      {jobs.isError && (
        <Alert type="error" showIcon title="Couldn't load jobs" description={errorText(jobs.error)}
          action={<Button size="small" onClick={() => jobs.refetch()}>Try again</Button>} />
      )}

      {jobs.isPending ? (
        <Skeleton active />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}>
          <div className="board" role="list" aria-label="Status columns">
            {columns.map((status) => (
              <Column key={status} status={status} jobs={byStatus.get(status) ?? []} entryLevelOf={entryLevelOf}
                onOpen={(job) => setOpenKey(jobKeyString(job))} />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging && <Card job={dragging} entry={entryLevelOf(dragging)} overlay />}
          </DragOverlay>
        </DndContext>
      )}

      <JobDrawer job={openJob} onClose={() => setOpenKey(null)} />

      <Modal
        open={skipping !== null}
        title="Why skip? (optional)"
        okText="Save reason"
        cancelText="No reason"
        onOk={saveSkipReason}
        onCancel={() => setSkipping(null)}
        destroyOnHidden
      >
        <Flex vertical gap={8}>
          <Typography.Text type="secondary" className="clamp-2">{skipping?.title}</Typography.Text>
          <Input autoFocus value={skipReason} aria-label="Skip reason" placeholder="e.g. wants 3 years of Java"
            onChange={(e) => setSkipReason(e.target.value)} onPressEnter={saveSkipReason} />
          <Typography.Text type="secondary">Reasons help you tune the rules.</Typography.Text>
        </Flex>
      </Modal>
    </Flex>
  )
}

function Column({ status, jobs, onOpen, entryLevelOf }: {
  status: JobStatus
  jobs: Job[]
  onOpen: (job: Job) => void
  entryLevelOf: (job: Job) => EntryLevel
}) {
  const { token } = theme.useToken()
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${STATUS_META[status].label}: ${jobs.length} jobs`}
      className="board-column"
      style={{
        background: isOver ? token.colorPrimaryBg : token.colorFillQuaternary,
        border: `1px solid ${isOver ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
      }}
    >
      <Flex gap={8} align="center" style={{ padding: '10px 12px 6px' }}>
        <StatusDot status={status} />
        <Typography.Text strong>{STATUS_META[status].label}</Typography.Text>
        <Typography.Text type="secondary" className="tabular">{jobs.length}</Typography.Text>
      </Flex>
      <div className="board-column-body">
        {jobs.length === 0 ? (
          <Typography.Text type="secondary" style={{ display: 'block', padding: '12px 4px', fontSize: 13 }}>
            Drop jobs here
          </Typography.Text>
        ) : (
          jobs.map((job) => <DraggableCard key={jobKeyString(job)} job={job} entry={entryLevelOf(job)} onOpen={onOpen} />)
        )}
      </div>
    </section>
  )
}

function DraggableCard({ job, entry, onOpen }: { job: Job; entry: EntryLevel; onOpen: (job: Job) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: jobKeyString(job) })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // dnd-kit's keyboard sensor uses Space/Enter to pick up; Enter opens the job instead.
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(job)
        else listeners?.onKeyDown?.(e)
      }}
      onClick={() => onOpen(job)}
      aria-label={`${job.title}, ${job.company ?? 'unknown company'}. Enter to open, Space to move.`}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: 'manipulation' }}
    >
      <Card job={job} entry={entry} />
    </div>
  )
}

function Card({ job, entry, overlay }: { job: Job; entry: EntryLevel; overlay?: boolean }) {
  const { token } = theme.useToken()
  return (
    <div
      className="board-card"
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        boxShadow: overlay ? token.boxShadowSecondary : undefined,
        cursor: overlay ? 'grabbing' : 'grab',
      }}
    >
      <Flex gap={10} align="start">
        <CompanyAvatar company={job.company} size={28} />
        <Flex vertical gap={2} style={{ minWidth: 0 }}>
          <Typography.Text strong className="clamp-2" style={{ fontSize: 13 }}>{job.title}</Typography.Text>
          <Typography.Text type="secondary" className="clamp-2" style={{ fontSize: 12 }}>
            {job.company ?? 'Unknown company'} · {job.location ?? 'No location'}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {sourceLabel(job.source)} · {fromNow(job.status_changed_at ?? job.first_seen)}
          </Typography.Text>
          {entry && <div style={{ marginTop: 2 }}><EntryLevelTag level={entry} /></div>}
        </Flex>
      </Flex>
    </div>
  )
}
