import { listSchedulingAudit } from '@/lib/scheduling/audit';
import { schedulingJson, schedulingRoute } from '@/lib/scheduling/route';

// Phase 2B.1 foundation route: the organisation's Scheduling audit trail. Any caller who may view Scheduling can read
// it; customer-identifying detail is included only for a caller holding scheduling.audit.identity (stripped on the
// server in listSchedulingAudit). The only inputs are `limit` and `before`; the organisation is never an input.
export const dynamic = 'force-dynamic';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export const GET = schedulingRoute('scheduling.view', async ({ tenant, request }) => {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const before = url.searchParams.get('before');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return schedulingJson({ error: 'limit must be an integer from 1 to 100.' }, { status: 400 });
  if (before !== null && !ISO_INSTANT.test(before)) return schedulingJson({ error: 'before must be an ISO instant such as 2026-10-23T00:00:00Z.' }, { status: 400 });

  const entries = await listSchedulingAudit(tenant, { limit, before: before ?? undefined });
  return schedulingJson({ entries, identity_visible: tenant.can('scheduling.audit.identity') });
});
