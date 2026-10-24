import { Link, Outlet, useLocation } from 'react-router-dom'
import { Button, Flex, Grid, Layout, Menu, Tag, theme, Tooltip, Typography } from 'antd'
import {
  BarChartOutlined, ControlOutlined, FilterOutlined, LogoutOutlined, MoonOutlined, ProjectOutlined, SunOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useApi } from '../data/hooks'
import { useAuth } from '../data/authContext'
import type { ThemeMode } from '../lib/theme'

// Phones drop the icons and shorten a label so both links fit beside the logo.
const nav = (compact: boolean) => [
  { key: '/', icon: compact ? undefined : <UnorderedListOutlined />, label: <Link to="/">Jobs</Link> },
  { key: '/board', icon: compact ? undefined : <ProjectOutlined />, label: <Link to="/board">Board</Link> },
  {
    key: '/analytics',
    icon: compact ? undefined : <BarChartOutlined />,
    label: <Link to="/analytics">{compact ? 'Stats' : 'Analytics'}</Link>,
  },
  {
    key: '/filtered',
    icon: compact ? undefined : <FilterOutlined />,
    label: <Link to="/filtered">{compact ? 'Filtered' : 'Filtered out'}</Link>,
  },
  { key: '/rules', icon: compact ? undefined : <ControlOutlined />, label: <Link to="/rules">Rules</Link> },
]

/** The nav item for a path: "/board/x" -> "/board". */
const navKey = (pathname: string) => `/${pathname.split('/')[1] ?? ''}`

export function AppLayout({ themeMode, onToggleTheme }: { themeMode: ThemeMode; onToggleTheme: () => void }) {
  const api = useApi()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { token } = theme.useToken()
  const screens = Grid.useBreakpoint()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          display: 'flex', alignItems: 'center', gap: screens.sm ? 16 : 8, paddingInline: 16,
          background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex gap={10} align="center">
          <Flex align="center" justify="center" aria-hidden
            style={{
              width: 30, height: 30, borderRadius: token.borderRadius, fontSize: 13, fontWeight: 700,
              letterSpacing: '0.02em', color: token.colorBgContainer, background: token.colorPrimary,
            }}>
            JT
          </Flex>
          {screens.sm && <Typography.Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>JobTracker</Typography.Text>}
        </Flex>
        {api.demo && (
          <Tooltip title="Sample data: changes last until you reload">
            <Tag style={{
              marginInlineEnd: 0, color: token.colorText, background: token.colorWarningBg,
              borderColor: token.colorWarningBorder,
            }}>{screens.sm ? 'Demo · sample data' : 'Demo'}</Tag>
          </Tooltip>
        )}
        <Menu
          mode="horizontal"
          selectedKeys={[navKey(pathname)]}
          items={nav(!screens.sm)}
          style={{ flex: 1, minWidth: 0, borderBottom: 'none', background: 'transparent' }}
        />
        <Flex gap={4} align="center">
          <Tooltip title={themeMode === 'dark' ? 'Light mode' : 'Dark mode'}>
            <Button type="text" aria-label="Toggle dark mode" onClick={onToggleTheme}
              icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />} />
          </Tooltip>
          {!api.demo && (
            <Tooltip title={`Sign out ${user?.email ?? ''}`}>
              <Button type="text" aria-label="Sign out" icon={<LogoutOutlined />} onClick={() => api.auth.signOut()} />
            </Tooltip>
          )}
        </Flex>
      </Layout.Header>
      <Layout.Content style={{ padding: 16, maxWidth: 1400, width: '100%', margin: '0 auto' }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  )
}
