import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { coachingAccess } from './coachingAccess';
import sql from '@/lib/db';
import { coachingCapacityReady } from './coachingSafety';
import * as sessions from '@/app/api/dashboard/sessions/route';
import * as session from '@/app/api/dashboard/sessions/[id]/route';
import * as instances from '@/app/api/dashboard/sessions/instances/route';
import * as instance from '@/app/api/dashboard/sessions/[id]/instances/[instanceId]/route';
import * as generate from '@/app/api/dashboard/sessions/[id]/generate-instances/route';
import * as archive from '@/app/api/dashboard/sessions/[id]/archive/route';
import * as restore from '@/app/api/dashboard/sessions/[id]/restore/route';
import * as reconcile from '@/app/api/dashboard/sessions/reconcile/route';
import * as types from '@/app/api/dashboard/session-types/route';
import * as type from '@/app/api/dashboard/session-types/[id]/route';
import * as enrolments from '@/app/api/dashboard/enrolments/route';
import * as enrolment from '@/app/api/dashboard/enrolments/[id]/route';
import * as pause from '@/app/api/dashboard/enrolments/[id]/pause/route';
import * as removeFuture from '@/app/api/dashboard/enrolments/remove-future/route';
import * as booking from '@/app/api/bookings/[id]/route';
import * as players from '@/app/api/contacts/route';

type Params = { id: string; instanceId: string };
type Handler = (request: NextRequest, context: { params: Promise<Params> }) => Promise<Response>;
type Endpoint = { match: RegExp; methods: Partial<Record<string, Handler>>; id?: number; instanceId?: number };
// Existing records include both UUID and Prisma CUID identifiers. Values remain bound SQL parameters.
const id = '([A-Za-z0-9][A-Za-z0-9_-]{0,127})';
// Closed dispatch table, never an arbitrary URL, module name or internal request supplied by a caller.
const endpoints: Endpoint[] = [
  { match: /^sessions$/, methods: { GET: sessions.GET, POST: sessions.POST } },
  { match: /^sessions\/instances$/, methods: { GET: instances.GET } },
  { match: /^sessions\/reconcile$/, methods: { POST: reconcile.POST } },
  { match: new RegExp(`^sessions/${id}$`), methods: { GET: session.GET, PATCH: session.PATCH, DELETE: session.DELETE }, id: 1 },
  { match: new RegExp(`^sessions/${id}/instances/${id}$`), methods: { GET: instance.GET, POST: instance.POST }, id: 1, instanceId: 2 },
  { match: new RegExp(`^sessions/${id}/generate-instances$`), methods: { POST: generate.POST }, id: 1 },
  { match: new RegExp(`^sessions/${id}/archive$`), methods: { POST: archive.POST }, id: 1 },
  { match: new RegExp(`^sessions/${id}/restore$`), methods: { POST: restore.POST }, id: 1 },
  { match: /^types$/, methods: { GET: types.GET, POST: types.POST } },
  { match: new RegExp(`^types/${id}$`), methods: { PATCH: type.PATCH }, id: 1 },
  { match: /^enrolments$/, methods: { POST: enrolments.POST } },
  { match: /^enrolments\/remove-future$/, methods: { POST: removeFuture.POST } },
  { match: new RegExp(`^enrolments/${id}$`), methods: { PATCH: enrolment.PATCH, DELETE: enrolment.DELETE }, id: 1 },
  { match: new RegExp(`^enrolments/${id}/pause$`), methods: { POST: pause.POST, DELETE: pause.DELETE }, id: 1 },
  { match: new RegExp(`^bookings/${id}$`), methods: { PATCH: booking.PATCH }, id: 1 },
  { match: /^players$/, methods: { GET: players.GET } },
];
const headers = { 'Cache-Control': 'private, no-store' };
export async function handleCoaching(request: NextRequest, segments: string[]) {
  const write = !['GET', 'HEAD'].includes(request.method);
  const access = await coachingAccess(write);
  if (!access.ok) return NextResponse.json({ error: 'Coaching timetable unavailable.' }, { status: access.status, headers });
  if (write) {
    // Next can expose its internal HTTP origin behind TLS. Host is the public
    // request authority, matching organisation administration's proxy handling.
    try {
      const origin = request.headers.get('origin');
      const parsed = new URL(origin ?? '');
      if (parsed.origin !== origin || parsed.host !== (request.headers.get('host') ?? request.nextUrl.host)
        || !['http:', 'https:'].includes(parsed.protocol)
        || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error();
    } catch { return NextResponse.json({ error: 'Request refused.' }, { status: 403, headers }); }
  }
  if (write) {
    try {
      if (!await coachingCapacityReady()) return NextResponse.json({ error: 'Coaching changes are not enabled until capacity protection is verified.', code: 'COACHING_SAFETY_NOT_READY' }, { status: 503, headers });
    } catch { return NextResponse.json({ error: 'Coaching safety could not be checked.' }, { status: 503, headers }); }
  }
  const path = segments.join('/');
  const endpoint = endpoints.find(item => item.match.test(path));
  const match = endpoint?.match.exec(path);
  if (!endpoint || !match) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers });
  const handler = endpoint.methods[request.method];
  if (!handler) return NextResponse.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: Object.keys(endpoint.methods).join(', ') } });
  // Keep the compatibility surface tenant-bound even where a legacy handler permits owner overrides.
  if (endpoint.id) {
    const recordId = match[endpoint.id];
    const oid = access.session.organisationId;
    try {
      const rows = path.startsWith('sessions/')
        ? endpoint.instanceId
          ? await sql`SELECT i.id FROM session_instances i JOIN sessions s ON s.id=i.session_id WHERE i.id=${match[endpoint.instanceId]} AND s.id=${recordId} AND s.organisation_id=${oid}`
          : await sql`SELECT id FROM sessions WHERE id=${recordId} AND organisation_id=${oid}`
        : path.startsWith('types/')
          ? await sql`SELECT id FROM session_types WHERE id=${recordId} AND organisation_id=${oid}`
          : await sql`SELECT id FROM bookings WHERE id=${recordId} AND organisation_id=${oid}`;
      if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers });
    } catch { return NextResponse.json({ error: 'Saved coaching records unavailable.' }, { status: 503, headers }); }
  }
  if (path.startsWith('bookings/')) {
    const body = await request.clone().json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['paid', 'attendance_status'].includes(key))) return NextResponse.json({ error: 'Only coaching attendance and paid markers may be changed here.' }, { status: 400, headers });
  }
  try {
    const response = await handler(request, { params: Promise.resolve({ id: endpoint.id ? match[endpoint.id] : '', instanceId: endpoint.instanceId ? match[endpoint.instanceId] : '' }) });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch { return NextResponse.json({ error: write ? 'The change could not be confirmed. Review saved coaching records before trying again.' : 'Saved coaching records could not be loaded.' }, { status: 503, headers }); }
}
