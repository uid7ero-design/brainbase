import { redirect } from 'next/navigation';
import { requireSession, roleGte } from '@/lib/org';

// Phase D.2 route promotion: /command/organiser was previously gated by
// middleware.ts's role check (manager/admin/super_admin only), matched via
// `pathname.startsWith('/command')`. Now that Organiser lives at the
// top-level /organiser route, that check no longer applies to it —
// middleware.ts's generic "must be logged in" gate still fires (any
// authenticated role reaches this layout), but the stricter manager+ gate
// does not, since middleware.ts carries pre-existing, unrelated, uncommitted
// local edits that must not be touched or bundled into this change (see the
// Phase D.2 report). This layout replicates the exact same role requirement
// as a small, isolated, additive file scoped only to this route segment —
// same redirect targets middleware used (/login when no valid session,
// /dashboard when the role is below the threshold), so behaviour for anyone
// who could previously reach /command/organiser is unchanged.
//
// requireSession() re-validates against the DB (not just the JWT), which is
// strictly stronger than middleware's decrypt-only check — e.g. a user
// deleted or reassigned after their token was issued is still correctly
// rejected here even if middleware's own check would have let the request
// through.
const ORGANISER_MIN_ROLE = 'manager';

export default async function OrganiserLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch {
    redirect('/login');
  }

  if (!roleGte(session.role, ORGANISER_MIN_ROLE)) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
