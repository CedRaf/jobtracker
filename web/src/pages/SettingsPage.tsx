import { useEffect, useMemo, useState } from 'react'
import {
  Alert, App, Button, Card, Checkbox, Drawer, Empty, Flex, Form, Grid, Input, InputNumber, Radio, Select, Skeleton,
  Switch, Tabs, Tag, Tooltip, Typography, theme, type FormListFieldData,
} from 'antd'
import { DeleteOutlined, HistoryOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons'
import { DEFAULT_SETTINGS } from '../data/defaultSettings'
import { useLatestScrapeRuns, useSaveSettings, useSettingsVersions } from '../data/hooks'
import type { ScraperSettings, SettingsVersion } from '../data/types'
import { dateTime, errorText, fromNow } from '../lib/format'
import { changedSections, normalizeSettings, settingsProblems } from '../lib/scraperSettings'

export function SettingsPage() {
  const versions = useSettingsVersions()
  // Kept here so the open tab survives the editor restarting after a save.
  const [tab, setTab] = useState('search')

  return (
    <Flex vertical gap={16}>
      <div>
        <Typography.Title level={1} style={{ margin: 0 }}>Scraper rules</Typography.Title>
        <Typography.Text type="secondary">
          What the scraper searches for and which jobs it drops or flags. Changes apply from the next run.
        </Typography.Text>
      </div>

      {versions.isPending ? <Skeleton active /> : versions.isError ? (
        <Alert type="error" showIcon title="Couldn't load the scraper rules" description={errorText(versions.error)}
          action={<Button size="small" onClick={() => versions.refetch()}>Try again</Button>} />
      ) : (
        // Keyed by version so the form starts over after a save or restore.
        <SettingsEditor key={versions.data[0]?.version ?? 'none'} versions={versions.data} tab={tab} onTabChange={setTab} />
      )}
    </Flex>
  )
}

function SettingsEditor({ versions, tab, onTabChange }: {
  versions: SettingsVersion[]
  tab: string
  onTabChange: (tab: string) => void
}) {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const save = useSaveSettings()
  const runs = useLatestScrapeRuns()
  const [form] = Form.useForm<ScraperSettings>()
  const [note, setNote] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const current = versions[0]
  const initial = useMemo(() => normalizeSettings(current?.settings ?? DEFAULT_SETTINGS), [current])
  const values = Form.useWatch([], form) as ScraperSettings | undefined
  const dirty = !!values && JSON.stringify(normalizeSettings({ ...initial, ...values })) !== JSON.stringify(initial)

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const submit = () => {
    const settings = normalizeSettings({ ...initial, ...form.getFieldsValue(true) })
    const found = settingsProblems(settings)
    setProblems(found)
    if (found.length) return
    save.mutate({ settings, note: note.trim() || null }, {
      onSuccess: (saved) => message.success(`Saved as version ${saved.version}. The next scraper run uses it.`),
      onError: (e) => message.error(`Couldn't save: ${errorText(e)}`),
    })
  }

  const usedBy = (runs.data ?? []).map((r) => r.settings_version)
  const runsOnCurrent = current && usedBy.length > 0 && usedBy.every((v) => v === current.version)

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Text type="secondary">
          {current ? (
            <>
              Version {current.version}, saved {fromNow(current.created_at)}
              {current.note && <> · “{current.note}”</>}
              {usedBy.length > 0 && (runsOnCurrent
                ? ' · the latest runs used it'
                : ' · the next run will use it')}
            </>
          ) : 'Nothing saved yet: these are the built-in defaults.'}
        </Typography.Text>
        <Flex gap={8}>
          <Button icon={<UndoOutlined />} onClick={() => form.setFieldsValue(structuredClone(DEFAULT_SETTINGS))}>
            Reset to defaults
          </Button>
          <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)} disabled={!versions.length}>
            History
          </Button>
        </Flex>
      </Flex>

      <Form form={form} layout="vertical" initialValues={initial} requiredMark={false}>
        <Tabs
          activeKey={tab}
          onChange={onTabChange}
          items={[
            { key: 'search', label: 'Search', forceRender: true, children: <SearchTab /> },
            { key: 'entry', label: 'Entry-level', forceRender: true, children: <EntryLevelTab /> },
            { key: 'titles', label: 'Title rules', forceRender: true, children: <TitleRulesTab /> },
            { key: 'checks', label: 'Description checks', forceRender: true, children: <ChecksTab /> },
            { key: 'skills', label: 'Skills', forceRender: true, children: <SkillsTab /> },
            { key: 'stacks', label: 'Other stacks', forceRender: true, children: <StacksTab /> },
          ]}
        />
      </Form>

      {(dirty || problems.length > 0) && (
        <div className="save-bar" style={{
          background: token.colorBgElevated, borderTop: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}>
          <Flex vertical gap={8} style={{ maxWidth: 1368, margin: '0 auto' }}>
            {problems.length > 0 && (
              <Alert type="error" showIcon title="Fix these before saving"
                description={<ul style={{ margin: 0, paddingInlineStart: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>} />
            )}
            <Flex gap={8} align="center" wrap>
              <Input placeholder="What changed? (optional)" aria-label="Note for this version" value={note}
                onChange={(e) => setNote(e.target.value)} onPressEnter={submit} style={{ flex: '1 1 240px' }}
                maxLength={200} />
              <Button onClick={() => { form.resetFields(); setProblems([]); setNote('') }}>Discard changes</Button>
              <Button type="primary" loading={save.isPending} onClick={submit} disabled={!dirty}>Save as new version</Button>
            </Flex>
          </Flex>
        </div>
      )}

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} versions={versions} />
    </>
  )
}

