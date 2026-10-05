import 'server-only';

import { NextResponse } from 'next/server';
import { forbidden, requireSession, unauthorized, type OrgSession } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { isEmployeeDocumentAdministrator } from '@/lib/hr/employeeDocumentRoute';

export async function requireEmployeeDocumentContext(): Promise<
  | { ok: true; session: OrgSession }
  | { ok: false; response: Response }
> {
  let session: OrgSession;
  try {
    session = await requireSession();
  } catch {
    return { ok: false, response: unauthorized() };
  }

  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 }),
      };
    }
    return { ok: false, response: forbidden() };
  }

  return { ok: true, session };
}

export async function requireEmployeeDocumentAdmin(session: OrgSession): Promise<NextResponse | null> {
  if (await isEmployeeDocumentAdministrator(session)) return null;
  return NextResponse.json(
    { error: 'HR administrator access is required.', code: 'hr_admin_required' },
    { status: 403 },
  );
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
