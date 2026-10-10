import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { parsePeopleRegisterQuery } from '@/lib/hr/peopleRegisterContract';
import { loadPeopleRegister } from '@/lib/hr/peopleRegisterQueries';
import { HR_REGISTER_MAX_BYTES } from '@/lib/hr/registerPaging';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers }); }
  try { await requireHrCapability(session.organisationId, session.role); } catch (error) {
    return NextResponse.json({ error: error instanceof CapabilityDatabaseError ? 'Unable to verify People access.' : 'Forbidden' },
      { status: error instanceof CapabilityDatabaseError ? 503 : 403, headers });
  }
  let query;
  try { query = parsePeopleRegisterQuery(request.url); } catch { return NextResponse.json({ error: 'Invalid People query.' }, { status: 400, headers }); }
  try {
    const snapshot = await loadPeopleRegister(session, query);
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > HR_REGISTER_MAX_BYTES) throw new Error('People response too large');
    return NextResponse.json(snapshot, { headers });
  } catch { return NextResponse.json({ error: 'Unable to load People.' }, { status: 503, headers }); }
}
