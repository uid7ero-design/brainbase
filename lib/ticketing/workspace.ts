import { authorizeTicketingApiRequest } from './authorize';
import { LIMITS, limit } from './rateLimit';
import { ticketingJson } from './http';
import { OVERVIEW_EVENT_CAP, readOrganiserOverview, readWorkspaceEvents } from '@/lib/events/organiserOverview';

const EVENT_FIELDS = ['id', 'name', 'slug', 'status', 'venue', 'starts_at', 'ends_at', 'timezone', 'session_count', 'ticket_type_count'] as const;

// One fresh authorisation for initial identity + event list (+ optional totals).
// No shared/session cache: revocation, role changes and tenant scope are checked
// on every request, exactly as on the original separate endpoints.
export async function handleOrganiserWorkspace(req: Request, withOverview: boolean) {
  const auth = await authorizeTicketingApiRequest(req, 'viewer');
  if (!auth.ok) return auth.response;
  const c = auth.context;
  const decision = await limit(LIMITS.organiserRead, [c.organisationId, c.userId]);
  if (!decision.allowed) return ticketingJson({ error: decision.reason === 'UNAVAILABLE' ? 'Unable to verify request limits right now.' : 'Too many requests. Please slow down.' }, decision.reason === 'UNAVAILABLE' ? 503 : 429);
  const events = (await readWorkspaceEvents(c.organisationId)).map(row => Object.fromEntries(EVENT_FIELDS.map(k => [k, row[k] ?? null])));
  const overview = withOverview ? {
    eventCount: events.length,
    publishedCount: events.filter(e => e.status === 'PUBLISHED').length,
    ...await readOrganiserOverview(c.organisationId, events.map(e => String(e.id))),
    truncated: events.length > OVERVIEW_EVENT_CAP,
  } : undefined;
  return ticketingJson({ user: { id: c.userId, name: c.name, role: c.role }, organisationId: c.organisationId, organisation: { slug: c.organisationSlug, name: c.organisationName }, events, ...(overview ? { overview } : {}) });
}
