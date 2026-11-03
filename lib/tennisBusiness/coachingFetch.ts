/** Compatibility view only. The old page keeps its original endpoints outside the business workspace. */
export function isCoachingWorkspace() {
  return typeof window !== 'undefined' && window.location.pathname === '/business/tennis/coaching';
}
export function coachingEndpoint(input: string, inCoaching: boolean): string {
  if (!inCoaching) return input;
  for (const [legacy, replacement] of [
    ['/api/dashboard/session-types', 'types'], ['/api/dashboard/sessions', 'sessions'],
    ['/api/dashboard/enrolments', 'enrolments'], ['/api/bookings', 'bookings'], ['/api/contacts', 'players'],
  ]) {
    if (input === legacy || input.startsWith(legacy + '/') || input.startsWith(legacy + '?')) return '/api/business/tennis/coaching/' + replacement + input.slice(legacy.length);
  }
  return input;
}
export const COACHING_LOCK = 'brainbase:ld-tennis-coaching:unconfirmed';
export const COACHING_FAILURE = 'brainbase:ld-tennis-coaching:failure';
let pendingWrites = 0;
let unknownWrite = false;
export function coachingWritePending() { return pendingWrites > 0; }
export function clearCoachingLock() {
  if (pendingWrites) throw new Error('Wait for the current change to finish.');
  sessionStorage.removeItem(COACHING_LOCK); unknownWrite = false;
}
function failed(write: boolean) {
  if (write) { unknownWrite = true; try { sessionStorage.setItem(COACHING_LOCK, '1'); } catch { /* fail closed in the recovery shell */ } }
  window.dispatchEvent(new Event(COACHING_FAILURE));
  return Response.json({ error: 'Saved coaching records could not be confirmed. Review the timetable before repeating a change.' }, { status: 503 });
}
export async function coachingFetch(input: RequestInfo | URL, init?: RequestInit) {
  const inCoaching = isCoachingWorkspace();
  if (!inCoaching || typeof input !== 'string') return globalThis.fetch(input, init);
  const url = coachingEndpoint(input, true);
  if (!url.startsWith('/api/business/tennis/coaching/')) return globalThis.fetch(input, init);
  const write = !['GET', 'HEAD'].includes(init?.method ?? 'GET');
  if (write) {
    if (pendingWrites) return Response.json({ error: 'Wait for the current change to finish.' }, { status: 409 });
    try {
      if (unknownWrite || (sessionStorage.getItem(COACHING_LOCK) && pendingWrites === 0)) return failed(true);
      sessionStorage.setItem(COACHING_LOCK, '1'); pendingWrites++;
    } catch { return failed(true); }
  }
  try {
    const response = await globalThis.fetch(url, { ...init, cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(30000) });
    if (!response.ok && (!write || response.status >= 500 || response.status === 408)) return failed(write);
    if (response.ok) {
      const body = await response.clone().json();
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || body.error) return failed(write);
      if (!write) {
        const path = url.split('?')[0].slice('/api/business/tennis/coaching/'.length);
        const list = path === 'sessions' ? 'sessions' : path === 'sessions/instances' ? 'instances' : path === 'types' ? 'types' : path === 'players' ? 'contacts' : null;
        if (list && !Array.isArray(body[list])) return failed(false);
        if (/^sessions\/[^/]+$/.test(path) && path !== 'sessions/instances' && (!body.session || !Array.isArray(body.instances))) return failed(false);
        if (/^sessions\/[^/]+\/instances\/[^/]+$/.test(path) && (!body.instance || !Array.isArray(body.bookings))) return failed(false);
      }
    }
    return response;
  } catch { return failed(write); }
  finally {
    if (write) {
      pendingWrites--;
      if (!pendingWrites && !unknownWrite) { try { sessionStorage.removeItem(COACHING_LOCK); } catch { failed(true); } }
    }
  }
}
