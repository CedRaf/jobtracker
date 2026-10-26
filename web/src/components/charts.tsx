import { useState, type ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Card, Empty, Segmented, Table, theme, type TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import type { JobSource } from '../data/types'
import type { DayCount } from '../lib/analytics'
import { useSourceLabel } from '../data/hooks'
import { useChartColors } from '../lib/chartColors'

/** A titled card that switches between the chart and the same data as a table. */
export function ChartCard<T extends object>({ title, subtitle, chart, rows, columns, rowKey, empty }: {
  title: string
  subtitle?: string
  chart: ReactNode
  rows: T[]
  columns: TableColumnsType<T>
  rowKey: keyof T & string
  empty?: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <Card
      size="small"
      title={<div><div>{title}</div>{subtitle && <div className="chart-subtitle">{subtitle}</div>}</div>}
      extra={rows.length > 0 && (
        <Segmented size="small" value={view} onChange={(v) => setView(v as 'chart' | 'table')}
          options={[{ label: 'Chart', value: 'chart' }, { label: 'Table', value: 'table' }]}
          aria-label={`${title}: view as`} />
      )}
      style={{ height: '100%' }}
    >
      {rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty ?? 'No data yet'} />
      ) : view === 'chart' ? chart : (
        <Table<T> rowKey={rowKey} columns={columns} dataSource={rows} size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }} />
      )}
    </Card>
  )
}

function ChartTooltip({ active, payload, label, labelFormat }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
  labelFormat?: (label: string) => string
}) {
  const { token } = theme.useToken()
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: token.colorBgElevated, border: `1px solid ${token.colorBorderSecondary}`,
      borderRadius: token.borderRadius, boxShadow: token.boxShadowSecondary, padding: '8px 10px', fontSize: 12,
    }}>
      {label !== undefined && <div style={{ color: token.colorTextSecondary, marginBottom: 4 }}>
        {labelFormat ? labelFormat(label) : label}
      </div>}
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, color: token.colorText }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
          {p.name}: <strong className="tabular">{p.value}</strong>
        </div>
      ))}
    </div>
  )
}

/** Kept jobs per day, stacked by source. */
export function DailyJobsChart({ data, sources }: { data: DayCount[]; sources: JobSource[] }) {
  const c = useChartColors()
  const { label } = useSourceLabel()
  const tick = { fill: c.text, fontSize: 12 }
  // Thin out date labels so they never collide.
  const every = Math.max(1, Math.ceil(data.length / 10))
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="day" tick={tick} tickLine={false} axisLine={{ stroke: c.grid }} interval={every - 1}
          tickFormatter={(d: string) => dayjs(d).format('MMM D')} />
        <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={40} />
        <Tooltip cursor={{ fill: c.token.colorFillTertiary }}
          content={<ChartTooltip labelFormat={(d) => dayjs(d).format('ddd, MMM D')} />} />
        {/* A single series needs no legend: the card title names it. */}
        {sources.length > 1 && (
          <Legend iconType="square" iconSize={10}
            formatter={(value: string) => <span style={{ color: c.token.colorText, fontSize: 12 }}>{value}</span>} />
        )}
        {sources.map((source, i) => (
          // Stacked; only the top segment gets the rounded end.
          <Bar key={source} isAnimationActive={false} dataKey={source} name={sources.length > 1 ? label(source) : 'Jobs'} stackId="s"
            fill={c.sources[source]} maxBarSize={24} stroke={c.surface} strokeWidth={2}
            radius={i === sources.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** A ranked horizontal bar list with the value at each bar's end. */
export function BarList({ data, labelKey, valueKey, name, height, valueLabelKey, onSelect }: {
  data: object[]
  labelKey: string
  valueKey: string
  name: string
  height?: number
  /** The field shown at the end of each bar; defaults to the value. */
  valueLabelKey?: string
  /** Makes bars clickable (the table view should offer the same as links). */
  onSelect?: (row: object) => void
}) {
  const c = useChartColors()
  const rowHeight = 30
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(120, data.length * rowHeight + 16)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: valueLabelKey ? 64 : 36, left: 0, bottom: 4 }} barCategoryGap={6}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey={labelKey} width={140} tickLine={false} axisLine={{ stroke: c.grid }}
          tick={{ fill: c.token.colorText, fontSize: 12 }} />
        <Tooltip cursor={{ fill: c.token.colorFillTertiary }} content={<ChartTooltip />} />
        <Bar isAnimationActive={false} dataKey={valueKey} name={name} fill={c.single} maxBarSize={18} radius={[0, 4, 4, 0]}
          onClick={onSelect ? (_: unknown, i: number) => onSelect(data[i]) : undefined}
          style={onSelect ? { cursor: 'pointer' } : undefined}>
          <LabelList dataKey={valueLabelKey ?? valueKey} position="right" fill={c.text} fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
