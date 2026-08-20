import 'server-only'

// Central sender/recipient resolution for the direct-Resend email sends in
// app/api/lead, app/api/request-demo, app/api/leads/[id], and
// app/api/admin/pipeline/[id]/messages — the four routes that call
// getResendClient() + resend.emails.send() themselves rather than going
// through lib/email.ts's sendEmail() (which already has its own EMAIL_FROM
// resolution and is untouched by this module).
//
// LD Tennis identity is resolved the same way app/api/lead/route.ts,
// app/api/tennis/book/route.ts, and app/api/hlna/briefing/route.ts already
// resolve it — an exact match against process.env.LD_TENNIS_ORG_ID — rather
// than introducing a second, slug-based tenant-identity mechanism alongside
// the one lib/dashboard/clientDashboard.ts already uses for /dashboard
// routing. That keeps this a pure, synchronous, zero-DB-round-trip check,
// safe to call from every email send path including the unauthenticated
// public /api/lead endpoint, and reuses an existing pattern rather than
// duplicating tenant resolution.
//
// process.env is read fresh on every call (not cached in a module-level
// const) so that a configured value always reflects the current
// environment — this function is cheap enough that memoization isn't
// worth the complexity, and its tests rely on being able to vary env vars
// between calls within one module load.

export type EmailConfig = { from: string; to: string }

const DEFAULT_GENERIC_FROM = 'Brainbase <noreply@brainbase.app>'
const DEFAULT_GENERIC_TO = 'hello@hlna.com.au'

function isLdTennisOrg(organisationId: string | null | undefined): boolean {
  const ldTennisOrgId = process.env.LD_TENNIS_ORG_ID
  return Boolean(ldTennisOrgId && organisationId && organisationId === ldTennisOrgId)
}

// Resolves the sender/recipient a given organisation's outgoing email
// should use. LD Tennis gets LD_TENNIS_EMAIL_FROM / LD_TENNIS_MAIL_TO when
// those are configured; every other organisation — including Brainbase
// itself, and LD Tennis before those two vars are set — gets the existing
// generic EMAIL_FROM / MAIL_TO behaviour, completely unchanged from before
// this module existed. An organisation can never inherit another
// organisation's dedicated config: the only branch into the LD Tennis
// values is the exact LD_TENNIS_ORG_ID match above, so every other id
// (including null/undefined, e.g. a failed org lookup) falls through to
// the one shared generic config, never partially mixes the two.
export function resolveEmailConfig(organisationId: string | null | undefined): EmailConfig {
  const genericFrom = process.env.EMAIL_FROM ?? DEFAULT_GENERIC_FROM
  const genericTo = process.env.MAIL_TO ?? DEFAULT_GENERIC_TO

  if (isLdTennisOrg(organisationId)) {
    return {
      from: process.env.LD_TENNIS_EMAIL_FROM ?? genericFrom,
      to: process.env.LD_TENNIS_MAIL_TO ?? genericTo,
    }
  }

  return { from: genericFrom, to: genericTo }
}
