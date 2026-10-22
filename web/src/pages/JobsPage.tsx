import { useContext, useMemo, useState } from 'react'
import { App, Alert, Badge, Button, Flex, Select, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { Job } from '../data/types'
import { jobKeyString } from '../data/types'
import { useJobs, useUpdateJob } from '../data/hooks'
import { JobDrawer } from '../components/JobDrawer'
import { JobFiltersBar } from '../components/JobFiltersBar'
import { FlagTags, SkillTags } from '../components/Tags'
import { applyFilters, DEFAULT_FILTERS, isNewSince } from '../lib/filters'
import { dateTime, fromNow, sourceLabel } from '../lib/format'
import { LastVisitContext } from '../lib/lastVisit'
import { statusOptions } from '../lib/status'

export function JobsPage() {
  const jobs = useJobs()
  const lastVisit = useContext(LastVisitContext)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const all = useMemo(() => jobs.data ?? [], [jobs.data])
  const shown = useMemo(() => applyFilters(all, filters, lastVisit), [all, filters, lastVisit])
  const newCount = all.filter((j) => isNewSince(j, lastVisit)).length
  // Look the open job up by key so the drawer shows saved changes.
  const openJob = all.find((j) => jobKeyString(j) === openKey) ?? null

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Jobs</Typography.Title>
          <Typography.Text type="secondary">
            {shown.length} of {all.length} shown
            {lastVisit && ` · ${newCount} new since your last visit (${fromNow(lastVisit)})`}
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={jobs.isFetching} onClick={() => jobs.refetch()}>Refresh</Button>
      </Flex>

      {jobs.isError && <Alert type="error" title={`Couldn't load jobs: ${String(jobs.error)}`} />}

      <JobFiltersBar jobs={all} filters={filters} onChange={setFilters} />

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
        <Flex vertical gap={2}>
          <Flex gap={6} align="center">
            {isNewSince(job, lastVisit) && <Badge status="processing" title="New since your last visit" />}
            <Typography.Text strong>{job.title}</Typography.Text>
          </Flex>
          <Typography.Text type="secondary">
            {job.company ?? 'Unknown company'} · {job.location ?? 'No location'}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'source',
      responsive: ['md'],
      render: (source: Job['source']) => <Tag>{sourceLabel(source)}</Tag>,
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
