import type { ReactNode } from 'react'

export type IconName =
  | 'grid'
  | 'phone'
  | 'hash'
  | 'card'
  | 'shield'
  | 'chat'
  | 'whatsapp'
  | 'logout'
  | 'menu'
  | 'close'
  | 'search'
  | 'refresh'
  | 'check'
  | 'x'
  | 'arrow-right'
  | 'arrow-left'
  | 'clock'
  | 'eye'
  | 'eye-off'
  | 'qr'

const paths = {
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  phone: (
    <path d="M21.5 16.9v2.6a2 2 0 0 1-2.2 2 19.6 19.6 0 0 1-8.5-3 19.3 19.3 0 0 1-6-6 19.6 19.6 0 0 1-3-8.6A2 2 0 0 1 3.8 2h2.6a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.5 9.7a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 2 2Z" />
  ),
  hash: <path d="M4.5 9h15M4.5 15h15M10 3.5 8 20.5M16 3.5l-2 17" />,
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6 15h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.8 4.8 5.8v5.3c0 4.4 3 8.5 7.2 10 4.2-1.5 7.2-5.6 7.2-10V5.8Z" />
      <path d="m8.9 11.9 2.2 2.2 4.1-4.4" />
    </>
  ),
  chat: <path d="M20.5 11.6a8.2 8.2 0 0 1-8.8 8.1 9.4 9.4 0 0 1-3.3-.6L4 20.4l1.4-4.4a8.2 8.2 0 1 1 15.1-4.4Z" />,
  whatsapp: (
    <>
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 3.8H6.3A2.3 2.3 0 0 0 4 6.1v11.8a2.3 2.3 0 0 0 2.3 2.3h3.2" />
      <path d="m14.8 8 4 4-4 4M18.8 12H9" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h9" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.3 4.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4.6h-4.6" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 6.8" />,
  x: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  'arrow-right': <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  'arrow-left': <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c5.8 0 9.2 7 9.2 7a15 15 0 0 1-3.2 4M6.3 6.4A15.4 15.4 0 0 0 2.8 12s3.4 6 9.2 6a9.4 9.4 0 0 0 3.6-.7" />
      <path d="M10.2 10.2a2.6 2.6 0 0 0 3.6 3.6" />
    </>
  ),
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.5" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1.5" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1.5" />
      <path d="M14.5 14.5h2.5v2.5h-2.5zM20.5 14.5v6h-3" />
    </>
  ),
} satisfies Record<string, ReactNode>

export function Icon({ name, size = 18 }: { name: IconName, size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="brand-mark-tile" width="32" height="32" rx="9" />
      <rect className="brand-mark-bar" x="7.6" y="17.6" width="3.6" height="6.9" rx="1.8" />
      <rect className="brand-mark-bar" x="14.2" y="12.6" width="3.6" height="11.9" rx="1.8" />
      <rect className="brand-mark-bar" x="20.8" y="7.6" width="3.6" height="16.9" rx="1.8" />
    </svg>
  )
}

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <span className="brand">
      <BrandMark />
      <span className="brand-text">
        <span className="brand-name">Desk</span>
        {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
      </span>
    </span>
  )
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info'

export function Chip({ tone = 'neutral', dot = false, children }: { tone?: Tone, dot?: boolean, children: ReactNode }) {
  return (
    <span className={`chip chip--${tone}`}>
      {dot ? <span className="chip-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export function Notice({ tone = 'info', children, role }: { tone?: 'info' | 'ok' | 'warn' | 'bad', children: ReactNode, role?: 'alert' | 'status' }) {
  return (
    <p className={`notice notice--${tone}`} role={role}>
      {children}
    </p>
  )
}

export function PageHead({ kicker, title, lead, children }: { kicker: string, title: string, lead?: string, children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <p className="kicker">{kicker}</p>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  )
}

export function EmptyState({ icon, title, text, children }: { icon: IconName, title: string, text?: string, children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={20} /></span>
      <p className="empty-title">{title}</p>
      {text ? <p className="empty-text">{text}</p> : null}
      {children ? <div className="empty-action">{children}</div> : null}
    </div>
  )
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="skeleton-line" style={{ width: `${[88, 72, 58, 80][index % 4]}%` }} />
      ))}
    </div>
  )
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}
