import { getOrgConfig, getCurrentOrgId } from '@/lib/org'
import DashboardNav from './DashboardNav'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const orgId = getCurrentOrgId()
  const config = getOrgConfig(orgId)

  return (
    <div className="flex min-h-screen bg-gray-50">
      <DashboardNav config={config} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
