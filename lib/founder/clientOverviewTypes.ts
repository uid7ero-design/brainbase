// Response types for GET /api/admin/founder-clients. Kept free of
// server-only imports so the client-side Founder OS page can import them.
//
// Money: every amount is an exact, validated, non-negative decimal STRING
// (never a JS number), so values above Number.MAX_SAFE_INTEGER survive the
// SQL → JSON → UI round trip. `*Cents` fields are integer minor units.

export type SourceStatus = 'ok' | 'unavailable';

export type SourceKey =
  | 'organisations'
  | 'capabilities'
  | 'implementations'
  | 'managedServices'
  | 'onboarding'
  | 'requests'
  | 'hlnaCrm'
  | 'webLeads'
  | 'hlnaCommercial';

/** Non-negative integer minor units as a decimal string, e.g. "123456". */
export type CentsString = string;
/** Non-negative exact decimal as a string, e.g. "1250.5". */
export type DecimalString = string;

export type OverviewImplementation = {
  id: string;
  name: string;
  stage: string;
  health: string | null;
  nextAction: string | null;
  targetLaunchDate: string | null;
};

export type ContractedServices = {
  activeCount: number;
  /** Sum of readable active monthly values. No currency is recorded on managed_services. */
  contractedMonthlyCents: CentsString;
  /** Active services whose monthly value was missing or unreadable — excluded from the sum, never counted as zero. */
  unreadableValueCount: number;
};

export type RegisteredOrganisation = {
  id: string;
  name: string;
  slug: string | null;
  status: string | null;
  plan: string | null;
  createdAt: string | null;
  userCount: number;
  capabilities: { key: string; name: string }[] | null;
  implementations: { activeCount: number; primary: OverviewImplementation | null } | null;
  managedServices: ContractedServices | null;
  onboarding: { id: string; stage: string; targetLaunchDate: string | null } | null | undefined;
  openRequests: number | null;
  links: {
    workspace: string;
    implementation: string | null;
    services: string | null;
    requests: string | null;
  };
};

export type Prospect = {
  id: string;
  name: string;
  openDeals: number;
  /** Pipeline estimate (crm_deals.value, no currency recorded); null = unreadable. */
  openDealValue: DecimalString | null;
  /** Open deals with no value recorded — excluded from openDealValue, never counted as zero. */
  openDealsWithoutValue: number;
  /** Open deals whose recorded value is invalid (negative, NaN, ±Infinity) — excluded before summing, never allowed to offset valid values. */
  invalidOpenDealValues: number;
  wonDeals: number;
  latestOpenStage: string | null;
  commercialCustomerId: string | null;
  href: string;
};

/** Whole-portfolio CRM figures, aggregated in SQL over every HQ company — never derived from one page. */
export type CrmSummary = {
  totalCompanies: number;
  companiesWithOpenDeals: number;
  openDeals: number;
  /** null = the aggregate could not be read exactly. */
  openDealValue: DecimalString | null;
  openDealsWithoutValue: number;
  invalidOpenDealValues: number;
  wonDeals: number;
};

export type CrmPage = {
  page: number;
  pageSize: number;
  /** 1-based position of the first row shown (0 when the page is empty). */
  from: number;
  to: number;
  totalCompanies: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** true only when every HQ company is on this page. */
  complete: boolean;
};

export type MoneyByCurrency = {
  currency: string;
  /** ISSUED invoice totals. */
  invoicedCents: CentsString;
  /** RECORDED payment amounts allocated to those ISSUED invoices (reversed payments excluded). */
  allocatedReceivedCents: CentsString;
  /** Sum over invoices of max(0, total − allocated). */
  outstandingCents: CentsString;
  partPaidInvoiceCount: number;
};

export type BillingCustomer = {
  id: string;
  name: string;
  active: boolean;
  crmCompanyId: string | null;
  issuedInvoiceCount: number;
  lastIssueDate: string | null;
  amounts: MoneyByCurrency[];
  /** Ledger rows for this customer whose amounts or currency could not be read exactly. */
  unreadableAmountRows: number;
  relationship: 'paying' | 'invoiced' | 'no_issued_invoices' | 'unreadable';
  href: string;
};

export type NotConnectedSource = { key: string; label: string; note: string };

/**
 * Which organisation the caller is currently working in, relative to the
 * HLNA Labs (Brainbase HQ) organisation whose CRM/Commercial records are
 * shown. Derived server-side from the authoritative session only.
 *
 * - none: already working in HLNA Labs — CRM/Commercial links open directly.
 * - stop_viewing_as: HLNA Labs is the caller's home organisation; clear the
 *   impersonation override (DELETE /api/admin/impersonate) first.
 * - view_as_hlna: switch to HLNA Labs via the existing, audited
 *   POST /api/admin/impersonate (which re-validates super_admin and the
 *   organisation server-side) first.
 * - unavailable: no HLNA Labs organisation is known; links are disabled.
 */
export type HlnaWorkspace = {
  active: boolean;
  switchTo: 'none' | 'stop_viewing_as' | 'view_as_hlna' | 'unavailable';
};

export type FounderClientOverview = {
  generatedAt: string;
  hlnaOrganisation: { id: string; name: string } | null;
  hlnaWorkspace: HlnaWorkspace;
  sources: Record<SourceKey, SourceStatus>;
  registeredOrganisations: RegisteredOrganisation[] | null;
  unlinkedManagedServices: ContractedServices | null;
  prospects: {
    crmCompanies: Prospect[] | null;
    crmSummary: CrmSummary | null;
    crmPage: CrmPage | null;
    webLeadsByStatus: Record<string, number> | null;
  };
  billing: {
    customers: BillingCustomer[] | null;
    /** Per-currency totals of readable rows only; never summed across currencies. */
    totals: MoneyByCurrency[] | null;
    /** Ledger rows excluded from totals because an amount or currency was unreadable. */
    unreadableAmountRows: number | null;
  };
  notConnected: NotConnectedSource[];
};