// ---- Shared bits -------------------------------------------------------------------

/** A free-text tag input: type a word or phrase and press Enter (or a comma). */
function WordsInput(props: { value?: string[]; onChange?: (v: string[]) => void; placeholder?: string; 'aria-label'?: string }) {
  return (
    <Select mode="tags" open={false} suffixIcon={null} tokenSeparators={[',']} style={{ width: '100%' }}
      {...props} />
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <Typography.Paragraph type="secondary" style={{ maxWidth: '75ch' }}>{children}</Typography.Paragraph>
}

const MATCHING_HINT = 'Matching ignores case and works on whole words; spaces and hyphens are interchangeable, so “help desk” also catches “help-desk” and “helpdesk”.'

// ---- Tabs ------------------------------------------------------------------------------

function SearchTab() {
  return (
    <Flex vertical gap={8} style={{ maxWidth: 760 }}>
      <Hint>Each keyword is searched on JobStreet and LinkedIn, in Cebu and (if switched on) as remote jobs anywhere.</Hint>
      <Form.Item name={['search', 'keywords']} label="Search keywords">
        <WordsInput placeholder="e.g. junior react developer" aria-label="Search keywords" />
      </Form.Item>
      <Flex gap={16} wrap>
        <Form.Item name={['search', 'listed_within_days']} label="Only jobs listed in the last" style={{ minWidth: 200 }}>
          <InputNumber min={1} max={30} suffix="days" style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name={['search', 'max_pages_per_search']} label="Result pages per search"
          tooltip="About 30 jobs per page. More pages = longer runs." style={{ minWidth: 200 }}>
          <InputNumber min={1} max={10} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name={['search', 'radius_km']} label="Distance from Cebu City" style={{ minWidth: 200 }}>
          <InputNumber min={1} max={500} suffix="km" style={{ width: 140 }} />
        </Form.Item>
      </Flex>
      <Form.Item name={['search', 'search_remote_elsewhere']} valuePropName="checked"
        label="Also search remote jobs outside Cebu">
        <Switch />
      </Form.Item>
    </Flex>
  )
}

function EntryLevelTab() {
  return (
    <Flex vertical gap={8} style={{ maxWidth: 760 }}>
      <Hint>
        Jobs whose title contains one of these words get an Entry-level marker and are listed first on the Jobs
        page. Nothing is dropped; this only highlights. {MATCHING_HINT}
      </Hint>
      <Form.Item name={['entry_level', 'title_words']} label="Entry-level words in the title">
        <WordsInput placeholder="e.g. junior, associate, L1" aria-label="Entry-level words in the title" />
      </Form.Item>
      <Form.Item name={['entry_level', 'description_signals']} valuePropName="checked"
        label="Also mark jobs whose description says fresh grads are OK, entry level, or no experience required">
        <Switch />
      </Form.Item>
    </Flex>
  )
}

function TitleRulesTab() {
  return (
    <Flex vertical gap={8}>
      <Hint>
        A job is dropped before its description is fetched if its title contains any word from a switched-on rule.
        The rule's name is what the Filtered page shows. {MATCHING_HINT}
      </Hint>
      <Form.List name="title_rules">
        {(fields, { add, remove }) => (
          <Flex vertical gap={8}>
            {fields.map((field) => <TitleRuleCard key={field.key} field={field} onRemove={() => remove(field.name)} />)}
            <Button icon={<PlusOutlined />} onClick={() => add({ label: '', enabled: true, words: [] })}
              style={{ alignSelf: 'start' }}>Add title rule</Button>
          </Flex>
        )}
      </Form.List>
    </Flex>
  )
}

function TitleRuleCard({ field, onRemove }: { field: FormListFieldData; onRemove: () => void }) {
  const enabled = Form.useWatch(['title_rules', field.name, 'enabled'])
  const label = Form.useWatch(['title_rules', field.name, 'label'])
  return (
    <Card size="small" style={{ opacity: enabled ? 1 : 0.7 }}>
      <Flex gap={12} align="start" wrap>
        <Form.Item name={[field.name, 'enabled']} valuePropName="checked" noStyle>
          <Switch aria-label={`Use rule ${label || ''}`} style={{ marginTop: 5 }} />
        </Form.Item>
        <Form.Item name={[field.name, 'label']} noStyle>
          <Input placeholder="Rule name, e.g. seniority title" aria-label="Rule name" style={{ width: 220 }} />
        </Form.Item>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Form.Item name={[field.name, 'words']} noStyle>
            <WordsInput placeholder="Words or phrases in the title" aria-label={`Words for ${label || 'this rule'}`} />
          </Form.Item>
        </div>
        <Tooltip title="Delete rule">
          <Button type="text" icon={<DeleteOutlined />} aria-label={`Delete rule ${label || ''}`} onClick={onRemove} />
        </Tooltip>
      </Flex>
    </Card>
  )
}

const DROP_OR_OFF = [{ label: 'Drop the job', value: 'drop' }, { label: 'Ignore', value: 'off' }]

function ChecksTab() {
  return (
    <Flex vertical gap={8} style={{ maxWidth: 760 }}>
      <Hint>
        These read the full description. Their patterns are built in (they handle things like “no night shift”);
        here you choose what happens when they match.
      </Hint>
      <Form.Item name={['checks', 'night_shift']} label="Night shift, graveyard or NSD">
        <Radio.Group options={DROP_OR_OFF} optionType="button" />
      </Form.Item>
      <Form.Item name={['checks', 'foreign_hours']} label="US / UK hours or time zones">
        <Radio.Group options={DROP_OR_OFF} optionType="button" />
      </Form.Item>
      <Form.Item name={['checks', 'language_requirement']} label="Must be fluent in a foreign language (Japanese, Mandarin…)">
        <Radio.Group options={DROP_OR_OFF} optionType="button" />
      </Form.Item>
      <Form.Item name={['checks', 'training_bond']} label="Training bond or service agreement">
        <Radio.Group options={[{ label: 'Flag it', value: 'flag' }, { label: 'Ignore', value: 'off' }]} optionType="button" />
      </Form.Item>
      <Flex gap={16} wrap>
        <Form.Item name={['experience', 'flag_years']} label="Flag jobs asking for" tooltip="Leave empty to never flag">
          <InputNumber min={1} max={15} suffix="+ years" placeholder="never" style={{ width: 150 }} />
        </Form.Item>
        <Form.Item name={['experience', 'drop_years']} label="Drop jobs asking for" tooltip="Leave empty to never drop">
          <InputNumber min={1} max={15} suffix="+ years" placeholder="never" style={{ width: 150 }} />
        </Form.Item>
      </Flex>
      <Form.Item name="previous_employers" label="Previous employers (flagged, not dropped)">
        <WordsInput placeholder="Company name" aria-label="Previous employers" />
      </Form.Item>
    </Flex>
  )
}

const WEIGHTS = [
  { label: 'Core (3)', value: 3 },
  { label: 'Secondary (2)', value: 2 },
  { label: 'Adjacent (1)', value: 1 },
]

function SkillsTab() {
  return (
    <Flex vertical gap={8}>
      <Hint>
        Your skills. Each job's match score adds up the weights of the skills its description mentions; jobs below
        the minimum are dropped. “Off-stack” skills flag a job that mentions them but none of your core skills.
        {' '}{MATCHING_HINT}
      </Hint>
      <Form.Item name="min_match_score" label="Drop jobs with a match score below">
        <InputNumber min={0} max={100} style={{ width: 120 }} />
      </Form.Item>
      <Form.List name="skills">
        {(fields, { add, remove }) => (
          <Flex vertical gap={8}>
            {fields.map((field) => (
              <ItemRow key={field.key} field={field} list="skills" onRemove={() => remove(field.name)} withWeight />
            ))}
            <Button icon={<PlusOutlined />} style={{ alignSelf: 'start' }}
              onClick={() => add({ name: '', weight: 2, aliases: [], exclude: [], off_stack: false })}>
              Add skill
            </Button>
          </Flex>
        )}
      </Form.List>
    </Flex>
  )
}

function StacksTab() {
  return (
    <Flex vertical gap={8}>
      <Hint>
        Stacks that aren't on your resume. They're listed on each job as “other stacks it mentions”; off-stack ones
        flag a job that mentions them but none of your core skills.
      </Hint>
      <Form.List name="other_stacks">
        {(fields, { add, remove }) => (
          <Flex vertical gap={8}>
            {fields.map((field) => (
              <ItemRow key={field.key} field={field} list="other_stacks" onRemove={() => remove(field.name)} />
            ))}
            <Button icon={<PlusOutlined />} style={{ alignSelf: 'start' }}
              onClick={() => add({ name: '', aliases: [], off_stack: false })}>
              Add stack
            </Button>
          </Flex>
        )}
      </Form.List>
    </Flex>
  )
}

function ItemRow({ field, list, onRemove, withWeight }: {
  field: FormListFieldData
  list: 'skills' | 'other_stacks'
  onRemove: () => void
  withWeight?: boolean
}) {
  const name = Form.useWatch([list, field.name, 'name'])
  return (
    <Card size="small">
      <Flex gap={8} align="start" wrap>
        <Form.Item name={[field.name, 'name']} noStyle>
          <Input placeholder="Name" aria-label="Name" style={{ width: 150 }} />
        </Form.Item>
        {withWeight && (
          <Form.Item name={[field.name, 'weight']} noStyle>
            <Select options={WEIGHTS} aria-label={`Weight of ${name || 'skill'}`} style={{ width: 140 }} />
          </Form.Item>
        )}
        <div style={{ flex: '2 1 260px', minWidth: 0 }}>
          <Form.Item name={[field.name, 'aliases']} noStyle>
            <WordsInput placeholder="Spellings to match, e.g. node, nodejs" aria-label={`Spellings for ${name || 'this item'}`} />
          </Form.Item>
        </div>
        {withWeight && (
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <Form.Item name={[field.name, 'exclude']} noStyle>
              <WordsInput placeholder="Except when part of…" aria-label={`Phrases that don't count for ${name || 'this skill'}`} />
            </Form.Item>
          </div>
        )}
        <Form.Item name={[field.name, 'off_stack']} valuePropName="checked" noStyle>
          <Checkbox style={{ marginTop: 5 }}>Off-stack</Checkbox>
        </Form.Item>
        <Tooltip title="Delete">
          <Button type="text" icon={<DeleteOutlined />} aria-label={`Delete ${name || 'row'}`} onClick={onRemove} />
        </Tooltip>
      </Flex>
    </Card>
  )
}

// ---- History ---------------------------------------------------------------------------

function HistoryDrawer({ open, onClose, versions }: { open: boolean; onClose: () => void; versions: SettingsVersion[] }) {
  const { modal, message } = App.useApp()
  const save = useSaveSettings()
  const screens = Grid.useBreakpoint()

  const restore = (version: SettingsVersion) =>
    modal.confirm({
      title: `Restore version ${version.version}?`,
      content: 'It is saved as a new version, so nothing in the history is lost. The next scraper run uses it.',
      okText: 'Restore',
      onOk: () => save.mutateAsync({ settings: version.settings, note: `Restored version ${version.version}` })
        .then((saved) => {
          message.success(`Restored as version ${saved.version}`)
          onClose()
        })
        .catch((e) => message.error(`Couldn't restore: ${errorText(e)}`)),
    })

  return (
    <Drawer open={open} onClose={onClose} title="Rule history" size={screens.md ? 480 : '100%'}>
      {versions.length === 0 ? <Empty description="Nothing saved yet" /> : (
        <Flex vertical gap={8}>
          {versions.map((v, i) => {
            const previous = versions[i + 1]
            const changed = previous ? changedSections(previous.settings, v.settings) : []
            return (
              <Card key={v.version} size="small">
                <Flex justify="space-between" align="start" gap={8}>
                  <Flex vertical gap={2} style={{ minWidth: 0 }}>
                    <Flex gap={8} align="center">
                      <Typography.Text strong>Version {v.version}</Typography.Text>
                      {i === 0 && <Tag color="cyan" style={{ marginInlineEnd: 0 }}>Current</Tag>}
                    </Flex>
                    <Tooltip title={dateTime(v.created_at)}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fromNow(v.created_at)}</Typography.Text>
                    </Tooltip>
                    {v.note && <Typography.Text>{v.note}</Typography.Text>}
                    {previous && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {changed.length ? `Changed: ${changed.join(', ')}` : 'No changes from the version before'}
                      </Typography.Text>
                    )}
                  </Flex>
                  {i > 0 && <Button size="small" onClick={() => restore(v)}>Restore</Button>}
                </Flex>
              </Card>
            )
          })}
        </Flex>
      )}
    </Drawer>
  )
}
