import 'server-only';
import { NextResponse } from 'next/server';
import { ASSURANCE_MIN_ROLE, authorizeAssuranceRequest, type AssuranceViewer } from './authorize';
import { assuranceErrorResponse, readJsonObject } from './http';

// Route-handler factories for app/api/assurance/**. Each produced handler:
//   1. authorizes (session -> 'assurance' capability -> role floor) BEFORE
//      reading the body,
//   2. hands the service ONLY the DB-derived viewer + the raw JSON object
//      (services allow-list fields; no body is ever spread into SQL),
//   3. maps typed service errors to 4xx and hides unexpected errors.
// organisationId never comes from the request.

type Operation = keyof typeof ASSURANCE_MIN_ROLE;
type IdCtx = { params: Promise<{ id: string }> };

export function assurancePost(
  operation: Operation,
  handler: (viewer: AssuranceViewer, body: Record<string, unknown>) => Promise<unknown>,
  label: string,
) {
  return async function POST(req: Request): Promise<Response> {
    const auth = await authorizeAssuranceRequest(ASSURANCE_MIN_ROLE[operation]);
    if (!auth.ok) return auth.response;
    try {
      const body = await readJsonObject(req);
      const result = await handler(auth.viewer, body);
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return assuranceErrorResponse(err, label);
    }
  };
}

export function assurancePostWithId(
  operation: Operation,
  handler: (viewer: AssuranceViewer, id: string, body: Record<string, unknown>) => Promise<unknown>,
  label: string,
) {
  return async function POST(req: Request, ctx: IdCtx): Promise<Response> {
    const auth = await authorizeAssuranceRequest(ASSURANCE_MIN_ROLE[operation]);
    if (!auth.ok) return auth.response;
    try {
      const { id } = await ctx.params;
      const body = await readJsonObject(req);
      const result = await handler(auth.viewer, id, body);
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return assuranceErrorResponse(err, label);
    }
  };
}
