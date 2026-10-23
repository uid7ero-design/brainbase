import { schedulingJson, schedulingRoute } from '@/lib/scheduling/route';

// Phase 2B.1 foundation route: proves the access guard and the runtime end to end and returns configuration only.
// It reads no customer, booking or schedule data. Everything comes from the session's organisation via the guard.
export const dynamic = 'force-dynamic';

const KNOWN = ['scheduling.view', 'scheduling.manage', 'scheduling.reserve', 'scheduling.attendance', 'scheduling.audit.identity'] as const;

export const GET = schedulingRoute('scheduling.view', ({ tenant, settings, timezone }) =>
  schedulingJson({
    configured: true,
    timezone: timezone.value,
    timezone_source: timezone.source,
    currency: settings.currency,
    // 'reduced' = a read-only caller (viewer): no management, no customer-identifying audit detail.
    access: {
      scope: tenant.can('scheduling.manage') ? 'full' : 'reduced',
      permissions: KNOWN.filter(p => tenant.can(p)),
    },
  }),
);
