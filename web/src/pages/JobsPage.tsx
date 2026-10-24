import { useContext, useMemo, useState, type ReactNode } from 'react'
import { Alert, Button, Empty, Flex, Grid, Switch, Table, Tabs, theme, Tooltip, Typography } from 'antd'
import type { TableColumnsType, TableProps } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { Job, JobSource, ScrapeRun } from '../data/types'
import { jobKeyString } from '../data/types'
import { useJobs, useLatestScrapeRuns } from '../data/hooks'
import { CompanyAvatar } from '../components/CompanyAvatar'
import { JobDrawer } from '../components/JobDrawer'
import { JobFiltersBar } from '../components/JobFiltersBar'
import { StatCards } from '../components/StatCards'
import { StatusCell } from '../components/StatusControl'
import { EntryLevelTag, FlagTags, ToneTag } from '../components/Tags'
import { applyFilters, DEFAULT_FILTERS, isNewSince, type JobFilters } from '../lib/filters'
import { flagTone } from '../lib/flags'
import { dateTime, dayTime, errorText, fromNow, sourceLabel } from '../lib/format'
import { entryRank, useEntryLevel, type EntryLevel } from '../lib/entryLevel'
import { LastVisitContext } from '../lib/lastVisit'
import { SHOW_MATCH_SCORE } from '../lib/settings'

const SOURCES: JobSource[] = ['jobstreet', 'linkedin']
const TAB_KEY = 'jobtracker.sourceTab'
const ENTRY_FIRST_KEY = 'jobtracker.entryLevelFirst'

type SortOrder = 'ascend' | 'descend' | null

function initialSource(): JobSource {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (saved === 'jobstreet' || saved === 'linkedin') return saved
  } catch {
    // storage unavailable: use the default
  }
  return 'jobstreet'
}

/** Entry-level jobs sort first unless turned off (remembered per browser). */
function initialEntryFirst() {
  try {
    return localStorage.getItem(ENTRY_FIRST_KEY) !== 'false'
  } catch {
    return true
  }
}

const sameStatuses = (a: string[], b: string[]) => a.length === b.length && a.every((s) => b.includes(s))

