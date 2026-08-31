import HelenaWorkspace from '@/components/helena/HelenaWorkspace'

// Dedicated full-screen HLNA conversation workspace (Phase C.2B).
//
// No server-side variant branching here on purpose — unlike /dashboard,
// this route is the same experience for every authenticated tenant this
// phase; middleware.ts already gates auth for any non-public route (this
// path is not in its PUBLIC list), so no additional session check is
// needed here. Org-scoped data access happens the same way it already does
// for HelenaWorkspace's underlying pieces (useHelena's own API calls).
export default function HlnaPage() {
  return <HelenaWorkspace />
}
