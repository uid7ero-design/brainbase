export const TENNIS_BUSINESS_MODULES = ['scheduling', 'crm', 'invoicing', 'purchasing', 'budgeting'] as const;
export type BusinessModule = typeof TENNIS_BUSINESS_MODULES[number];
export type Section<T> = { state: 'ready'; value: T } | { state: 'unavailable' } | { state: 'not_enabled' };
export type MoneyRow = { currency: string; invoiced_cents: string; received_cents: string; outstanding_cents: string };
export type CostRow = { currency: string; billed_cents: string; paid_cents: string };
export type BusinessOverview = {
  month: string; timezone: 'Australia/Adelaide'; modules: BusinessModule[];
  coaching: Section<{ today: string; sessions: number; players: number }>;
  crm: Section<{ contacts: number; openDeals: number }>;
  income: Section<MoneyRow[]>; costs: Section<CostRow[]>;
};
export function businessPeriod(month: string) {
  if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a month between 2000 and 2099.');
  const [year, number] = month.split('-').map(Number);
  return { from: month + '-01', to: `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}-01` };
}
export function currentBusinessMonth(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Adelaide', year: 'numeric', month: '2-digit' }).format(now);
}
export function exactCents(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Invalid monetary readback');
  return BigInt(value).toString();
}
