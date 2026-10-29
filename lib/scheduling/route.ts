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

export interface SchedulingRouteOptions {
  /**
   * A bounded execution time for a READ route, in milliseconds (a function so it can be tuned without a redeploy). When it passes before the handler has answered, the
   * request's database statements stop waiting (AbortSignal), the caller gets `504 SCHEDULING_TIMEOUT` with nothing else, and the late result is discarded. Only
   * for routes that write nothing: a write must never be answered "timed out" while it may still commit.
   */
  deadlineMs?: () => number;
}

/** The answer when a bounded read ran out of time. Generic on purpose: no route, query, organisation or SQL. */
const timedOut = (): Response => schedulingJson({ error: 'This took too long to load, so nothing was returned. Nothing was changed. Please try again.', code: 'SCHEDULING_TIMEOUT' }, { status: 504 });

/**
 * One log line per request: the route TEMPLATE (dynamic segments replaced), the method, the status, the duration and the outcome. Never an organisation, user, role, session,
 * cookie, query string, body, parameter value, error message or SQL: there is nothing here that identifies a customer or could carry a token.
 */
function logRequest(request: Request, params: Readonly<Record<string, string>> | null, status: number, startedAt: number, outcome: 'ok' | 'denied' | 'error' | 'timeout' | 'unavailable', errorCode?: string): void {
  // Before the route's params were resolved (a denial, an unconfigured organisation, a deadline hit while the runtime was loading) no path is logged at all: the params
  // are only read after authorisation, and a denied request must not have its ids written anywhere.
  let route = '/api/scheduling/(not resolved)';
  if (params) {
    try {
      const values = new Set(Object.values(params));
      route = new URL(request.url).pathname.split('/').map(segment => (values.has(segment) ? ':id' : segment)).join('/');
    } catch {
      route = 'unknown';
    }
  }
  const line: Record<string, string | number> = { route, method: request.method, status, ms: Math.round(performance.now() - startedAt), outcome };
  if (errorCode) line.error = errorCode;
  console.info('[scheduling] request', JSON.stringify(line));
}

export function schedulingRoute(permission: SchedulingPermission, handler: SchedulingRouteHandler, options: SchedulingRouteOptions = {}) {
  const schedulingRouteHandler = async (request: Request, routeContext?: SchedulingNextRouteContext): Promise<Response> => {
    const startedAt = performance.now();
    let loggedParams: Readonly<Record<string, string>> | null = null; // set only after authorisation and the runtime, for the log line's route template
    let logged = false; // one line per request: a result that arrives after the deadline is not logged again
    const finish = (response: Response, outcome: Parameters<typeof logRequest>[4], errorCode?: string): Response => {
      if (!logged) {
        logged = true;
        logRequest(request, loggedParams, response.status, startedAt, outcome, errorCode);
      }
      return response;
    };

    const auth = await authorizeSchedulingRequest(permission);
    if (!auth.ok) return finish(withNoStore(auth.response), 'denied');

    const controller = options.deadlineMs ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = controller
      ? new Promise<'timeout'>(resolve => {
          timer = setTimeout(() => {
            controller.abort();
            resolve('timeout');
          }, options.deadlineMs!());
        })
      : null;

    const work = (async (): Promise<Response> => {
      let runtime: SchedulingRuntime;
      try {
        runtime = await loadSchedulingRuntime(auth.session, controller ? { signal: controller.signal } : {});
      } catch (err) {
        if (err instanceof SchedulingConfigurationError) {
          return finish(schedulingJson({ error: 'Scheduling is not configured for this organisation.', code: err.code }, { status: 503 }), 'unavailable', err.code);
        }
        const code = (err as { code?: string })?.code ?? (err as Error)?.name;
        if (!logged) console.error('[scheduling] runtime unavailable', code); // not after the deadline already answered: that is the abort, not a fault
        return finish(schedulingJson({ error: 'Scheduling is temporarily unavailable.' }, { status: 503 }), 'unavailable', code);
      }
      try {
        const params = await resolveParams(routeContext);
        loggedParams = params;
        return finish(withNoStore(await handler({ ...runtime, session: auth.session, request, params })), 'ok');
      } catch (err) {
        const code = (err as { code?: string })?.code ?? (err as Error)?.name;
        if (!logged) console.error('[scheduling] handler failed', code);
        return finish(schedulingJson({ error: 'Internal error.' }, { status: 500 }), 'error', code);
      }
    })();

    try {
      if (!deadline) return await work;
      const winner = await Promise.race([work, deadline]);
      if (winner === 'timeout') {
        work.catch(() => undefined); // the aborted work settles later; its result is discarded
        return finish(timedOut(), 'timeout');
      }
      return winner;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  // Direct service callers may omit dynamic params; Next's HTTP export checker
  // inspects the last signature, where the framework always supplies context.
  return schedulingRouteHandler as {
    (request: Request, context?: SchedulingNextRouteContext): Promise<Response>;
    (request: Request, context: Required<SchedulingNextRouteContext>): Promise<Response>;
  };
}

/** Only plain string segments are kept; anything else (an array from a catch-all, undefined) is dropped, so a handler sees strings or nothing. */
async function resolveParams(routeContext: SchedulingNextRouteContext | undefined): Promise<Readonly<Record<string, string>>> {
  const raw = routeContext?.params ? await routeContext.params : {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') out[key] = value;
  return out;
}
