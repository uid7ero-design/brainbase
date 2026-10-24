export const USER_MODULES = {
  people: { name: 'People and HR', path: '/people' },
  organiser: { name: 'Organiser', path: '/organiser' },
  crm: { name: 'CRM', path: '/crm' },
  events: { name: 'Events', path: '/events' },
  assurance: { name: 'Assurance', path: '/assurance' },
  debtors: { name: 'Debtors', path: '/debtors' },
  scheduling: { name: 'Scheduling', path: '/scheduling' },
  data_hub: { name: 'Data Hub', path: '/data-hub/import' },
  sales: { name: 'Sales', path: '/commercial/sales' },
  quotes: { name: 'Quotes', path: '/commercial/quotes' },
  invoicing: { name: 'Invoicing', path: '/commercial/invoices' },
  purchasing: { name: 'Purchasing', path: '/commercial/purchasing' },
  expenses: { name: 'Expenses', path: '/commercial/expenses' },
  budgeting: { name: 'Budgeting', path: '/commercial/budgeting' },
  finance_intelligence: { name: 'Finance intelligence', path: '/commercial/finance' },
} as const;
export type ModuleKey = keyof typeof USER_MODULES;
export type AccessLevel = 'none' | 'view' | 'use';
export type UserPermissions = Partial<Record<ModuleKey, AccessLevel>>;
export const CLIENT_ROLES = ['viewer', 'manager', 'admin'] as const;
export function parsePermissions(value: unknown): UserPermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid permissions');
  const result: UserPermissions = {};
  for (const [key, level] of Object.entries(value)) {
    if (!Object.hasOwn(USER_MODULES,key) || !['none', 'view', 'use'].includes(String(level))) throw new Error('Invalid permissions');
    result[key as ModuleKey] = level as AccessLevel;
  }
  return result;
}
const matches = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');
/** Page and HTTP API namespaces; unknown namespaces deny managed accounts. */
export function moduleForPath(path: string): ModuleKey[] {
  const plain = path.startsWith('/api/') ? path.slice(4) : path;
  if (matches(plain, '/hr') || matches(plain, '/people')) return ['people'];
  if (matches(plain, '/uploads') || matches(plain, '/upload') || matches(plain, '/data-hub')) return ['data_hub'];
  for (const key of ['organiser', 'crm', 'events', 'assurance', 'debtors', 'scheduling'] as const) {
    if (matches(plain, '/' + key)) return [key];
  }
  if (matches(plain, '/commercial')) {
    const segment = plain.split('/')[2];
    const aliases: Record<string, ModuleKey> = { invoices: 'invoicing', finance: 'finance_intelligence' };
    if (segment && (segment in USER_MODULES || segment in aliases)) return [aliases[segment] ?? segment as ModuleKey];
    if (!segment) return ['quotes','invoicing','purchasing','budgeting'];
    if (['customers','products'].includes(segment)) return ['quotes','invoicing'];
    if (['purchase-orders','purchase-receipts','supplier-bills','suppliers'].includes(segment)) return ['purchasing'];
    if (segment==='settings') return ['quotes','invoicing'];
    return [];
  }
  return [];
}
export function managedRequestAllowed(permissions: unknown, path: string, method: string, role: string): boolean {
  if (path==='/account/profile'||path==='/api/account/profile'||path === '/api/me' || path === '/workspace') return true;
  if (matches(path, '/settings/users') || matches(path, '/api/organisation/users')) return role === 'admin';
  let parsed: UserPermissions;
  try { parsed = parsePermissions(permissions); } catch { return false; }
  const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  return moduleForPath(path).some(key => parsed[key] === 'use' || (read && parsed[key] === 'view'));
}