export function JobsPage() {
  const jobs = useJobs()
  const runs = useLatestScrapeRuns()
  const lastVisit = useContext(LastVisitContext)
  const screens = Grid.useBreakpoint()
  const [source, setSource] = useState<JobSource>(initialSource)
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_FILTERS)
  const [sortOrder, setSortOrder] = useState<SortOrder>('descend')
  const [entryFirst, setEntryFirst] = useState(initialEntryFirst)
  const entryLevelOf = useEntryLevel()
  const [openKey, setOpenKey] = useState<string | null>(null)
  // Jobs whose status changed in the table stay listed until the filters or
  // tab change, so a row doesn't vanish the moment you mark it Skip.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set())

  const all = useMemo(() => jobs.data ?? [], [jobs.data])
  const inTab = useMemo(() => all.filter((j) => j.source === source), [all, source])
  const shown = useMemo(() => {
    const isEntry = (j: Job) => entryLevelOf(j) !== null
    const matching = new Set(applyFilters(inTab, filters, lastVisit, isEntry).map(jobKeyString))
    const listed = inTab.filter((j) => matching.has(jobKeyString(j)) || kept.has(jobKeyString(j)))
    const direction = sortOrder === 'ascend' ? 1 : -1
    const byDate = (a: Job, b: Job) => (sortOrder ? direction * (Date.parse(a.first_seen) - Date.parse(b.first_seen)) : 0)
    const byEntry = (a: Job, b: Job) => entryRank(entryLevelOf(a)) - entryRank(entryLevelOf(b))
    return listed.sort((a, b) => (entryFirst ? byEntry(a, b) : 0) || byDate(a, b))
  }, [inTab, filters, lastVisit, kept, sortOrder, entryFirst, entryLevelOf])
  // Look the open job up by key so the drawer shows saved changes.
  const openJob = all.find((j) => jobKeyString(j) === openKey) ?? null
  const openIndex = shown.findIndex((j) => jobKeyString(j) === openKey)
  const step = (by: number) => {
    const next = shown[openIndex + by]
    if (next) setOpenKey(jobKeyString(next))
  }

  const changeFilters = (next: JobFilters) => {
    setFilters(next)
    setKept(new Set())
  }
  const changeEntryFirst = (next: boolean) => {
    setEntryFirst(next)
    try {
      localStorage.setItem(ENTRY_FIRST_KEY, String(next))
    } catch {
      // not remembered, but still applies
    }
  }
  const changeSource = (next: JobSource) => {
    setSource(next)
    setKept(new Set())
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // not remembered, but still switches
    }
  }

  // Which quick filter (if any) the current filters correspond to.
  const activeStat =
    filters.newOnly ? 'new-since'
      : sameStatuses(filters.statuses, ['new']) ? 'to-review'
        : sameStatuses(filters.statuses, ['applied', 'emailed']) ? 'applied'
          : sameStatuses(filters.statuses, ['interview']) ? 'interview'
            : sameStatuses(filters.statuses, ['offer']) ? 'offer'
              : null

  const label = sourceLabel(source)
  const empty: ReactNode = jobs.isPending ? ' '
    : jobs.isError ? <Empty description="Jobs couldn't be loaded." />
      : inTab.length === 0 ? <Empty description={`No ${label} jobs yet. They'll appear after the next scrape.`} />
        : activeStat === 'to-review' ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`You're caught up: nothing left to review on ${label}.`} />
          : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No jobs match these filters.">
              <Button onClick={() => changeFilters(DEFAULT_FILTERS)}>Reset filters</Button>
            </Empty>
          )

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="start" gap={8}>
        <div>
          <Typography.Title level={1} style={{ margin: 0 }}>Jobs</Typography.Title>
          <Freshness run={runs.data?.find((r) => r.source === source)} loaded={!runs.isPending} lastVisit={lastVisit} />
        </div>
        <Button icon={<ReloadOutlined />} loading={jobs.isFetching || runs.isFetching}
          aria-label={screens.sm ? undefined : 'Refresh'} style={{ flexShrink: 0 }}
          onClick={() => { jobs.refetch(); runs.refetch() }}>
          {screens.sm && 'Refresh'}
        </Button>
      </Flex>

      {jobs.isError && (
        <Alert type="error" showIcon title="Couldn't load jobs" description={errorText(jobs.error)}
          action={<Button size="small" onClick={() => jobs.refetch()}>Try again</Button>} />
      )}

      <Tabs
        activeKey={source}
        onChange={(key) => changeSource(key as JobSource)}
        tabBarStyle={{ marginBottom: 0 }}
        items={SOURCES.map((s) => {
          const fromSource = all.filter((j) => j.source === s)
          const fresh = fromSource.filter((j) => isNewSince(j, lastVisit)).length
          return {
            key: s,
            label: (
              <Flex gap={8} align="center">
                {sourceLabel(s)}
                <span className="tabular" style={{ opacity: 0.8 }}>{fromSource.length}</span>
                {fresh > 0 && <ToneTag color="cyan">{fresh} new</ToneTag>}
              </Flex>
            ),
          }
        })}
      />

      <StatCards
        jobs={inTab}
        lastVisit={lastVisit}
        activeKey={activeStat}
        onSelect={(stat) =>
          changeFilters({
            ...filters,
            statuses: stat?.statuses ?? DEFAULT_FILTERS.statuses,
            newOnly: stat?.newOnly ?? false,
          })
        }
      />

      <Flex vertical gap={8}>
        <JobFiltersBar jobs={inTab} filters={filters} onChange={changeFilters} />
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Typography.Text type="secondary" className="tabular" aria-live="polite">
            {shown.length} of {inTab.length} {label} jobs
          </Typography.Text>
          <Flex gap={8} align="center">
            <Switch size="small" id="entry-first" checked={entryFirst} onChange={changeEntryFirst} />
            <label htmlFor="entry-first">
              <Tooltip title="Junior, associate, trainee, L1… titles first, then fresh-grad-friendly descriptions. Edit the words under Rules.">
                <span>Entry-level first</span>
              </Tooltip>
            </label>
          </Flex>
        </Flex>
      </Flex>

      <JobTable jobs={shown} loading={jobs.isPending} lastVisit={lastVisit} empty={empty} entryLevelOf={entryLevelOf}
        sortOrder={sortOrder} onSortChange={setSortOrder}
        onStatusChanged={(job) => setKept((k) => new Set(k).add(jobKeyString(job)))}
        onOpen={(job) => setOpenKey(jobKeyString(job))} />

      <JobDrawer job={openJob} onClose={() => setOpenKey(null)}
        position={{ index: openIndex, total: shown.length }}
        onPrev={() => step(-1)} onNext={() => step(1)} />
    </Flex>
  )
}

