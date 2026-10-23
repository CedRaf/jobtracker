import { useState } from 'react'
import { Button, Card, Checkbox, Flex, Grid, Input, InputNumber, Select } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import type { Job } from '../data/types'
import { activeFilterCount, DEFAULT_FILTERS, filterOptions, type JobFilters } from '../lib/filters'
import { flagFilterOptions } from '../lib/flags'
import { SHOW_MATCH_SCORE } from '../lib/settings'
import { statusOptions } from '../lib/status'

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
      <Button icon={<FilterOutlined />} onClick={() => setExpanded(true)} aria-expanded={false}
        style={{ alignSelf: 'start' }}>
        Filters{changed > 0 && ` · ${changed} changed`}
      </Button>
    )
  }
  return <FilterControls jobs={jobs} filters={filters} onChange={onChange} phone={!screens.md}
    onHide={screens.md ? undefined : () => setExpanded(false)} />
}

function FilterControls({ jobs, filters, onChange, onHide, phone }: Props & { onHide?: () => void; phone: boolean }) {
  const options = filterOptions(jobs)
  const set = <K extends keyof JobFilters>(key: K, value: JobFilters[K]) => onChange({ ...filters, [key]: value })
  const toOptions = (values: string[]) => values.map((value) => ({ value, label: value }))
  const multi = { mode: 'multiple' as const, allowClear: true, maxTagCount: 'responsive' as const }
  // Phones stack full-width controls; wider screens share one wrapping row.
  const width = (desktop: number) => (phone ? '100%' : desktop)

  return (
    <Card size="small">
      <Flex wrap={!phone} gap={8} align={phone ? 'stretch' : 'center'} vertical={phone}>
        <Input.Search
          placeholder="Search title, company, skills, notes"
          aria-label="Search jobs"
          allowClear
          value={filters.text}
          onChange={(e) => set('text', e.target.value)}
          style={{ width: phone ? '100%' : undefined, flex: phone ? undefined : '1 1 220px', maxWidth: phone ? undefined : 300 }}
        />
        <Select {...multi} placeholder="Any status" aria-label="Status" options={statusOptions}
          value={filters.statuses} onChange={(v) => set('statuses', v)} style={{ width: width(200) }} />
        <Select {...multi} placeholder="Any arrangement" aria-label="Work arrangement"
          options={toOptions(options.arrangements)} value={filters.arrangements}
          onChange={(v) => set('arrangements', v)} style={{ width: width(165) }} />
        <Select {...multi} placeholder="Has skills" aria-label="Skills" options={toOptions(options.skills)}
          value={filters.skills} onChange={(v) => set('skills', v)} style={{ width: width(165) }} />
        <Select {...multi} placeholder="Has flags" aria-label="Flags" options={flagFilterOptions}
          value={filters.flags} onChange={(v) => set('flags', v)} style={{ width: width(165) }}
          popupMatchSelectWidth={240} />
        {SHOW_MATCH_SCORE && (
          <InputNumber min={0} prefix="Score ≥" value={filters.minScore}
            onChange={(v) => set('minScore', v ?? 0)} style={{ width: width(130) }} />
        )}
        <Flex gap={8} align="center" justify="space-between" style={{ width: phone ? '100%' : undefined }}>
          <Checkbox checked={filters.newOnly} onChange={(e) => set('newOnly', e.target.checked)}>
            New since last visit
          </Checkbox>
          <Flex>
            <Button type="link" disabled={!activeFilterCount(filters)} onClick={() => onChange(DEFAULT_FILTERS)}>
              Reset
            </Button>
            {onHide && <Button type="link" onClick={onHide} aria-expanded>Hide</Button>}
          </Flex>
        </Flex>
      </Flex>
    </Card>
  )
}
