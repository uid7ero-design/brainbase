export const LD_TENNIS_ORG_ID = process.env.LD_TENNIS_ORG_ID ?? ''

export function isLDTennis(orgId: string): boolean {
  return !!orgId && orgId === LD_TENNIS_ORG_ID
}

export type NavItem = {
  label: string
  href: string
  icon: string
  comingSoon?: boolean
}

export type OrgConfig = {
  orgId: string
  name: string
  dashboardLabel: string
  insightsLabel: string
  actionsLabel: string
  defaultRoute: string
  navItems: NavItem[]
}

const LD_TENNIS_CONFIG: OrgConfig = {
  orgId: LD_TENNIS_ORG_ID,
  name: 'LD Tennis',
  dashboardLabel: 'Coaching Dashboard',
  insightsLabel: 'Client Insights',
  actionsLabel: 'Next Best Actions',
  defaultRoute: '/dashboard/leads',
  navItems: [
    { label: 'Coaching Dashboard', href: '/dashboard', icon: '🎾' },
    { label: 'Leads', href: '/dashboard/leads', icon: '📋' },
    { label: 'Contacts', href: '/dashboard/contacts', icon: '👤', comingSoon: true },
    { label: 'Bookings', href: '/dashboard/bookings', icon: '📅', comingSoon: true },
  ],
}

const DEFAULT_CONFIG: OrgConfig = {
  orgId: '',
  name: 'BrainBase',
  dashboardLabel: 'Dashboard',
  insightsLabel: 'Insights',
  actionsLabel: 'Actions',
  defaultRoute: '/dashboard',
  navItems: [
    { label: 'Overview', href: '/dashboard', icon: '📊' },
  ],
}

export function getOrgConfig(orgId: string): OrgConfig {
  if (isLDTennis(orgId)) return { ...LD_TENNIS_CONFIG, orgId }
  return DEFAULT_CONFIG
}

// Single-tenant helper — reads org from env (no auth session yet)
export function getCurrentOrgId(): string {
  return process.env.LD_TENNIS_ORG_ID ?? ''
}