/** When the scraper last ran for this source, and when you last visited. */
function Freshness({ run, loaded, lastVisit }: { run: ScrapeRun | undefined; loaded: boolean; lastVisit: string | null }) {
  const visit = lastVisit ? `Last visit ${fromNow(lastVisit)}` : 'First visit: new jobs get a dot from your next visit on'
  if (!loaded) return <Typography.Text type="secondary">{visit}</Typography.Text>
  if (!run) return <Typography.Text type="secondary">No scrape runs recorded yet · {visit}</Typography.Text>
  const when = dayTime(run.finished_at ?? run.started_at)
  return (
    <Typography.Text type="secondary">
      {run.error ? (
        <Tooltip title={run.error}>
          <Typography.Text type="danger">Last scrape failed {when}</Typography.Text>
        </Tooltip>
      ) : run.finished_at ? (
        <>Last scrape {when}{run.kept !== null && ` · ${run.kept} kept`}</>
      ) : (
        <>Scrape running since {when}</>
      )}
      {' · '}{visit}
    </Typography.Text>
  )
}

function NewDot() {
  const { token } = theme.useToken()
  return (
    <span title="New since your last visit" style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 7,
      background: token.colorPrimary,
    }}>
      <span className="sr-only">New:</span>
    </span>
  )
}

/** Title and company line, shared by the desktop and phone layouts. */
function JobHeading({ job, isNew, entry }: { job: Job; isNew: boolean; entry: EntryLevel }) {
  return (
    <Flex vertical gap={2} style={{ minWidth: 0 }}>
      <Flex gap={6} align="flex-start">
        {isNew && <NewDot />}
        <Typography.Text strong className="clamp-2">{job.title}</Typography.Text>
        <EntryLevelTag level={entry} />
      </Flex>
      <Typography.Text type="secondary" className="clamp-2">
        {job.company ?? 'Unknown company'} · {job.location ?? 'No location'}
      </Typography.Text>
    </Flex>
  )
}

/**
 * Rows show concerns only: good signs are summed up by the Entry-level tag and
 * listed in full in the drawer, so colour in the table means "look at this".
 */
const concerns = (flags: string[]) => flags.filter((f) => flagTone(f) === 'warning')

/** Matched skills as quiet text: "TypeScript · React · Node.js +2". */
function SkillList({ skills, max = 3 }: { skills: string[]; max?: number }) {
  if (!skills.length) return null
  const more = skills.length - max
  return (
    <Typography.Text type="secondary" className="clamp-2" style={{ maxWidth: 220 }}>
      {skills.slice(0, max).join(' · ')}{more > 0 && ` +${more}`}
    </Typography.Text>
  )
}

interface JobTableProps {
  jobs: Job[]
  loading: boolean
  lastVisit: string | null
  empty: ReactNode
  entryLevelOf: (job: Job) => EntryLevel
  sortOrder: SortOrder
  onSortChange: (order: SortOrder) => void
  onStatusChanged: (job: Job) => void
  onOpen: (job: Job) => void
}

