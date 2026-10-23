import { useContext, useMemo, useState } from 'react'
import { App, Alert, Badge, Button, Flex, Select, Table, Tabs, Tag, Tooltip, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { Job, JobSource } from '../data/types'
import { jobKeyString } from '../data/types'
import { useJobs, useUpdateJob } from '../data/hooks'
import { CompanyAvatar } from '../components/CompanyAvatar'
import { JobDrawer } from '../components/JobDrawer'
import { JobFiltersBar } from '../components/JobFiltersBar'
import { StatCards } from '../components/StatCards'
import { FlagTags, SkillTags } from '../components/Tags'
import { applyFilters, DEFAULT_FILTERS, isNewSince, type JobFilters } from '../lib/filters'
import { dateTime, fromNow, sourceLabel } from '../lib/format'
import { LastVisitContext } from '../lib/lastVisit'
import { SHOW_MATCH_SCORE } from '../lib/settings'
import { statusOptions } from '../lib/status'

const SOURCES: JobSource[] = ['jobstreet', 'linkedin']
const TAB_KEY = 'jobtracker.sourceTab'

function initialSource(): JobSource {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (saved === 'jobstreet' || saved === 'linkedin') return saved
  } catch {
    // storage unavailable: use the default
  }
  return 'jobstreet'
}

const sameStatuses = (a: string[], b: string[]) => a.length === b.length && a.every((s) => b.includes(s))

export function JobsPage() {
  const jobs = useJobs()
  const lastVisit = useContext(LastVisitContext)
  const [source, setSource] = useState<JobSource>(initialSource)
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_FILTERS)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const all = useMemo(() => jobs.data ?? [], [jobs.data])
  const inTab = useMemo(() => all.filter((j) => j.source === source), [all, source])
  const shown = useMemo(() => applyFilters(inTab, filters, lastVisit), [inTab, filters, lastVisit])
  // Look the open job up by key so the drawer shows saved changes.
  const openJob = all.find((j) => jobKeyString(j) === openKey) ?? null

  const changeSource = (next: JobSource) => {
    setSource(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // not remembered, but still switches
    }
  }

  // Which summary card (if any) the current filters correspond to.
  const activeStat =
    filters.newOnly ? 'new-since'
      : sameStatuses(filters.statuses, ['new']) ? 'to-review'
        : sameStatuses(filters.statuses, ['applied', 'emailed']) ? 'applied'
          : sameStatuses(filters.statuses, ['interview']) ? 'interview'
            : sameStatuses(filters.statuses, ['offer']) ? 'offer'
              : null

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Jobs</Typography.Title>
          <Typography.Text type="secondary">
            {lastVisit ? `Last visit ${fromNow(lastVisit)}` : 'Welcome! New jobs get a dot from your next visit on.'}
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={jobs.isFetching} onClick={() => jobs.refetch()}>Refresh</Button>
      </Flex>

      {jobs.isError && <Alert type="error" title={`Couldn't load jobs: ${String(jobs.error)}`} />}

      <Tabs
        activeKey={source}
        onChange={(key) => changeSource(key as JobSource)}
        style={{ marginBottom: -16 }}
        items={SOURCES.map((s) => {
          const fromSource = all.filter((j) => j.source === s)
          const fresh = fromSource.filter((j) => isNewSince(j, lastVisit)).length
          return {
            key: s,
            label: (
              <Flex gap={8} align="center">
                {sourceLabel(s)}
                <Tag style={{ marginInlineEnd: 0 }}>{fromSource.length}</Tag>
                {fresh > 0 && <Badge count={`${fresh} new`} color="#4f46e5" />}
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
          setFilters({
            ...filters,
            statuses: stat?.statuses ?? DEFAULT_FILTERS.statuses,
            newOnly: stat?.newOnly ?? false,
          })
        }
      />

      <JobFiltersBar jobs={inTab} filters={filters} onChange={setFilters} />

      <Typography.Text type="secondary">{shown.length} of {inTab.length} {sourceLabel(source)} jobs shown</Typography.Text>

      <JobTable jobs={shown} loading={jobs.isPending} lastVisit={lastVisit}
        onOpen={(job) => setOpenKey(jobKeyString(job))} />

      <JobDrawer job={openJob} onClose={() => setOpenKey(null)} />
    </Flex>
  )
}

interface TableProps {
  jobs: Job[]
  loading: boolean
  lastVisit: string | null
  onOpen: (job: Job) => void
}

function JobTable({ jobs, loading, lastVisit, onOpen }: TableProps) {
  const { message } = App.useApp()
  const update = useUpdateJob()

  const columns: TableColumnsType<Job> = [
    {
      title: 'Job',
      key: 'job',
      render: (_, job) => (
        <Flex gap={12} align="center">
          <CompanyAvatar company={job.company} />
          <Flex vertical gap={2} style={{ minWidth: 0 }}>
            <Flex gap={6} align="center">
              {isNewSince(job, lastVisit) && <Badge status="processing" color="#4f46e5" title="New since your last visit" />}
              <Typography.Text strong>{job.title}</Typography.Text>
            </Flex>
            <Typography.Text type="secondary">
              {job.company ?? 'Unknown company'} · {job.location ?? 'No location'}
            </Typography.Text>
          </Flex>
        </Flex>
      ),
    },
    {
      title: 'Arrangement',
      dataIndex: 'work_arrangements',
      responsive: ['md'],
      render: (arrangements: string[]) => arrangements.join(', ') || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Score',
      dataIndex: 'match_score',
      align: 'right',
      hidden: !SHOW_MATCH_SCORE,
      sorter: (a, b) => a.match_score - b.match_score,
    },
    {
      title: 'Skills',
      dataIndex: 'matched_skills',
      responsive: ['lg'],
      render: (skills: string[]) => <SkillTags skills={skills} color="blue" max={3} />,
    },
    {
      title: 'Flags',
      dataIndex: 'flags',
      responsive: ['xl'],
      render: (flags: string[]) => <FlagTags flags={flags} />,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (_, job) => (
        // Stop clicks reaching the row, which would open the drawer.
        <div onClick={(e) => e.stopPropagation()}>
          <Select
            size="small"
            value={job.status}
            options={statusOptions}
            style={{ width: 120 }}
            aria-label={`Status of ${job.title}`}
            onChange={(status) =>
              update.mutate({ key: job, patch: { status } }, {
                onError: (e) => message.error(`Couldn't save: ${e.message}`),
              })
            }
          />
        </div>
      ),
    },
    {
      title: 'First seen',
      dataIndex: 'first_seen',
      defaultSortOrder: 'descend',
      sorter: (a, b) => Date.parse(a.first_seen) - Date.parse(b.first_seen),
      render: (iso: string) => <Tooltip title={dateTime(iso)}>{fromNow(iso)}</Tooltip>,
    },
  ]

  return (
    <Table<Job>
      rowKey={jobKeyString}
      columns={columns}
      dataSource={jobs}
      loading={loading}
      size="middle"
      pagination={{ defaultPageSize: 25, showSizeChanger: true, hideOnSinglePage: true }}
      onRow={(job) => ({ onClick: () => onOpen(job), style: { cursor: 'pointer' } })}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: loading ? ' ' : 'No jobs match these filters' }}
    />
  )
}
