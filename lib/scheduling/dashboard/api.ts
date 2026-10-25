// Client-side access to the Scheduling configuration API. Same-origin fetch: the session cookie is the credential, and the
// organisation is the session's (the API takes no organisation from the client). PURE of server imports: client components use it.
//
// Every failure becomes an ApiProblem with a plain-language message and the flags the screens act on; nothing here ever
// swallows a refusal. A write that fails changed nothing.

export interface ApiProblem {
  status: number;
  code: string;
  message: string;
  problems: string[];
  /** The record was changed by someone else since it was read (HTTP 409 STALE_WRITE): reload, nothing was written. */
  stale: boolean;
  /** The caller may not do this (401/403): the screen explains instead of retrying. */
  denied: boolean;
  /** Scheduling is not set up for this organisation yet (503 SCHEDULING_NOT_CONFIGURED). */
  notConfigured: boolean;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; problem: ApiProblem };

const MESSAGES: Record<string, string> = {
  STALE_WRITE: 'Someone else changed this while you were editing. Reload to see the latest version; your changes were not saved.',
  ARCHIVED: 'This has been archived and can no longer be changed.',
  PRESET_LOCKED: 'The type of a schedule cannot change once it has offerings.',
  RESOURCE_IN_USE: 'This resource is in use by a live reservation or an assignment, so that change is not allowed.',
  ALLOCATION_IN_USE: 'A live reservation is holding this resource for the offering, so it cannot be removed.',
  RESOURCE_INACTIVE: 'This resource is inactive. Reactivate it before assigning it.',
  KIND_NOT_ACCEPTED: 'This type of resource cannot be used with this type of schedule.',
  NOT_FOUND: 'This no longer exists, or you do not have access to it.',
  OVERLAP: 'This overlaps hours or a closure that is already saved. Change or remove the overlapping entry first. Nothing was saved.',
  AVAILABILITY_NOT_READY: 'Availability has not been set up on this installation yet. Ask a BrainBase admin to finish the setup. Nothing was saved.',
  PARTIAL_CLOSURES_NOT_READY: 'Closing part of a day has not been set up on this installation yet. Closing whole days works. Nothing was saved.',
  TRY_AGAIN: 'The system is busy. Nothing was changed; please try again.',
  SCHEDULING_NOT_CONFIGURED: 'Scheduling has not been set up for your organisation yet. Ask a BrainBase admin to finish the setup.',
  UNSUPPORTED_MEDIA_TYPE: 'The request could not be sent. Nothing was saved.',
  PAYLOAD_TOO_LARGE: 'That is too much to save at once. Nothing was saved.',
};

export function problemFrom(status: number, body: unknown): ApiProblem {
  const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; code?: unknown; problems?: unknown };
  const code = typeof b.code === 'string' ? b.code : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'ERROR';
  const problems = Array.isArray(b.problems) ? b.problems.filter((p): p is string => typeof p === 'string') : [];
  const server = typeof b.error === 'string' ? b.error : '';
  let message = MESSAGES[code] ?? '';
  if (!message) {
    if (status === 401) message = 'Your session has expired. Sign in again.';
    else if (status === 403) message = 'You do not have permission to do this.';
    else if (status === 400) message = problems.length > 0 ? 'Please fix the following.' : server || 'The request is not valid.';
    else message = server || 'Something went wrong. Nothing was saved.';
  }
  return { status, code, message, problems, stale: code === 'STALE_WRITE', denied: status === 401 || status === 403, notConfigured: code === 'SCHEDULING_NOT_CONFIGURED' };
}

export const networkProblem = (): ApiProblem => ({
  status: 0,
  code: 'NETWORK',
  message: 'Network error. Nothing was saved.',
  problems: [],
  stale: false,
  denied: false,
  notConfigured: false,
});

export async function schedulingApi<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/scheduling${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return { ok: false, problem: networkProblem() };
  }
  const data: unknown = await res.json().catch(() => null);
  return res.ok ? { ok: true, data: data as T } : { ok: false, problem: problemFrom(res.status, data) };
}

/** The ids the API puts in a path are opaque; encode them so a hostile value cannot change the path. */
export const seg = (id: string): string => encodeURIComponent(id);
