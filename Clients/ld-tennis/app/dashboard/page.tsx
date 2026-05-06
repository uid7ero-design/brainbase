import { redirect } from 'next/navigation'
import { getOrgConfig, getCurrentOrgId } from '@/lib/org'

export default function DashboardPage() {
  const orgId = getCurrentOrgId()
  const config = getOrgConfig(orgId)
  redirect(config.defaultRoute)
}
