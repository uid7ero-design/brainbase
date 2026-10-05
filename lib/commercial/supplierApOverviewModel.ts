export const AP_AGING_BUCKETS = ['CURRENT', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_91_PLUS', 'NO_DUE_DATE'] as const;
export type ApAgingBucket = typeof AP_AGING_BUCKETS[number];
export type ApAmounts = {
  payable_cents: string; paid_cents: string; outstanding_cents: string; overdue_cents: string;
  buckets: Record<ApAgingBucket, string>; bill_count: number; outstanding_bill_count: number;
};
export type ApBillInput = {
  supplier_id: string; supplier_name: string; supplier_active: boolean; bill_id: string;
  bill_number: string | null; supplier_invoice_number: string; due_date: string | null;
  currency: string; payable_cents: string; paid_cents: string;
};
export type ApBill = ApBillInput & { outstanding_cents: string; bucket: ApAgingBucket };
export type ApSupplier = ApAmounts & { supplier_id: string; supplier_name: string; supplier_active: boolean; currency: string };
export type SupplierApBalanceBasis = 'CURRENT_POSTED_BILLS' | 'HISTORICAL_RECORDED_BALANCE';
export function parseSupplierApBalanceBasis(params: URLSearchParams): SupplierApBalanceBasis {
  const basis = params.get('balance_basis') ?? 'CURRENT_POSTED_BILLS';
  if (basis !== 'CURRENT_POSTED_BILLS' && basis !== 'HISTORICAL_RECORDED_BALANCE') throw new Error('Invalid balance_basis');
  return basis;
}
export type SupplierApOverview = {
  aging_date: string; balance_basis: SupplierApBalanceBasis; as_of_timezone?: 'UTC'; bills: ApBill[];
  suppliers: ApSupplier[]; currencies: Array<ApAmounts & { currency: string }>;
};
export type SupplierApFilters = {
  search: string; currency: string | null; supplierId: string | null; bucket: ApAgingBucket | null;
  page: number; supplierPage: number; pageSize: number;
};
export const DEFAULT_AP_FILTERS: SupplierApFilters = {
  search: '', currency: null, supplierId: null, bucket: null, page: 1, supplierPage: 1, pageSize: 50,
};
export type PagedSupplierApOverview = SupplierApOverview & {
  filters: SupplierApFilters;
  pagination: { page: number; supplier_page: number; page_size: number; outstanding_bill_count: number; supplier_count: number };
  options: { currencies: string[]; suppliers: Array<{ supplier_id: string; supplier_name: string }> };
};
export function parseSupplierApFilters(params: URLSearchParams): SupplierApFilters {
  function integer(name: string, fallback: number, max: number) {
    const value = params.get(name);
    if (value === null) return fallback;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > max) throw new Error(`Invalid ${name}`);
    return Number(value);
  }
  const search = (params.get('search') ?? '').trim();
  const currency = params.get('currency') || null;
  const supplierId = params.get('supplier_id') || null;
  const bucket = params.get('bucket') || null;
  if (search.length > 200) throw new Error('Search must be at most 200 characters');
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
  if (supplierId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supplierId)) throw new Error('Invalid supplier_id');
  if (bucket && !(AP_AGING_BUCKETS as readonly string[]).includes(bucket)) throw new Error('Invalid bucket');
  return { search, currency, supplierId, bucket: bucket as ApAgingBucket | null,
    page: integer('page', 1, 1000000), supplierPage: integer('supplier_page', 1, 1000000), pageSize: integer('page_size', 50, 100) };
}

export function calendarDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid calendar date');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Invalid calendar date');
  }
  return date.getTime() / 86400000;
}

export function agingBucket(dueDate: string | null, agingDate: string): ApAgingBucket {
  const at = calendarDay(agingDate);
  if (dueDate === null) return 'NO_DUE_DATE';
  const days = at - calendarDay(dueDate);
  return days <= 0 ? 'CURRENT' : days <= 30 ? 'DAYS_1_30' : days <= 60 ? 'DAYS_31_60' : days <= 90 ? 'DAYS_61_90' : 'DAYS_91_PLUS';
}

function emptyAmounts(): ApAmounts {
  return { payable_cents: '0', paid_cents: '0', outstanding_cents: '0', overdue_cents: '0',
    buckets: Object.fromEntries(AP_AGING_BUCKETS.map(bucket => [bucket, '0'])) as Record<ApAgingBucket, string>,
    bill_count: 0, outstanding_bill_count: 0 };
}
function cents(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error('Invalid AP amount');
  return BigInt(value);
}
function add(target: ApAmounts, bill: ApBill) {
  for (const key of ['payable_cents', 'paid_cents', 'outstanding_cents'] as const) {
    target[key] = (BigInt(target[key]) + BigInt(bill[key])).toString();
  }
  target.bill_count++;
  if (BigInt(bill.outstanding_cents) > BigInt(0)) target.outstanding_bill_count++;
  target.buckets[bill.bucket] = (BigInt(target.buckets[bill.bucket]) + BigInt(bill.outstanding_cents)).toString();
  if (bill.bucket !== 'CURRENT' && bill.bucket !== 'NO_DUE_DATE') {
    target.overdue_cents = (BigInt(target.overdue_cents) + BigInt(bill.outstanding_cents)).toString();
  }
}

export function buildSupplierApOverview(inputs: ApBillInput[], agingDate: string): SupplierApOverview {
  calendarDay(agingDate);
  const suppliers = new Map<string, ApSupplier>();
  const currencies = new Map<string, ApAmounts & { currency: string }>();
  const bills = inputs.map(input => {
    const remaining = cents(input.payable_cents) - cents(input.paid_cents);
    if (remaining < BigInt(0)) throw new Error('Supplier bill has a negative outstanding balance');
    const bill: ApBill = { ...input, outstanding_cents: remaining.toString(), bucket: agingBucket(input.due_date, agingDate) };
    const key = JSON.stringify([bill.supplier_id, bill.currency]);
    if (!suppliers.has(key)) suppliers.set(key, { ...emptyAmounts(), supplier_id: bill.supplier_id,
      supplier_name: bill.supplier_name, supplier_active: bill.supplier_active, currency: bill.currency });
    if (!currencies.has(bill.currency)) currencies.set(bill.currency, { ...emptyAmounts(), currency: bill.currency });
    add(suppliers.get(key)!, bill);
    add(currencies.get(bill.currency)!, bill);
    return bill;
  });
  return { aging_date: agingDate, balance_basis: 'CURRENT_POSTED_BILLS', bills,
    suppliers: [...suppliers.values()], currencies: [...currencies.values()] };
}
