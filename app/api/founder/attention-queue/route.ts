import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';

// ── Founder OS Phase A — real, cross-organisation attention queue ──────────
//
// super_admin only. Aggregates already-live, already-DB-backed BrainBase
// systems (alerts, client_pipeline "Requests", web_service_leads, and the
// Web Systems client_onboarding tracker) into one normalized queue plus a
// compact snapshot of real operational metrics.
//
// No new tables. No schema changes. organisation_id is always resolved
// server-side from the authenticated session/role — never trusted from the
// browser — and this route never accepts request input at all (GET, no
// query params), so there is nothing for a caller to widen scope with.

export type AttentionItemType =
  | 'alert'
  | 'client_request'
  | 'web_lead'
  | 'upcoming_launch'
  | 'overdue_deployment';

export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AttentionItem = {
  id: string;
  type: AttentionItemType;
  severity: AttentionSeverity;
  title: string;
  description: string;
  organisationId: string | null;
  organisationName: string | null;
  createdAt: string | null;
  href: string;
  metadata: Record<string, unknown>;
};

const LEAD_ACTIONABLE_STAGES = ['new', 'contacted', 'discovery', 'qualified'];
const REQUEST_ACTIONABLE_STATUSES = ['new', 'in_progress'];
const UPCOMING_WINDOW_DAYS = 14;

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

function alertSeverity(raw: unknown): AttentionSeverity {
  const v = String(raw ?? '').toUpperCase();
  if (v === 'CRITICAL') return 'critical';
  if (v === 'HIGH') return 'high';
  if (v === 'LOW') return 'low';
  return 'medium';
}

function priorityToSeverity(raw: unknown): AttentionSeverity {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'high') return 'high';
  if (v === 'low') return 'low';
  return 'medium';
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