function JobTable({
  jobs, loading, lastVisit, empty, entryLevelOf, sortOrder, onSortChange, onStatusChanged, onOpen,
}: JobTableProps) {
  const screens = Grid.useBreakpoint()
  const status = (job: Job, size: 'small' | 'middle', width: number) => (
    <StatusCell job={job} size={size} width={width} onChanged={onStatusChanged} />
  )

  const firstSeen = {
    title: <span style={{ whiteSpace: 'nowrap' }}>First seen</span>,
    dataIndex: 'first_seen',
    sorter: true,
    sortOrder,
    sortDirections: ['descend', 'ascend'] as SortOrder[],
    render: (iso: string) => (
      <Tooltip title={dateTime(iso)}><span style={{ whiteSpace: 'nowrap' }}>{fromNow(iso)}</span></Tooltip>
    ),
  }

  // Phones get one stacked column, so status and flags fit without scrolling sideways.
  const phoneColumns: TableColumnsType<Job> = [
    {
      title: 'Job',
      key: 'job',
      render: (_, job) => (
        <Flex vertical gap={8}>
          <JobHeading job={job} isNew={isNewSince(job, lastVisit)} entry={entryLevelOf(job)} />
          {concerns(job.flags).length > 0 && <FlagTags flags={concerns(job.flags).slice(0, 2)} />}
          {/* One StatusCell in one place for both layouts, so the skip-reason prompt
              survives the switch from triage buttons to the select. */}
          <Flex vertical={job.status === 'new'} justify="space-between"
            align={job.status === 'new' ? 'stretch' : 'center'} gap={8}>
            {job.status === 'new' && (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>Found {fromNow(job.first_seen)}</Typography.Text>
            )}
            <StatusCell job={job} quick size="middle" width={150} onChanged={onStatusChanged} />
            {job.status !== 'new' && <Typography.Text type="secondary">{fromNow(job.first_seen)}</Typography.Text>}
          </Flex>
        </Flex>
      ),
    },
  ]

  const columns: TableColumnsType<Job> = [
    {
      title: 'Job',
      key: 'job',
      render: (_, job) => (
        <Flex gap={12} align="center" style={{ maxWidth: 460 }}>
          <CompanyAvatar company={job.company} />
          <JobHeading job={job} isNew={isNewSince(job, lastVisit)} entry={entryLevelOf(job)} />
        </Flex>
      ),
    },
    {
      title: 'Arrangement',
      dataIndex: 'work_arrangements',
      render: (arrangements: string[]) => arrangements.join(', ') || <Typography.Text type="secondary">Not listed</Typography.Text>,
    },
    {
      title: 'Score',
      dataIndex: 'match_score',
      align: 'right',
      hidden: !SHOW_MATCH_SCORE,
    },
    {
      title: 'Skills',
      dataIndex: 'matched_skills',
      responsive: ['xl'],
      render: (skills: string[]) => <SkillList skills={skills} />,
    },
    {
      title: 'Concerns',
      dataIndex: 'flags',
      responsive: ['lg'],
      // Capped so long flags wrap instead of widening the table past the screen.
      render: (flags: string[]) => <div style={{ maxWidth: 240 }}><FlagTags flags={concerns(flags)} /></div>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (_, job) => status(job, 'small', 132),
    },
    firstSeen,
  ]

  const onChange: TableProps<Job>['onChange'] = (_pagination, _filters, sorter) => {
    if (!Array.isArray(sorter)) onSortChange((sorter.order ?? null) as SortOrder)
  }

  return (
    <Table<Job>
      rowKey={jobKeyString}
      columns={screens.md ? columns : phoneColumns}
      showHeader={screens.md}
      dataSource={jobs}
      loading={loading}
      size="middle"
      onChange={onChange}
      pagination={{ defaultPageSize: 25, showSizeChanger: true, hideOnSinglePage: true }}
      onRow={(job) => ({
        tabIndex: 0,
        onClick: () => onOpen(job),
        onKeyDown: (e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onOpen(job)
          }
        },
        style: { cursor: 'pointer' },
      })}
      // No max-content scroll: cells wrap to fit the screen, so Status and First seen stay in view.
      locale={{ emptyText: empty }}
    />
  )
}
