import { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Flex, Row, Segmented, Skeleton, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, ExportOutlined, MinusCircleOutlined, SyncOutlined, WarningOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { ScrapeRun } from '../data/types'
import { useFilteredJobs, useJobs, useScrapeRuns, useStatusHistory } from '../data/hooks'
import { BarList, ChartCard, DailyJobsChart } from '../components/charts'
import {
  funnel, jobsPerDay, median, reasonCounts, responseDays, runState, seenWithin, skillDemand, staleSources,
  successRate, type DayCount, type FunnelStage, type RunState, type SkillCount,
} from '../lib/analytics'
import { dateTime, errorText, fromNow, sourceLabel } from '../lib/format'

const PERIODS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
]

const HEALTH_DAYS = 14

/** Set VITE_GITHUB_REPO (owner/name) to link runs to their GitHub Actions logs. */
const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO as string | undefined

const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)
const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toString()

export function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const jobs = useJobs()
  const history = useStatusHistory()
  const filtered = useFilteredJobs(days)

  const inPeriod = useMemo(() => seenWithin(jobs.data ?? [], days), [jobs.data, days])
  const daily = useMemo(() => jobsPerDay(inPeriod, Math.min(days, 90)), [inPeriod, days])
  const skills = useMemo(() => skillDemand(inPeriod), [inPeriod])
  const flow = useMemo(() => funnel(inPeriod, history.data ?? []), [inPeriod, history.data])
  const waits = useMemo(() => {
    const ids = new Set(inPeriod.map((j) => `${j.source}:${j.external_id}`))
    return responseDays((history.data ?? []).filter((h) => ids.has(`${h.job_source}:${h.job_external_id}`)))
  }, [inPeriod, history.data])
  const reasons = useMemo(() => reasonCounts(filtered.data ?? []), [filtered.data])
  const medianWait = median(waits)

  const loading = jobs.isPending || history.isPending
  const failed = jobs.error ?? history.error

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="end" wrap gap={12}>
        <div>
          <Typography.Title level={1} style={{ margin: 0 }}>Analytics</Typography.Title>
          <Typography.Text type="secondary">How the search is going, and whether the scraper is healthy.</Typography.Text>
        </div>
        <Segmented options={PERIODS} value={days} onChange={(v) => setDays(v)} aria-label="Period" />
      </Flex>

      <ScraperHealth />

      {failed && (
        <Alert type="error" showIcon title="Couldn't load your jobs" description={errorText(failed)}
          action={<Button size="small" onClick={() => { jobs.refetch(); history.refetch() }}>Try again</Button>} />
      )}

      {loading ? <Skeleton active /> : (
        <>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}><Tile label="Jobs found" value={inPeriod.length} /></Col>
            <Col xs={12} md={6}><Tile label="Applied or emailed" value={flow.stages.find((s) => s.key === 'applied')!.count} /></Col>
            <Col xs={12} md={6}>
              <Tile label="Response rate" value={pct(flow.responseRate)}
                hint="Applications that got an interview, offer or rejection" />
            </Col>
            <Col xs={12} md={6}>
              <Tile label="Median days to a response" value={medianWait === null ? '—' : oneDecimal(medianWait)}
                hint={`From marking a job applied/emailed to its first response. Based on ${waits.length} ${waits.length === 1 ? 'job' : 'jobs'}.`} />
            </Col>
          </Row>

          <ChartCard<DayCount>
            title="New jobs per day"
            subtitle={days > 90 ? 'Last 90 days (kept jobs only)' : 'Kept jobs only'}
            chart={<DailyJobsChart data={daily} />}
            rows={[...daily].reverse().filter((d) => d.jobstreet + d.linkedin > 0)}
            rowKey="day"
            empty="No jobs in this period"
            columns={[
              { title: 'Day', dataIndex: 'day', render: (d: string) => dayjs(d).format('ddd, MMM D') },
              { title: 'JobStreet', dataIndex: 'jobstreet', align: 'right' },
              { title: 'LinkedIn', dataIndex: 'linkedin', align: 'right' },
            ]}
          />

          <Row gutter={[12, 12]}>
            <Col xs={24} lg={12}>
              <ChartCard<FunnelStage>
                title="Application funnel"
                subtitle="Jobs that ever reached each stage"
                chart={<BarList data={flow.stages} labelKey="label" valueKey="count" name="Jobs" />}
                rows={flow.stages.some((s) => s.count > 0) ? flow.stages : []}
                rowKey="key"
                columns={[
                  { title: 'Stage', dataIndex: 'label' },
                  { title: 'Jobs', dataIndex: 'count', align: 'right' },
                ]}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard<{ reason: string; count: number }>
                title="Why jobs were filtered out"
                subtitle="Grouped by rule"
                chart={<BarList data={reasons.slice(0, 10)} labelKey="reason" valueKey="count" name="Jobs" />}
                rows={reasons}
                rowKey="reason"
                empty={filtered.isError ? `Couldn't load: ${errorText(filtered.error)}` : 'Nothing filtered out'}
                columns={[
                  { title: 'Rule', dataIndex: 'reason' },
                  { title: 'Jobs', dataIndex: 'count', align: 'right' },
                ]}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard<SkillCount>
                title="Your skills employers ask for"
                subtitle="Jobs mentioning each skill"
                chart={<BarList data={skills.yours} labelKey="skill" valueKey="count" name="Jobs" />}
                rows={skills.yours}
                rowKey="skill"
                columns={[{ title: 'Skill', dataIndex: 'skill' }, { title: 'Jobs', dataIndex: 'count', align: 'right' }]}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard<SkillCount>
                title="Other stacks they ask for"
                subtitle="Mentioned in jobs you kept; not on your resume"
                chart={<BarList data={skills.others} labelKey="skill" valueKey="count" name="Jobs" />}
                rows={skills.others}
                rowKey="skill"
                empty="No other stacks mentioned"
                columns={[{ title: 'Stack', dataIndex: 'skill' }, { title: 'Jobs', dataIndex: 'count', align: 'right' }]}
              />
            </Col>
          </Row>
        </>
      )}
    </Flex>
  )
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {hint ? <Tooltip title={hint}><span style={{ borderBottom: '1px dotted currentColor' }}>{label}</span></Tooltip> : label}
      </Typography.Text>
      <div className="tabular" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>{value}</div>
    </Card>
  )
}