// Neon's HTTP driver may return a DATE column as a JS Date or as a plain
// 'YYYY-MM-DD' (or full ISO timestamp) string depending on version/config —
// normalize to a bare date string either way rather than assuming one shape.
function toDateOnlyString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function GET() {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [
      alertRows,
      requestRows,
      leadRows,
      onboardingRows,
      leadStageRows,
      snapshotRows,
    ] = await Promise.all([
      // 1. Open alerts, cross-organisation. alerts.organisation_id and
      // organisations.id are both TEXT in the verified Production schema —
      // safe to join directly.
      sql`
        SELECT a.id, a.organisation_id, a.title, a.description, a.severity,
               a.module, a.rule_key, a.created_at, o.name AS org_name
        FROM public.alerts a
        LEFT JOIN organisations o ON o.id = a.organisation_id
        WHERE a.status = 'OPEN'
        ORDER BY
          CASE a.severity
            WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3
          END,
          a.created_at DESC
        LIMIT 30
      `,
      // 2. Open client requests. client_pipeline.organisation_id is UUID
      // while organisations.id is TEXT (verified) — a direct, uncast join
      // errors under Postgres (confirmed empirically against this exact
      // shape); app/api/admin/pipeline/route.ts's existing uncast join has
      // this same defect and silently swallows the resulting error via its
      // .catch(() => []). This query casts explicitly instead of copying
      // that pattern.
      sql`
        SELECT cp.id, cp.organisation_id, cp.type, cp.title, cp.description,
               cp.status, cp.priority, cp.created_at, o.name AS org_name
        FROM client_pipeline cp
        LEFT JOIN organisations o ON o.id = cp.organisation_id::text
        WHERE cp.status = ANY(${REQUEST_ACTIONABLE_STATUSES}::text[])
        ORDER BY
          CASE cp.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
          cp.created_at ASC
        LIMIT 30
      `,
      // 3. Web Systems leads in actionable early stages.
      sql`
        SELECT id, full_name, business_name, status::text AS status,
               priority, score, created_at, updated_at
        FROM web_service_leads
        WHERE status::text = ANY(${LEAD_ACTIONABLE_STAGES}::text[])
        ORDER BY
          CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 1 END,
          score DESC NULLS LAST,
          updated_at ASC
        LIMIT 30
      `,
      // 4/5. client_onboarding — not-yet-live records with a target launch
      // date either overdue (any distance in the past) or within the next
      // UPCOMING_WINDOW_DAYS days. Bifurcated into upcoming/overdue in JS
      // below rather than two separate queries.
      sql`
        SELECT co.id, co.organisation_id, co.client_name, co.onboarding_stage,
               co.target_launch_date, o.name AS org_name,
               l.full_name AS lead_name, l.business_name AS lead_business_name
        FROM client_onboarding co
        LEFT JOIN organisations o ON o.id = co.organisation_id
        LEFT JOIN web_service_leads l ON l.id = co.lead_id
        WHERE co.onboarding_stage <> 'live'
          AND co.target_launch_date IS NOT NULL
          AND co.target_launch_date <= CURRENT_DATE + ${UPCOMING_WINDOW_DAYS}::int
        ORDER BY co.target_launch_date ASC
        LIMIT 40
      `,
      // 6. Web Systems lead counts by stage (for the snapshot).
      sql`
        SELECT status::text AS status, COUNT(*)::int AS count
        FROM web_service_leads
        GROUP BY status
      `,
      // 7. Everything else for the snapshot in one round trip.
      sql`
        SELECT
          (SELECT COUNT(*)::int FROM public.alerts WHERE status = 'OPEN') AS open_alerts,
          (SELECT COUNT(*)::int FROM client_pipeline WHERE status = ANY(${REQUEST_ACTIONABLE_STATUSES}::text[])) AS open_requests,
          (SELECT COUNT(*)::int FROM client_onboarding WHERE onboarding_stage <> 'live') AS onboarding_in_progress,
          (SELECT COUNT(*)::int FROM managed_services WHERE status = 'active') AS active_managed_services,
          (SELECT COALESCE(SUM(monthly_value), 0)::float FROM managed_services WHERE status = 'active') AS active_mrr
      `,
    ]);

    // UTC-anchored, to match toDateOnlyString/targetDate's UTC parsing below —
    // using local-midnight here would skew the day count by ±1 depending on
    // the server's timezone offset relative to UTC.
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const items: AttentionItem[] = [];

    for (const a of alertRows) {
      const orgId = a.org_name ? (a.organisation_id as string) : null;
      items.push({
        id: `alert:${a.id}`,
        type: 'alert',
        severity: alertSeverity(a.severity),
        title: a.title as string,
        description: (a.description as string) ?? '',
        organisationId: orgId,
        organisationName: (a.org_name as string) ?? null,
        createdAt: a.created_at ? new Date(a.created_at as string).toISOString() : null,
        href: orgId ? `/clients/${orgId}` : '/admin/founder',
        metadata: { module: a.module ?? null, ruleKey: a.rule_key ?? null },
      });
    }

    for (const r of requestRows) {
      const orgId = r.org_name ? String(r.organisation_id) : null;
      items.push({
        id: `client_request:${r.id}`,
        type: 'client_request',
        severity: priorityToSeverity(r.priority),
        title: r.title as string,
        description: `${r.type ?? 'request'} — ${((r.description as string) ?? '').slice(0, 140)}`,
        organisationId: orgId,
        organisationName: (r.org_name as string) ?? null,
        createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : null,
        href: '/admin/pipeline',
        metadata: { requestType: r.type ?? null, status: r.status ?? null },
      });
    }

    for (const l of leadRows) {
      const label = (l.business_name as string) || (l.full_name as string) || 'Unnamed lead';
      items.push({
        id: `web_lead:${l.id}`,
        type: 'web_lead',
        severity: priorityToSeverity(l.priority),
        title: label,
        description: `Status: ${l.status} · Priority: ${l.priority ?? 'medium'} · Score: ${l.score ?? 0}`,
        organisationId: null,
        organisationName: null,
        createdAt: l.updated_at ? new Date(l.updated_at as string).toISOString() : null,
        href: '/admin/web-services',
        metadata: {
          status: l.status ?? null,
          score: l.score ?? 0,
          createdAt: l.created_at ? new Date(l.created_at as string).toISOString() : null,
        },
      });
    }

    for (const o of onboardingRows) {
      const label = (o.client_name as string) || (o.lead_business_name as string) || (o.lead_name as string) || 'Unnamed client';
      const orgId = o.org_name ? String(o.organisation_id) : null;
      const targetDateStr = toDateOnlyString(o.target_launch_date);
      if (!targetDateStr) continue; // defensive — query already filters NOT NULL
      const targetDate = new Date(`${targetDateStr}T00:00:00Z`);
      const days = daysBetween(targetDate, today);

      if (days < 0) {
        const daysOverdue = Math.abs(days);
        items.push({
          id: `overdue_deployment:${o.id}`,
          type: 'overdue_deployment',
          severity: daysOverdue >= 14 ? 'critical' : daysOverdue >= 3 ? 'high' : 'medium',
          title: `Overdue ${daysOverdue}d — ${label}`,
          description: `Target launch was ${targetDateStr}. Stage: ${o.onboarding_stage}.`,
          organisationId: orgId,
          organisationName: (o.org_name as string) ?? label,
          createdAt: null,
          href: '/admin/deployments',
          metadata: { daysOverdue, stage: o.onboarding_stage, targetLaunchDate: targetDateStr },
        });
      } else {
        items.push({
          id: `upcoming_launch:${o.id}`,
          type: 'upcoming_launch',
          severity: days <= 3 ? 'high' : days <= 7 ? 'medium' : 'low',
          title: `Launch in ${days}d — ${label}`,
          description: `Target launch ${targetDateStr}. Stage: ${o.onboarding_stage}.`,
          organisationId: orgId,
          organisationName: (o.org_name as string) ?? label,
          createdAt: null,
          href: '/admin/deployments',
          metadata: { daysUntil: days, stage: o.onboarding_stage, targetLaunchDate: targetDateStr },
        });
      }
    }

    items.sort((x, y) => {
      const rankDiff = SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity];
      if (rankDiff !== 0) return rankDiff;
      const xt = x.createdAt ? new Date(x.createdAt).getTime() : 0;
      const yt = y.createdAt ? new Date(y.createdAt).getTime() : 0;
      return yt - xt;
    });

    const leadsByStage: Record<string, number> = {};
    for (const row of leadStageRows) {
      leadsByStage[row.status as string] = row.count as number;
    }

    const snapshot = snapshotRows[0] ?? {};

    return NextResponse.json({
      items,
      metrics: {
        leadsByStage,
        openAlerts: (snapshot.open_alerts as number) ?? 0,
        openRequests: (snapshot.open_requests as number) ?? 0,
        onboardingInProgress: (snapshot.onboarding_in_progress as number) ?? 0,
        activeManagedServices: (snapshot.active_managed_services as number) ?? 0,
        activeMrr: (snapshot.active_mrr as number) ?? 0,
      },
    });
  } catch (err) {
    console.error('[GET /api/founder/attention-queue]', err);
    return NextResponse.json(
      { error: 'Internal server error', items: [], metrics: {} },
      { status: 500 },
    );
  }
}
