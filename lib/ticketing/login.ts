import 'server-only';
import bcrypt from 'bcryptjs';
import sql from '@/lib/db';
import { checkRateLimit, resetRateLimit } from '@/lib/rateLimit';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import type { Role } from '@/lib/session';
import { checkTicketingGate, TICKETING_SESSION_HEADER } from './gate';
import { ticketingClientIp } from './http';
import { issueTicketingSession, verifyTicketingSession } from './session';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE });

// One response for every credential/eligibility failure, so the endpoint
// cannot be used to learn which usernames exist, are disabled, or belong to
// organisations without the capability.
const INVALID = () => json({ error: 'Invalid username or password.' }, 401);

export type EligibleOrganisation = { id: string; name: string };

// Organisation eligible for the ticketing product: ACTIVE and holding the
// 'events' capability (same canonical check authorizeEventsRequest uses).
export async function isEligibleOrganisation(organisationId: string): Promise<boolean> {
  const rows = await sql`SELECT status FROM organisations WHERE id = ${organisationId} LIMIT 1`;
  if (!rows[0] || String(rows[0].status ?? '').toUpperCase() !== 'ACTIVE') return false;
  return (await checkCapability(organisationId, 'events')).allowed;
}

export async function listEligibleOrganisations(): Promise<EligibleOrganisation[]> {
  const rows = await sql`
    SELECT o.id, o.name
    FROM organisations o
    JOIN organisation_modules om ON om.organisation_id = o.id AND om.module_key = 'events' AND om.enabled = true
    JOIN modules m ON m.key = om.module_key AND m.active = true
    WHERE o.status = 'ACTIVE'
    ORDER BY o.name
  `;
  return rows.map(r => ({ id: r.id as string, name: r.name as string }));
}

let dummyHash: string | null = null;
function getDummyHash(): string {
  return (dummyHash ??= bcrypt.hashSync('not-a-real-password', 10));
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handleTicketingLogin(req: Request): Promise<Response> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate.response;

  const body = await readJson(req);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const requestedOrg = typeof body?.organisationId === 'string' ? body.organisationId : null;
  if (!username || username.length > 254 || !password || password.length > 1024) return INVALID();

  const ipKey = `ticketing-login:ip:${ticketingClientIp(req)}`;
  const userKey = `ticketing-login:user:${username}`;
  if (!checkRateLimit(ipKey, 30) || !checkRateLimit(userKey, 10)) {
    return json({ error: 'Too many attempts. Try again later.' }, 429);
  }

  let user: Record<string, unknown> | undefined;
  try {
    user = (await sql`
      SELECT id, organisation_id, role, status, name, password_hash FROM users WHERE username = ${username} LIMIT 1
    `)[0];
  } catch {
    return json({ error: 'Unable to sign in right now.' }, 503);
  }

  // Always run one bcrypt comparison so a missing user costs the same as a
  // wrong password.
  const hash = typeof user?.password_hash === 'string' ? user.password_hash : getDummyHash();
  const valid = await bcrypt.compare(password, hash);
  if (!user || !valid) return INVALID();
  if (String(user.status ?? '').toUpperCase() !== 'ACTIVE') return INVALID();

  const role = String(user.role ?? '').toLowerCase() as Role;
  const homeOrg = user.organisation_id as string;
  let organisationId = homeOrg;

  try {
    if (role === 'super_admin') {
      if (requestedOrg) organisationId = requestedOrg;
      if (!(await isEligibleOrganisation(organisationId))) {
        // Credentials were valid; super_admin may choose a different org.
        if (requestedOrg) return INVALID();
        return json(
          { error: 'ORGANISATION_SELECTION_REQUIRED', organisations: await listEligibleOrganisations() },
          409,
        );
      }
    } else {
      if (requestedOrg && requestedOrg !== homeOrg) return INVALID();
      if (!(await isEligibleOrganisation(homeOrg))) return INVALID();
    }
  } catch {
    return json({ error: 'Unable to sign in right now.' }, 503);
  }

  const issued = await issueTicketingSession(user.id as string, organisationId);
  if (!issued) return json({ error: 'Ticketing sessions are not configured.' }, 503);

  resetRateLimit(userKey);
  return json(
    {
      token: issued.token,
      expiresAt: issued.expiresAt,
      user: { id: user.id, name: user.name, role },
      organisationId,
    },
    200,
  );
}

// super_admin-only guard for the organisation endpoints. Validates the Eve
// session token and reloads the user; deliberately does NOT require the
// current organisation to be entitled, so a super_admin can switch away from
// an organisation that has lost the capability.
export async function requireActiveSuperAdmin(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const gate = checkTicketingGate(req);
  if (!gate.ok) return gate;
  const claims = await verifyTicketingSession(req.headers.get(TICKETING_SESSION_HEADER));
  if (!claims) return { ok: false, response: json({ error: 'Unauthorized' }, 401) };
  try {
    const user = (await sql`SELECT role, status FROM users WHERE id = ${claims.userId} LIMIT 1`)[0];
    if (!user || String(user.status ?? '').toUpperCase() !== 'ACTIVE') {
      return { ok: false, response: json({ error: 'Unauthorized' }, 401) };
    }
    if (String(user.role ?? '').toLowerCase() !== 'super_admin') {
      return { ok: false, response: json({ error: 'Forbidden' }, 403) };
    }
  } catch {
    return { ok: false, response: json({ error: 'Unable to verify access.' }, 503) };
  }
  return { ok: true, userId: claims.userId };
}

export async function handleOrganisationSwitch(req: Request): Promise<Response> {
  const guard = await requireActiveSuperAdmin(req);
  if (!guard.ok) return guard.response;
  const body = await readJson(req);
  const target = typeof body?.organisationId === 'string' ? body.organisationId : '';
  if (!target) return json({ error: 'organisationId is required.' }, 400);
  try {
    if (!(await isEligibleOrganisation(target))) return json({ error: 'Forbidden' }, 403);
  } catch {
    return json({ error: 'Unable to verify access.' }, 503);
  }
  const issued = await issueTicketingSession(guard.userId, target);
  if (!issued) return json({ error: 'Ticketing sessions are not configured.' }, 503);
  return json({ token: issued.token, expiresAt: issued.expiresAt, organisationId: target }, 200);
}

export async function handleOrganisationList(req: Request): Promise<Response> {
  const guard = await requireActiveSuperAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    return json({ organisations: await listEligibleOrganisations() }, 200);
  } catch {
    return json({ error: 'Unable to verify access.' }, 503);
  }
}