// ---- Scraper health --------------------------------------------------------------

const STATE_TAGS: Record<RunState, { label: string; color: string; icon: React.ReactNode }> = {
  ok: { label: 'OK', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { label: 'Failed', color: 'error', icon: <CloseCircleOutlined /> },
  running: { label: 'Running', color: 'processing', icon: <SyncOutlined spin /> },
  interrupted: { label: 'Interrupted', color: 'warning', icon: <MinusCircleOutlined /> },
}

const StateTag = ({ state }: { state: RunState }) => (
  <Tag color={STATE_TAGS[state].color} icon={STATE_TAGS[state].icon} style={{ marginInlineEnd: 0 }}>
    {STATE_TAGS[state].label}
  </Tag>
)

const count = (n: number | null) => (n === null ? '—' : n)

const runColumns: TableColumnsType<ScrapeRun> = [
  {
    title: 'Started',
    dataIndex: 'started_at',
    render: (iso: string) => <Tooltip title={dateTime(iso)}>{dayjs(iso).format('MMM D, HH:mm')}</Tooltip>,
  },
  { title: 'Source', dataIndex: 'source', render: sourceLabel },
  { title: 'Result', key: 'state', render: (_, run) => <StateTag state={runState(run)} /> },
  { title: 'Found', dataIndex: 'found', align: 'right', responsive: ['md'], render: count },
  { title: 'Checked', dataIndex: 'evaluated', align: 'right', responsive: ['md'], render: count },
  { title: 'Kept', dataIndex: 'kept', align: 'right', render: count },
  { title: 'Filtered', dataIndex: 'filtered', align: 'right', responsive: ['lg'], render: count },
  {
    title: 'Took',
    key: 'took',
    align: 'right',
    responsive: ['lg'],
    render: (_, run) => run.finished_at
      ? `${Math.max(1, Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 60_000))} min`
      : '—',
  },
  ...(GITHUB_REPO ? [{
    title: 'Log',
    key: 'log',
    render: (_: unknown, run: ScrapeRun) => run.github_run_id && (
      <Typography.Link href={`https://github.com/${GITHUB_REPO}/actions/runs/${run.github_run_id}`}
        target="_blank" rel="noreferrer" aria-label="Open the run's log on GitHub">
        <ExportOutlined />
      </Typography.Link>
    ),
  }] : []),
]

function ScraperHealth() {
  const runs = useScrapeRuns(HEALTH_DAYS)
  const [showRuns, setShowRuns] = useState(false)
  const list = useMemo(() => runs.data ?? [], [runs.data])
  const stale = staleSources(list)
  const latest = (['jobstreet', 'linkedin'] as const).map((source) => ({
    source, run: list.find((r) => r.source === source),
  }))
  const rate = successRate(list)

  return (
    <Card
      size="small"
      title="Scraper health"
      extra={list.length > 0 && (
        <Button type="link" size="small" onClick={() => setShowRuns((v) => !v)} aria-expanded={showRuns}>
          {showRuns ? 'Hide runs' : `All runs (${HEALTH_DAYS} days)`}
        </Button>
      )}
    >
      {runs.isPending ? <Skeleton active paragraph={{ rows: 2 }} /> : runs.isError ? (
        <Alert type="error" showIcon title="Couldn't load scraper runs" description={errorText(runs.error)}
          action={<Button size="small" onClick={() => runs.refetch()}>Try again</Button>} />
      ) : (
        <Flex vertical gap={12}>
          {stale.length > 0 && (
            <Alert type="warning" showIcon icon={<WarningOutlined />}
              title={`No ${stale.map(sourceLabel).join(' or ')} run in the last 24 hours`}
              description="The scraper should run at 11:00 and 15:00. Check the Apps Script timer and the GitHub Actions tab." />
          )}
          <Flex gap={24} wrap>
            {latest.map(({ source, run }) => (
              <Flex key={source} vertical gap={4} style={{ minWidth: 200 }}>
                <Typography.Text type="secondary">{sourceLabel(source)} · last run</Typography.Text>
                {run ? (
                  <Flex gap={8} align="center" wrap>
                    <StateTag state={runState(run)} />
                    <Tooltip title={dateTime(run.started_at)}><span>{fromNow(run.started_at)}</span></Tooltip>
                    {run.kept !== null && <Typography.Text type="secondary">· {run.kept} kept</Typography.Text>}
                  </Flex>
                ) : <Typography.Text type="secondary">No runs in {HEALTH_DAYS} days</Typography.Text>}
                {run?.error && (
                  <Typography.Text type="danger" className="clamp-2" style={{ fontSize: 12, maxWidth: 360 }}>
                    {run.error}
                  </Typography.Text>
                )}
              </Flex>
            ))}
            <Flex vertical gap={4}>
              <Typography.Text type="secondary">Succeeded ({HEALTH_DAYS} days)</Typography.Text>
              <span className="tabular" style={{ fontWeight: 600 }}>
                {pct(rate)} <Typography.Text type="secondary" style={{ fontWeight: 400 }}>of {list.length} runs</Typography.Text>
              </span>
            </Flex>
          </Flex>
          {showRuns && (
            <Table<ScrapeRun> rowKey={(r) => `${r.source}:${r.started_at}`} columns={runColumns} dataSource={list}
              size="small" pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} />
          )}
        </Flex>
      )}
    </Card>
  )
}
