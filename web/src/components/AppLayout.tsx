import { Link, Outlet, useLocation } from 'react-router-dom'
import { Button, Flex, Grid, Layout, Menu, Tag, theme, Tooltip, Typography } from 'antd'
import {
  FilterOutlined, LogoutOutlined, MoonOutlined, RocketOutlined, SunOutlined, UnorderedListOutlined,
} from '@ant-design/icons'
import { useApi } from '../data/hooks'
import { useAuth } from '../data/authContext'
import type { ThemeMode } from '../lib/theme'

const NAV = [
  { key: '/', icon: <UnorderedListOutlined />, label: <Link to="/">Jobs</Link> },
  { key: '/filtered', icon: <FilterOutlined />, label: <Link to="/filtered">Filtered out</Link> },
]

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
          display: 'flex', alignItems: 'center', gap: 16, paddingInline: 16,
          background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex gap={10} align="center">
          <Flex align="center" justify="center" aria-hidden
            style={{
              width: 32, height: 32, borderRadius: 8, color: '#fff', fontSize: 16,
              background: `linear-gradient(135deg, ${token.colorPrimary}, #0891b2)`,
            }}>
            <RocketOutlined />
          </Flex>
          {screens.sm && <Typography.Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>JobTracker</Typography.Title>}
        </Flex>
        {api.demo && screens.sm && <Tag color="gold">Demo · sample data</Tag>}
        <Menu
          mode="horizontal"
          selectedKeys={[pathname === '/filtered' ? '/filtered' : '/']}
          items={NAV}
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
