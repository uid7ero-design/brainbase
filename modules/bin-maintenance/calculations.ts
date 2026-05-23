import { BinMaintenanceJob, MaintenanceStatus, Severity } from '@prisma/client';

type JobInput = Pick<BinMaintenanceJob,
  | 'id' | 'suburb' | 'address' | 'issue_type' | 'bin_type'
  | 'status' | 'severity' | 'scheduled_date' | 'created_at' | 'assigned_to'
>;

const TERMINAL: MaintenanceStatus[] = [MaintenanceStatus.COMPLETED, MaintenanceStatus.CLOSED];

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 86400000;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function computeBinMaintenanceKpi(jobs: JobInput[]) {
  const now  = new Date();
  const open = jobs.filter(j => !TERMINAL.includes(j.status));
  const done = jobs.filter(j =>  TERMINAL.includes(j.status));

  const overdue_jobs = jobs.filter(j =>
    !TERMINAL.includes(j.status) &&
    j.scheduled_date !== null &&
    j.scheduled_date < now
  ).length;

  const unassigned_open = jobs.filter(j =>
    j.status === MaintenanceStatus.OPEN && j.assigned_to === null
  ).length;

  const avg_age_open_days = open.length > 0
    ? round1(open.reduce((acc, j) => acc + daysBetween(j.created_at, now), 0) / open.length)
    : 0;

  const completion_rate = jobs.length > 0
    ? round1((done.length / jobs.length) * 100)
    : 0;

  // by_suburb
  const subMap = new Map<string, { total: number; open: number; critical: number; ageSum: number; openCnt: number }>();
  for (const j of jobs) {
    if (!subMap.has(j.suburb)) subMap.set(j.suburb, { total: 0, open: 0, critical: 0, ageSum: 0, openCnt: 0 });
    const s = subMap.get(j.suburb)!;
    s.total++;
    if (!TERMINAL.includes(j.status)) {
      s.open++;
      s.ageSum += daysBetween(j.created_at, now);
      s.openCnt++;
      if (j.severity === Severity.CRITICAL) s.critical++;
    }
  }

  const by_suburb = Array.from(subMap.entries())
    .map(([suburb, s]) => ({
      suburb,
      total:        s.total,
      open:         s.open,
      critical:     s.critical,
      avg_age_days: s.openCnt > 0 ? round1(s.ageSum / s.openCnt) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const by_issue_type: Record<string, number> = {};
  for (const j of jobs) by_issue_type[j.issue_type] = (by_issue_type[j.issue_type] ?? 0) + 1;

  const by_bin_type: Record<string, number> = {};
  for (const j of jobs) by_bin_type[j.bin_type] = (by_bin_type[j.bin_type] ?? 0) + 1;

  const by_status: Record<string, number> = {};
  for (const j of jobs) by_status[j.status] = (by_status[j.status] ?? 0) + 1;

  const critical_unresolved = jobs
    .filter(j => j.severity === Severity.CRITICAL && !TERMINAL.includes(j.status))
    .map(j => ({
      id:         j.id,
      suburb:     j.suburb,
      address:    j.address,
      issue_type: j.issue_type,
      days_open:  Math.floor(daysBetween(j.created_at, now)),
    }))
    .sort((a, b) => b.days_open - a.days_open);

  return {
    total_jobs:         jobs.length,
    open_jobs:          open.length,
    completed_jobs:     done.length,
    completion_rate,
    overdue_jobs,
    unassigned_open,
    avg_age_open_days,
    by_suburb,
    by_issue_type,
    by_bin_type,
    by_status,
    critical_unresolved,
  };
}

export type BinMaintenanceKpi = ReturnType<typeof computeBinMaintenanceKpi>;
