import { EMPLOYMENT_STATUSES, WORKER_TYPES, type EmploymentStatus, type WorkerType } from './personEnums';
import { validateRegisterPagination, type RegisterPagination } from './registerPaging';

export type PeopleRegisterQuery = { page: number; search: string; status: EmploymentStatus | 'all'; workerType: WorkerType | 'all' };
export type PeopleRegisterRow = {
  id: string; first_name: string; last_name: string; job_title: string | null;
  worker_type: WorkerType; employment_status: EmploymentStatus; team_name: string | null;
  manager_first_name: string | null; manager_last_name: string | null;
};
export type PeopleRegisterSnapshot = { people: PeopleRegisterRow[]; canManage: boolean; pagination: RegisterPagination };

export function parsePeopleRegisterQuery(url: string): PeopleRegisterQuery {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (!['page', 'search', 'status', 'worker_type'].includes(key) || params.getAll(key).length !== 1) throw new Error('Invalid People query');
  }
  const page = params.get('page') ?? '1', search = (params.get('search') ?? '').trim();
  const status = params.get('status') ?? 'all', workerType = params.get('worker_type') ?? 'all';
  if (!/^[1-9]\d{0,5}$/.test(page) || search.length > 200 || /[\u0000-\u001f]/.test(search)
    || !['all', ...EMPLOYMENT_STATUSES].includes(status) || !['all', ...WORKER_TYPES].includes(workerType)) throw new Error('Invalid People query');
  return { page: Number(page), search, status: status as PeopleRegisterQuery['status'], workerType: workerType as PeopleRegisterQuery['workerType'] };
}

/** The register exposes only the fields its table needs, never a detail record. */
export function parsePeopleRegisterSnapshot(value: unknown): PeopleRegisterSnapshot {
  const snapshot = value as PeopleRegisterSnapshot | undefined;
  if (!snapshot || !Array.isArray(snapshot.people) || typeof snapshot.canManage !== 'boolean') throw new Error('Invalid People snapshot');
  validateRegisterPagination(snapshot.pagination, snapshot.people.length);
  for (const row of snapshot.people) {
    if (!row || !['id', 'first_name', 'last_name'].every(key => typeof row[key as keyof PeopleRegisterRow] === 'string')
      || !['job_title', 'team_name', 'manager_first_name', 'manager_last_name'].every(key => row[key as keyof PeopleRegisterRow] === null || typeof row[key as keyof PeopleRegisterRow] === 'string')
      || !(WORKER_TYPES as readonly string[]).includes(row.worker_type)
      || !(EMPLOYMENT_STATUSES as readonly string[]).includes(row.employment_status)) throw new Error('Invalid People row');
  }
  const fields = ['id', 'first_name', 'last_name', 'job_title', 'worker_type', 'employment_status', 'team_name', 'manager_first_name', 'manager_last_name'] as const;
  return { people: snapshot.people.map(row => Object.fromEntries(fields.map(key => [key, row[key]])) as PeopleRegisterRow),
    canManage: snapshot.canManage, pagination: { page: snapshot.pagination.page, page_size: snapshot.pagination.page_size, total: snapshot.pagination.total } };
}
