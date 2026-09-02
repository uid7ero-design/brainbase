import { redirect } from 'next/navigation';
import { requireSession, roleGte } from '@/lib/org';
import { checkCapability } from '@/lib/capabilities/requireCapability';

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

// Phase D.4.4C — Organiser is a registered capability (`modules.key =
// 'organiser'`) that, until now, had no entitlement enforcement anywhere
// (see the D.4.4A/D.4.4B audits): any manager+ user of ANY organisation
// could reach this route regardless of whether their organisation was ever
// granted the capability. This adds the missing layer on top of — not in
// place of — the existing role gate above, mirroring app/crm/layout.tsx's
// own checkCapability()-plus-inline-denial-screen convention: role and
// capability are both required, and neither substitutes for the other. A
// D.4.4B production pre-flight confirmed BrainBase HQ's own organisation —
// the only organisation with real Organiser data — was granted the
// entitlement before this check was added, so Founder OS's existing usage
// is preserved.
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

  const capability = await checkCapability(session.organisationId, 'organiser');
  if (!capability.allowed) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: 10,
          textAlign: 'center',
          padding: 32,
          background: '#07080B',
          color: '#f9fafb',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>Organiser isn&apos;t enabled for your organisation</div>
        <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 360 }}>
          Ask a BrainBase admin to enable the Organiser capability for your organisation to access boards and tasks.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
