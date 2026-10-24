import { authorizeSchedulingRequest } from './access';
import { loadSchedulingRuntime, SchedulingConfigurationError, type SchedulingRuntime } from './runtime';
import type { OrgSession } from '@/lib/org';
import type { SchedulingPermission } from '@scheduling/core';

// Phase 2B.1 — the ONE way to write a Scheduling API route. Every handler under app/api/scheduling/** is created with
// schedulingRoute(permission, handler); tests/containment/schedulingPhase2b1Containment.test.ts fails the build for any
// route that is not (or that reaches the session, the database or the repositories by another path).
//
// Order, each step failing closed before the next runs:
//   1. authorizeSchedulingRequest: session (401) -> capability for the SESSION's organisation (403; 503 if it cannot be
//      determined) -> the role's permission (403) -> a TenantContext. The organisation is the session's; this function
//      takes no organisation argument and the handler is given none from the request.
//   2. loadSchedulingRuntime: organisation timezone and the explicit settings row. A missing row or unusable timezone is
//      a controlled 503 (SCHEDULING_NOT_CONFIGURED); any other failure is a generic 503. Nothing is created or repaired.
//   3. the handler, with the runtime. A throw becomes a generic 500 with no internal detail.
// Every response, including denials, is `Cache-Control: no-store`.

export interface SchedulingRouteContext extends SchedulingRuntime {
  session: OrgSession;
  request: Request;
  /** The route's dynamic segments (Phase 2B.2b), already awaited. Empty for a route without any. Always strings; never an organisation. */
  params: Readonly<Record<string, string>>;
}

/** What Next passes as the second argument of a route handler: `params` is a Promise (Next 15+). */
export interface SchedulingNextRouteContext {
  params?: Promise<Record<string, string | string[] | undefined>>;
}

export type SchedulingRouteHandler = (context: SchedulingRouteContext) => Promise<Response> | Response;

export function schedulingJson(body: unknown, init?: { status?: number }): Response {
  return withNoStore(Response.json(body, { status: init?.status ?? 200 }));
}

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function schedulingRoute(permission: SchedulingPermission, handler: SchedulingRouteHandler) {
  return async function schedulingRouteHandler(request: Request, routeContext?: SchedulingNextRouteContext): Promise<Response> {
    const auth = await authorizeSchedulingRequest(permission);
    if (!auth.ok) return withNoStore(auth.response);

    let runtime: SchedulingRuntime;
    try {
      runtime = await loadSchedulingRuntime(auth.session);
    } catch (err) {
      if (err instanceof SchedulingConfigurationError) {
        return schedulingJson({ error: 'Scheduling is not configured for this organisation.', code: err.code }, { status: 503 });
      }
      console.error('[scheduling] runtime unavailable', (err as { code?: string })?.code ?? (err as Error)?.name);
      return schedulingJson({ error: 'Scheduling is temporarily unavailable.' }, { status: 503 });
    }

    try {
      const params = await resolveParams(routeContext);
      return withNoStore(await handler({ ...runtime, session: auth.session, request, params }));
    } catch (err) {
      console.error('[scheduling] handler failed', (err as { code?: string })?.code ?? (err as Error)?.name);
      return schedulingJson({ error: 'Internal error.' }, { status: 500 });
    }
  };
}

/** Only plain string segments are kept; anything else (an array from a catch-all, undefined) is dropped, so a handler sees strings or nothing. */
async function resolveParams(routeContext: SchedulingNextRouteContext | undefined): Promise<Readonly<Record<string, string>>> {
  const raw = routeContext?.params ? await routeContext.params : {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') out[key] = value;
  return out;
}
