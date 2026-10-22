import { useState } from 'react'
import { Button, Card, Checkbox, Flex, Grid, Input, InputNumber, Select } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import type { Job } from '../data/types'
import { activeFilterCount, DEFAULT_FILTERS, filterOptions, type JobFilters } from '../lib/filters'
import { flagLabel } from '../lib/flags'
import { statusOptions } from '../lib/status'

const SOURCE_OPTIONS = [
  { value: 'jobstreet', label: 'JobStreet' },
  { value: 'linkedin', label: 'LinkedIn' },
]

interface Props {
  jobs: Job[]
  filters: JobFilters
  onChange: (filters: JobFilters) => void
}

export function JobFiltersBar({ jobs, filters, onChange }: Props) {
  const screens = Grid.useBreakpoint()
  const [expanded, setExpanded] = useState(false)
  const changed = activeFilterCount(filters)

  // On phones the filters would fill the screen, so they fold away.
  if (!screens.md && !expanded) {
    return (
      <Button icon={<FilterOutlined />} onClick={() => setExpanded(true)} style={{ alignSelf: 'start' }}>
        Filters{changed ? ` (${changed} changed)` : ''}
      </Button>
    )
  }
  return <FilterControls jobs={jobs} filters={filters} onChange={onChange}
    onHide={screens.md ? undefined : () => setExpanded(false)} />
}

function FilterControls({ jobs, filters, onChange, onHide }: Props & { onHide?: () => void }) {
  const options = filterOptions(jobs)
  const set = <K extends keyof JobFilters>(key: K, value: JobFilters[K]) => onChange({ ...filters, [key]: value })
  const toOptions = (values: string[]) => values.map((value) => ({ value, label: value }))
  const multi = { mode: 'multiple' as const, allowClear: true, maxTagCount: 'responsive' as const }

  return (
    <Card size="small">
      <Flex wrap gap={8} align="center">
        <Input.Search
          placeholder="Search title, company, skills, notes"
          allowClear
          defaultValue={filters.text}
          onSearch={(text) => set('text', text)}
          onChange={(e) => !e.target.value && set('text', '')}
          style={{ width: 280 }}
        />
        <Select {...multi} placeholder="Any status" options={statusOptions} value={filters.statuses}
          onChange={(v) => set('statuses', v)} style={{ width: 230 }} />
        <Select {...multi} placeholder="Any source" options={SOURCE_OPTIONS} value={filters.sources}
          onChange={(v) => set('sources', v)} style={{ width: 170 }} />
        <Select {...multi} placeholder="Any arrangement" options={toOptions(options.arrangements)}
          value={filters.arrangements} onChange={(v) => set('arrangements', v)} style={{ width: 190 }} />
        <Select {...multi} placeholder="Has skills" options={toOptions(options.skills)} value={filters.skills}
          onChange={(v) => set('skills', v)} style={{ width: 190 }} />
        <Select {...multi} placeholder="Has flags"
          options={options.flags.map((value) => ({ value, label: flagLabel(value) }))}
          value={filters.flags} onChange={(v) => set('flags', v)} style={{ width: 190 }} />
        <InputNumber min={0} prefix="Score ≥" value={filters.minScore}
          onChange={(v) => set('minScore', v ?? 0)} style={{ width: 130 }} />
        <Checkbox checked={filters.newOnly} onChange={(e) => set('newOnly', e.target.checked)}>
          New since last visit
        </Checkbox>
        <Button type="link" disabled={!activeFilterCount(filters)} onClick={() => onChange(DEFAULT_FILTERS)}>
          Reset filters
        </Button>
        {onHide && <Button type="link" onClick={onHide}>Hide filters</Button>}
      </Flex>
    </Card>
  )
}
