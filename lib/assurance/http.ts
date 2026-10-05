import 'server-only';
import { NextResponse } from 'next/server';
import { AssuranceConfirmationRequiredError, AssuranceError } from './errors';

// Maps service errors to JSON responses for app/api/assurance/** routes.
// Unknown errors become a generic 500 — the underlying message (which may
// contain SQL/constraint detail) is logged server-side, never returned.
export function assuranceErrorResponse(err: unknown, context: string): Response {
  if (err instanceof AssuranceConfirmationRequiredError) {
    return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof AssuranceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`[assurance] ${context} failed`, err);
  return NextResponse.json({ error: 'Something went wrong. Nothing was saved.' }, { status: 500 });
}

/** Parses a JSON body into a plain object; anything else becomes {}. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
