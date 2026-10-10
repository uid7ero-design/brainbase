export const HR_REGISTER_PAGE_SIZE = 25;
export const HR_REGISTER_MAX_BYTES = 256 * 1024;
export type RegisterKind = 'overview' | 'queue' | 'documents';
export type RegisterQuery = { page: number; search: string; filter: string; lifecycle: string };
const filters = {
  overview: ['all', 'outstanding', 'approvals', 'overdue'],
  queue: ['all', 'overdue', 'NOT_STARTED', 'IN_PROGRESS', 'AWAITING_APPROVAL'],
  documents: ['all', 'missing_version', 'pending_acknowledgement', 'unlinked_employee', 'pending_verification', 'rejected', 'expired', 'expiring_soon'],
};

/** Query input changes the view only; identity and organisation come from the session. */
export function parseRegisterQuery(url: string, kind: RegisterKind): RegisterQuery {
  const params = new URL(url).searchParams;
  const allowed = kind === 'documents' ? ['page', 'search', 'filter'] : ['page', 'search', 'filter', 'lifecycle'];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new Error('Invalid register query');
  }
  const page = params.get('page') ?? '1';
  const search = (params.get('search') ?? '').trim();
  const filter = params.get('filter') ?? 'all';
  const lifecycle = params.get('lifecycle') ?? 'all';
  if (!/^[1-9]\d{0,5}$/.test(page) || search.length > 200 || /[\u0000-\u001f]/.test(search)
    || !(filters[kind] as string[]).includes(filter) || !['all', 'onboarding', 'offboarding'].includes(lifecycle)) throw new Error('Invalid register query');
  return { page: Number(page), search, filter, lifecycle };
}

export type RegisterPagination = { page: number; page_size: number; total: number };
export function validateRegisterPagination(value: unknown, rowCount: number): RegisterPagination {
  const pagination = value as RegisterPagination | undefined;
  if (!pagination || !Number.isSafeInteger(pagination.total) || pagination.total < 0
    || pagination.page_size !== HR_REGISTER_PAGE_SIZE || !Number.isSafeInteger(pagination.page)
    || pagination.page < 1 || pagination.page > Math.max(1, Math.ceil(pagination.total / HR_REGISTER_PAGE_SIZE))
    || rowCount !== Math.min(HR_REGISTER_PAGE_SIZE, Math.max(0, pagination.total - (pagination.page - 1) * HR_REGISTER_PAGE_SIZE))) throw new Error('Invalid register page');
  return pagination;
}
