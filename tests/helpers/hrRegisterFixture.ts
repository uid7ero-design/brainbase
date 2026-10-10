/** HTTP fixture applies the same view semantics before returning a bounded page. */
export function hrRegisterFixture(body: unknown, url: string, names: unknown[] = []) {
  if (!body || typeof body !== 'object') return body;
  const value = body as Record<string, unknown>;
  const key = Array.isArray(value.workflows) ? 'workflows' : Array.isArray(value.tasks) ? 'tasks' : 'people';
  if (!Array.isArray(value[key])) return body;
  const params = new URL(url, 'http://fixture.local').searchParams;
  const isPeople = new URL(url, 'http://fixture.local').pathname === '/api/hr/people/register';
  const filter = params.get('filter') ?? 'all', lifecycle = params.get('lifecycle') ?? 'all';
  const search = (params.get('search') ?? '').trim().toLowerCase();
  const people = (Array.isArray(value.people) && key !== 'people' ? value.people : names) as Record<string, unknown>[];
  const rows = (value[key] as Record<string, unknown>[]).filter(row => {
    const person = key === 'people' ? row : people.find(person => person.id === row.person_id);
    const text = `${person?.first_name ?? ''} ${person?.last_name ?? ''}${key === 'tasks' ? ` ${row.title}` : ''}`.toLowerCase();
    const field = ({ outstanding: 'outstanding_tasks', approvals: 'awaiting_approval', overdue: key === 'tasks' ? 'overdue' : 'overdue_tasks' } as Record<string, string>)[filter] ?? filter;
    const matches = filter === 'all' || (key === 'tasks' && filter !== 'overdue' ? row.status === filter : Number(row[field]) > 0);
    if (isPeople) return (params.get('status') === 'all' || !params.get('status') || row.employment_status === params.get('status'))
      && (params.get('worker_type') === 'all' || !params.get('worker_type') || row.worker_type === params.get('worker_type'))
      && [text, String(row.job_title ?? '').toLowerCase(), String(row.team_name ?? '').toLowerCase()].some(value => value.includes(search));
    return matches && (lifecycle === 'all' || row.lifecycle_type === lifecycle) && (!search || text.includes(search));
  });
  const page = Math.min(Number(params.get('page') ?? 1), Math.max(1, Math.ceil(rows.length / 25)));
  const selected = rows.slice((page - 1) * 25, page * 25);
  return { ...value, [key]: selected, ...(key === 'people' ? {} : { people: people.filter(person => selected.some(row => row.person_id === person.id)) }), pagination: { page, page_size: 25, total: rows.length } };
}
