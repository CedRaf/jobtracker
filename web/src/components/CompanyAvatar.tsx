import { Avatar } from 'antd'

// Muted colours that read well on light and dark backgrounds.
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#2563eb', '#dc2626']

function colorFor(name: string) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

/** The company's first letter on a colour picked from its name. */
export function CompanyAvatar({ company }: { company: string | null }) {
  const name = company?.trim() || '?'
  return (
    <Avatar shape="square" size={36} style={{ background: colorFor(name), flexShrink: 0, fontWeight: 600 }}>
      {name.charAt(0).toUpperCase()}
    </Avatar>
  )
}
