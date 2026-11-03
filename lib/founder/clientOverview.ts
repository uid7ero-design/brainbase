import 'server-only';
import sql from '@/lib/db';
import { BRAINBASE_SLUG } from '@/lib/dashboard/clientDashboard';
import { isValidCurrencyCode } from '@/lib/commercial/money';
import {
  addCents,
  isPositiveCents,
  parseCentsString,
  parseDecimalString,
  parseDollarsToCents,
} from './exactMoney';

// ── Founder OS — authoritative client overview ─────────────────────────────
//
// Replaces the old founder-clients proxy to an external, unverified backend
// (NEXT_PUBLIC_API_URL) that silently fell back to an empty list. Every value
// here is read from records BrainBase already owns; nothing is written, no
// table is added.
//
// Three DIFFERENT kinds of relationship are kept apart on purpose — they are
// never merged, matched by name, or assumed to describe the same party:
//
//   1. Registered organisations — BrainBase tenants (`organisations`), with
//      their enabled capabilities, implementations, managed services, Web
//      Systems onboarding and open requests, all keyed by organisation_id.
//   2. Prospects — HLNA Labs' own CRM (crm_companies / crm_deals owned by
//      the Brainbase HQ organisation) plus Web Systems enquiry counts.
//   3. Billing customers — HLNA Labs' own Commercial ledger
//      (commercial_customers / commercial_invoices / commercial_payments
//      owned by the Brainbase HQ organisation).
//
// No column links a registered organisation to an HQ CRM company or an HQ
// Commercial customer, so this module never claims one does.
//
// Money is kept in three separate, labelled buckets:
//   - contracted: managed_services.monthly_value (a recorded service value,
//     not an invoice, not a receipt);
//   - pipeline estimate: open CRM deal values;
//   - invoiced / allocated received / outstanding: ISSUED commercial
//     invoices and RECORDED payment allocations, in integer cents, per
//     currency.
// Every amount is aggregated in SQL as NUMERIC and returned as text (no
// BIGINT cast that could overflow, no float), validated, and carried as an
// exact decimal string; arithmetic is BigInt (see ./exactMoney). Unreadable
// values are counted and reported, never turned into zero.
//
// Each source is queried independently. A failed query marks that source
// 'unavailable' (and its data null) instead of collapsing to an empty list,
// so the UI can tell "could not load" from "genuinely none".

import type {
  BillingCustomer,
  ContractedServices,
  CrmPage,
  CrmSummary,
  FounderClientOverview,
  HlnaWorkspace,
  MoneyByCurrency,
  NotConnectedSource,
  OverviewImplementation,
  Prospect,
  RegisteredOrganisation,
  SourceKey,
  SourceStatus,
} from './clientOverviewTypes';

export type * from './clientOverviewTypes';

// Other HLNA products that are NOT read by this overview. Listed so the UI
// can say so explicitly rather than implying the picture is complete.
export const NOT_CONNECTED_SOURCES: NotConnectedSource[] = [
  { key: 'eve', label: 'Eve ticketing', note: 'Event orders and organiser payouts belong to each organiser; not read here.' },
  { key: 'booking_activity', label: 'Bookings (Scheduling)', note: 'Booking activity per organisation is not summarised here yet.' },
  { key: 'essio', label: 'Essio', note: 'Separate application and repository; no shared records.' },
  { key: 'learnli', label: 'Learnli', note: 'Separate product and finance records; not read here.' },
  { key: 'platform_billing', label: 'Platform subscription billing', note: 'No automated BrainBase subscription billing exists; organisation plan is a label, not proof of payment.' },
  { key: 'org_billing_link', label: 'Organisation ↔ CRM / Commercial link', note: 'No record links a registered organisation to an HLNA CRM company or Commercial customer.' },
];

const CLOSED_DEAL_STAGES = ['closed_won', 'closed_lost'];

// crm_deals.value is NUMERIC with no CHECK, so individual values are
// validated IN SQL before they are summed: only finite, non-negative values
// are added (`value >= 0 AND value < 'Infinity'` — in PostgreSQL NaN sorts
// above every number, so this excludes NaN, Infinity and -Infinity as well
// as negatives). A negative value can therefore never offset a valid one.
// Missing (NULL) and invalid values are counted separately and reported.

/** CRM companies per page. Bounded; the UI pages through the rest. */
export const CRM_PAGE_SIZE = 200;
/** Highest accepted page index (0-based) — keeps OFFSET bounded. */
export const CRM_MAX_PAGE = 10_000;

type Row = Record<string, unknown>;

async function attempt<T>(label: string, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    console.warn(`[founder-clients] ${label} unavailable:`, (err as Error).message);
    return { ok: false };
  }
}

function str(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

function dateOnly(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Counts (never money). SQL returns ::int; anything else counts as 0 rows. */
function count(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/**
 * Resolves where CRM/Commercial links can safely open, from the
 * authoritative session only (never request input).
 */
export function resolveHlnaWorkspace(
  hqId: string | null,
  session: { homeOrganisationId: string; activeOrganisationId: string },
): HlnaWorkspace {
  if (!hqId) return { active: false, switchTo: 'unavailable' };
  if (session.activeOrganisationId === hqId) return { active: true, switchTo: 'none' };
  if (session.homeOrganisationId === hqId) return { active: false, switchTo: 'stop_viewing_as' };
  return { active: false, switchTo: 'view_as_hlna' };
}

export type OverviewRows = {
  organisations: Row[] | null;
  capabilities: Row[] | null;
  implementations: Row[] | null;
  managedServices: Row[] | null;
  onboarding: Row[] | null;
  requests: Row[] | null;
  /** summary: one whole-portfolio aggregate row; companies: one bounded page. */
  hlnaCrm: { summary: Row; companies: Row[] } | null;
  webLeads: Row[] | null;
  hlnaCommercial: Row[] | null;
};

function emptyContracted(): ContractedServices {
  return { activeCount: 0, contractedMonthlyCents: '0', unreadableValueCount: 0 };
}

/**
 * Pure assembly of already-fetched rows. `null` for a source means that
 * source could not be read. Exported for unit testing.
 */
export function buildFounderClientOverview(
  rows: OverviewRows,
  opts: {
    excludeOrganisationIds: string[];
    hlnaOrganisation: { id: string; name: string } | null;
    hlnaWorkspace: HlnaWorkspace;
    crmPage?: number;
    now?: Date;
  },
): FounderClientOverview {
  const sources = Object.fromEntries(
    (Object.keys(rows) as SourceKey[]).map(k => [k, rows[k] === null ? 'unavailable' : 'ok']),
  ) as Record<SourceKey, SourceStatus>;

  const exclude = new Set(opts.excludeOrganisationIds.filter(Boolean));

  // Capabilities per organisation.
  const capsByOrg = new Map<string, { key: string; name: string }[]>();
  for (const r of rows.capabilities ?? []) {
    const id = String(r.organisation_id);
    const list = capsByOrg.get(id) ?? [];
    list.push({ key: String(r.key), name: String(r.name ?? r.key) });
    capsByOrg.set(id, list);
  }

  // Implementations: rows arrive ordered by updated_at DESC. Primary = most
  // recently updated non-cancelled implementation (same rule /clients uses
  // for non-cancelled ones).
  const implByOrg = new Map<string, { activeCount: number; primary: OverviewImplementation | null }>();
  for (const r of rows.implementations ?? []) {
    const id = String(r.organisation_id);
    const entry = implByOrg.get(id) ?? { activeCount: 0, primary: null };
    if (r.stage !== 'cancelled') {
      entry.activeCount += 1;
      if (!entry.primary) {
        entry.primary = {
          id: String(r.id),
          name: String(r.name ?? 'Implementation'),
          stage: String(r.stage),
          health: str(r.health),
          nextAction: str(r.next_action),
          targetLaunchDate: dateOnly(r.target_launch_date),
        };
      }
    }
    implByOrg.set(id, entry);
  }

  // Managed services: active only count toward contracted value. An
  // unreadable monthly_value is counted, never treated as zero.
  const servicesByOrg = new Map<string, ContractedServices>();
  const unlinked = emptyContracted();
  for (const r of rows.managedServices ?? []) {
    if (r.status !== 'active') continue;
    const entry = r.organisation_id == null
      ? unlinked
      : (servicesByOrg.get(String(r.organisation_id)) ?? emptyContracted());
    entry.activeCount += 1;
    const cents = parseDollarsToCents(r.monthly_value);
    if (cents === null) entry.unreadableValueCount += 1;
    else entry.contractedMonthlyCents = addCents(entry.contractedMonthlyCents, cents);
    if (r.organisation_id != null) servicesByOrg.set(String(r.organisation_id), entry);
  }

  // Onboarding: rows ordered by updated_at DESC; first per org wins.
  const onboardingByOrg = new Map<string, { id: string; stage: string; targetLaunchDate: string | null }>();
  for (const r of rows.onboarding ?? []) {
    if (r.organisation_id == null) continue;
    const id = String(r.organisation_id);
    if (onboardingByOrg.has(id)) continue;
    onboardingByOrg.set(id, { id: String(r.id), stage: String(r.onboarding_stage), targetLaunchDate: dateOnly(r.target_launch_date) });
  }

  const requestsByOrg = new Map<string, number>();
  for (const r of rows.requests ?? []) {
    if (r.organisation_id == null) continue;
    requestsByOrg.set(String(r.organisation_id), count(r.count));
  }

  const registeredOrganisations: RegisteredOrganisation[] | null = rows.organisations === null
    ? null
    : rows.organisations
        .filter(o => !exclude.has(String(o.id)))
        .map(o => {
          const id = String(o.id);
          const impl = rows.implementations === null ? null : (implByOrg.get(id) ?? { activeCount: 0, primary: null });
          const services = rows.managedServices === null ? null : (servicesByOrg.get(id) ?? emptyContracted());
          const openRequests = rows.requests === null ? null : (requestsByOrg.get(id) ?? 0);
          return {
            id,
            name: String(o.name ?? id),
            slug: str(o.slug),
            status: str(o.status),
            plan: str(o.plan),
            createdAt: iso(o.created_at),
            userCount: count(o.user_count),
            capabilities: rows.capabilities === null ? null : (capsByOrg.get(id) ?? []),
            implementations: impl,
            managedServices: services,
            // undefined = source unavailable; null = no onboarding record.
            onboarding: rows.onboarding === null ? undefined : (onboardingByOrg.get(id) ?? null),
            openRequests,
            links: {
              workspace: `/clients/${encodeURIComponent(id)}`,
              implementation: impl?.primary ? `/admin/implementations/${encodeURIComponent(impl.primary.id)}` : null,
              services: services && services.activeCount > 0 ? '/admin/deployments' : null,
              requests: openRequests && openRequests > 0 ? '/admin/pipeline' : null,
            },
          };
        });

  // HQ Commercial ledger: one row per (customer, currency) — or one row with
  // a null currency for a customer without issued invoices. A row whose
  // currency or any amount cannot be read exactly is excluded from totals
  // and counted, so the UI can say the totals are incomplete.
  const customers = new Map<string, BillingCustomer>();
  const totals = new Map<string, MoneyByCurrency>();
  let unreadableAmountRows = 0;
  for (const r of rows.hlnaCommercial ?? []) {
    const id = String(r.id);
    const c = customers.get(id) ?? {
      id,
      name: String(r.name ?? 'Customer'),
      active: r.active !== false,
      crmCompanyId: str(r.crm_company_id),
      issuedInvoiceCount: 0,
      lastIssueDate: null,
      amounts: [],
      unreadableAmountRows: 0,
      relationship: 'no_issued_invoices' as const,
      href: `/commercial/customers/${encodeURIComponent(id)}`,
    };
    customers.set(id, c);
    if (r.currency == null && r.issued_count == null) continue; // no issued invoices
    c.issuedInvoiceCount += count(r.issued_count);
    const last = dateOnly(r.last_issue_date);
    if (last && (!c.lastIssueDate || last > c.lastIssueDate)) c.lastIssueDate = last;

    const currency = typeof r.currency === 'string' && isValidCurrencyCode(r.currency) ? r.currency : null;
    const invoicedCents = parseCentsString(r.invoiced_cents);
    const allocatedReceivedCents = parseCentsString(r.received_cents);
    const outstandingCents = parseCentsString(r.outstanding_cents);
    if (currency === null || invoicedCents === null || allocatedReceivedCents === null || outstandingCents === null) {
      c.unreadableAmountRows += 1;
      unreadableAmountRows += 1;
      continue;
    }
    const money: MoneyByCurrency = {
      currency, invoicedCents, allocatedReceivedCents, outstandingCents,
      partPaidInvoiceCount: count(r.part_paid_count),
    };
    c.amounts.push(money);
    const t = totals.get(currency) ?? { currency, invoicedCents: '0', allocatedReceivedCents: '0', outstandingCents: '0', partPaidInvoiceCount: 0 };
    t.invoicedCents = addCents(t.invoicedCents, invoicedCents);
    t.allocatedReceivedCents = addCents(t.allocatedReceivedCents, allocatedReceivedCents);
    t.outstandingCents = addCents(t.outstandingCents, outstandingCents);
    t.partPaidInvoiceCount += money.partPaidInvoiceCount;
    totals.set(currency, t);
  }
  for (const c of customers.values()) {
    c.relationship = c.amounts.some(a => isPositiveCents(a.allocatedReceivedCents)) ? 'paying'
      : c.unreadableAmountRows > 0 ? 'unreadable'
      : c.issuedInvoiceCount > 0 ? 'invoiced'
      : 'no_issued_invoices';
  }

  const customerByCrmCompany = new Map<string, string>();
  for (const c of customers.values()) if (c.crmCompanyId) customerByCrmCompany.set(c.crmCompanyId, c.id);

  // HQ CRM: whole-portfolio figures come from the SQL aggregate; the list is
  // one bounded page with explicit coverage metadata.
  let crmCompanies: Prospect[] | null = null;
  let crmSummary: CrmSummary | null = null;
  let crmPage: CrmPage | null = null;
  if (rows.hlnaCrm !== null) {
    const s = rows.hlnaCrm.summary;
    crmSummary = {
      totalCompanies: count(s.total_companies),
      companiesWithOpenDeals: count(s.companies_with_open_deals),
      openDeals: count(s.open_deals),
      openDealValue: parseDecimalString(s.open_deal_value),
      openDealsWithoutValue: count(s.open_deals_without_value),
      invalidOpenDealValues: count(s.invalid_open_deal_values),
      wonDeals: count(s.won_deals),
    };
    crmCompanies = rows.hlnaCrm.companies.map(r => {
      const id = String(r.id);
      return {
        id,
        name: String(r.name ?? 'Company'),
        openDeals: count(r.open_deals),
        openDealValue: parseDecimalString(r.open_deal_value),
        openDealsWithoutValue: count(r.open_deals_without_value),
        invalidOpenDealValues: count(r.invalid_open_deal_values),
        wonDeals: count(r.won_deals),
        latestOpenStage: str(r.latest_open_stage),
        // Only meaningful when the Commercial source loaded.
        commercialCustomerId: rows.hlnaCommercial === null ? null : (customerByCrmCompany.get(id) ?? null),
        href: `/crm/companies/${encodeURIComponent(id)}`,
      };
    });
    const page = opts.crmPage ?? 0;
    const offset = page * CRM_PAGE_SIZE;
    const total = crmSummary.totalCompanies;
    crmPage = {
      page,
      pageSize: CRM_PAGE_SIZE,
      from: crmCompanies.length > 0 ? offset + 1 : 0,
      to: offset + crmCompanies.length,
      totalCompanies: total,
      hasPrevious: page > 0,
      hasNext: offset + crmCompanies.length < total,
      complete: page === 0 && crmCompanies.length >= total,
    };
  }

  let webLeadsByStatus: Record<string, number> | null = null;
  if (rows.webLeads !== null) {
    webLeadsByStatus = {};
    for (const r of rows.webLeads) webLeadsByStatus[String(r.status)] = count(r.count);
  }

  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    hlnaOrganisation: opts.hlnaOrganisation,
    hlnaWorkspace: opts.hlnaWorkspace,
    sources,
    registeredOrganisations,
    unlinkedManagedServices: rows.managedServices === null ? null : unlinked,
    prospects: { crmCompanies, crmSummary, crmPage, webLeadsByStatus },
    billing: {
      customers: rows.hlnaCommercial === null ? null : [...customers.values()],
      totals: rows.hlnaCommercial === null ? null : [...totals.values()],
      unreadableAmountRows: rows.hlnaCommercial === null ? null : unreadableAmountRows,
    },
    notConnected: NOT_CONNECTED_SOURCES,
  };
}

/**
 * Reads every source. Caller MUST already have verified super_admin — this
 * function is cross-organisation by design for registered organisations, and
 * scoped to the Brainbase HQ organisation (resolved server-side by slug,
 * never from request input) for CRM and Commercial. `crmPage` only selects
 * which bounded page of HQ CRM companies to list; it never widens scope.
 */
export async function loadFounderClientOverview(opts: {
  homeOrganisationId: string;
  activeOrganisationId: string;
  crmPage?: number;
}): Promise<FounderClientOverview> {
  const crmPage = Number.isSafeInteger(opts.crmPage) && (opts.crmPage as number) >= 0 && (opts.crmPage as number) <= CRM_MAX_PAGE
    ? (opts.crmPage as number)
    : 0;

  const organisations = await attempt('organisations', () => sql`
    SELECT o.id, o.name, o.slug, o.status, o.plan, o.created_at,
           (SELECT COUNT(*)::int FROM users u WHERE u.organisation_id = o.id) AS user_count
    FROM organisations o
    ORDER BY o.name ASC, o.id ASC
  ` as Promise<Row[]>);

  const hqRow = organisations.ok ? organisations.value.find(o => o.slug === BRAINBASE_SLUG) : undefined;
  const hlnaOrganisation = hqRow ? { id: String(hqRow.id), name: String(hqRow.name) } : null;
  const hqId = hlnaOrganisation?.id ?? null;

  const [capabilities, implementations, managedServices, onboarding, requests, webLeads, hlnaCrm, hlnaCommercial] = await Promise.all([
    attempt('capabilities', () => sql`
      SELECT om.organisation_id, m.key, m.name
      FROM organisation_modules om
      JOIN modules m ON m.key = om.module_key
      WHERE om.enabled = true AND m.active = true
      ORDER BY m.name ASC
    ` as Promise<Row[]>),
    attempt('implementations', () => sql`
      SELECT id, organisation_id, name, stage, health, next_action, target_launch_date
      FROM implementations
      ORDER BY updated_at DESC, id ASC
    ` as Promise<Row[]>),
    // monthly_value is NUMERIC(10,2): read as text so it is parsed exactly.
    attempt('managed_services', () => sql`
      SELECT organisation_id, status, monthly_value::text AS monthly_value
      FROM managed_services
    ` as Promise<Row[]>),
    attempt('client_onboarding', () => sql`
      SELECT id, organisation_id, onboarding_stage, target_launch_date
      FROM client_onboarding
      WHERE organisation_id IS NOT NULL
      ORDER BY updated_at DESC, id ASC
    ` as Promise<Row[]>),
    // client_pipeline.organisation_id is UUID while organisations.id is TEXT
    // — cast, same as app/api/founder/attention-queue.
    attempt('client_pipeline', () => sql`
      SELECT organisation_id::text AS organisation_id, COUNT(*)::int AS count
      FROM client_pipeline
      WHERE status = ANY(${['new', 'in_progress']}::text[])
      GROUP BY organisation_id
    ` as Promise<Row[]>),
    attempt('web_service_leads', () => sql`
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM web_service_leads
      GROUP BY status
    ` as Promise<Row[]>),
    hqId === null
      ? Promise.resolve({ ok: false as const })
      : attempt('hq crm', async () => {
          // Whole-portfolio aggregate (every HQ company/deal) — the figures
          // the UI presents as totals never come from the bounded page.
          const [summaryRows, companies] = await Promise.all([
            sql`
              SELECT
                (SELECT COUNT(*)::int FROM crm_companies c WHERE c.organisation_id = ${hqId}) AS total_companies,
                COUNT(DISTINCT d.company_id) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]))::int AS companies_with_open_deals,
                COUNT(d.id) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]))::int AS open_deals,
                COALESCE(SUM(d.value) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]) AND d.value >= 0 AND d.value < 'Infinity'::numeric), 0)::text AS open_deal_value,
                COUNT(d.id) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]) AND d.value IS NULL)::int AS open_deals_without_value,
                COUNT(d.id) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]) AND d.value IS NOT NULL AND NOT (d.value >= 0 AND d.value < 'Infinity'::numeric))::int AS invalid_open_deal_values,
                COUNT(d.id) FILTER (WHERE d.stage = 'closed_won')::int AS won_deals
              FROM crm_deals d
              JOIN crm_companies c ON c.id = d.company_id AND c.organisation_id = d.organisation_id
              WHERE d.organisation_id = ${hqId}
            ` as Promise<Row[]>,
            sql`
              SELECT c.id, c.name,
                     COUNT(d.id) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]))::int AS open_deals,
                     COALESCE(SUM(d.value) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]) AND d.value >= 0 AND d.value < 'Infinity'::numeric), 0)::text AS open_deal_value,
                     COUNT(d.id) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]) AND d.value IS NULL)::int AS open_deals_without_value,
                     COUNT(d.id) FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[]) AND d.value IS NOT NULL AND NOT (d.value >= 0 AND d.value < 'Infinity'::numeric))::int AS invalid_open_deal_values,
                     COUNT(d.id) FILTER (WHERE d.stage = 'closed_won')::int AS won_deals,
                     (ARRAY_AGG(d.stage ORDER BY d.updated_at DESC)
                        FILTER (WHERE d.stage <> ALL(${CLOSED_DEAL_STAGES}::text[])))[1] AS latest_open_stage
              FROM crm_companies c
              LEFT JOIN crm_deals d ON d.company_id = c.id AND d.organisation_id = c.organisation_id
              WHERE c.organisation_id = ${hqId}
              GROUP BY c.id, c.name
              ORDER BY c.name ASC, c.id ASC
              LIMIT ${CRM_PAGE_SIZE} OFFSET ${crmPage * CRM_PAGE_SIZE}
            ` as Promise<Row[]>,
          ]);
          if (summaryRows.length !== 1) throw new Error('crm summary returned no row');
          return { summary: summaryRows[0], companies };
        }),
    hqId === null
      ? Promise.resolve({ ok: false as const })
      : attempt('hq commercial', () => sql`
          WITH alloc AS (
            SELECT a.invoice_id, SUM(a.allocated_amount_cents::numeric) AS allocated
            FROM commercial_payment_allocations a
            JOIN commercial_payments p ON p.id = a.payment_id AND p.organisation_id = a.organisation_id
            WHERE a.organisation_id = ${hqId} AND p.status = 'RECORDED'
            GROUP BY a.invoice_id
          ),
          inv AS (
            SELECT i.customer_id, i.currency,
                   COUNT(*)::int AS issued_count,
                   SUM(i.total_cents::numeric)::text AS invoiced_cents,
                   COALESCE(SUM(alloc.allocated), 0)::text AS received_cents,
                   SUM(GREATEST(i.total_cents::numeric - COALESCE(alloc.allocated, 0), 0))::text AS outstanding_cents,
                   COUNT(*) FILTER (WHERE alloc.allocated > 0 AND alloc.allocated < i.total_cents)::int AS part_paid_count,
                   MAX(i.issue_date) AS last_issue_date
            FROM commercial_invoices i
            LEFT JOIN alloc ON alloc.invoice_id = i.id
            WHERE i.organisation_id = ${hqId} AND i.status = 'ISSUED'
            GROUP BY i.customer_id, i.currency
          )
          SELECT cc.id, cc.name, cc.active, cc.crm_company_id,
                 inv.currency, inv.issued_count, inv.invoiced_cents, inv.received_cents,
                 inv.outstanding_cents, inv.part_paid_count, inv.last_issue_date
          FROM commercial_customers cc
          LEFT JOIN inv ON inv.customer_id = cc.id
          WHERE cc.organisation_id = ${hqId}
          ORDER BY cc.name ASC, cc.id ASC, inv.currency ASC
        ` as Promise<Row[]>),
  ]);

  const val = <T,>(r: { ok: true; value: T } | { ok: false }) => (r.ok ? r.value : null);

  return buildFounderClientOverview(
    {
      organisations: val(organisations),
      capabilities: val(capabilities),
      implementations: val(implementations),
      managedServices: val(managedServices),
      onboarding: val(onboarding),
      requests: val(requests),
      hlnaCrm: val(hlnaCrm),
      webLeads: val(webLeads),
      hlnaCommercial: val(hlnaCommercial),
    },
    {
      excludeOrganisationIds: [opts.homeOrganisationId, hqId ?? ''],
      hlnaOrganisation,
      hlnaWorkspace: resolveHlnaWorkspace(hqId, opts),
      crmPage,
    },
  );
}
