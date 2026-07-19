import { BinMaintenanceJob, BinType, MaintenanceStatus, Severity } from '@prisma/client';
import { addBizDays, isBusinessDay, localDateStr } from './businessDays';

type JobInput = Pick<BinMaintenanceJob,
  | 'id' | 'suburb' | 'address' | 'issue_type' | 'bin_type'
  | 'status' | 'severity' | 'scheduled_date' | 'created_at' | 'assigned_to' | 'completed_date'
>;

type ComplianceJobInput = Pick<BinMaintenanceJob,
  | 'issue_type' | 'bin_type' | 'created_at' | 'completed_date' | 'status'
>;

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 86400000;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

// Open/closed is determined by completed_date (the CSV's Closed timestamp), not
// the status enum — status is only coarsely mapped from free-text on import and
// is often stale or absent; completed_date is the reliable source of truth.
function isOpen(j: { completed_date: Date | null }): boolean {
  return j.completed_date === null;
}

export function computeBinMaintenanceKpi(jobs: JobInput[]) {
  const now  = new Date();
  const open = jobs.filter(isOpen);
  const done = jobs.filter(j => !isOpen(j));

  const overdue_jobs = jobs.filter(j =>
    isOpen(j) &&
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
    if (isOpen(j)) {
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
    .filter(j => j.severity === Severity.CRITICAL && isOpen(j))
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

// ─── SLA / Compliance ───────────────────────────────────────────────────────

const TWO_BD_KEYWORDS = ['missed collection', 'missed', 'new bin', 'stolen', 'missing'];
const ADDITIONAL_CANCEL_KEYWORDS = ['additional cancel'];

export function kpiDeadlineDays(issueType: string): 2 | 5 {
  const t = issueType.toLowerCase();
  return TWO_BD_KEYWORDS.some(k => t.includes(k)) ? 2 : 5;
}

export function isAdditionalCancel(issueType: string): boolean {
  const t = issueType.toLowerCase();
  return ADDITIONAL_CANCEL_KEYWORDS.some(k => t.includes(k));
}

function getWeekLabel(d: Date): string {
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const fmt = (x: Date) => x.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  return `${fmt(mon)} – ${fmt(fri)}`;
}

export function computeCompliance(jobs: ComplianceJobInput[]) {
  const now = new Date();
  const eligible = jobs.filter(j => !isAdditionalCancel(j.issue_type));
  const excluded_count = jobs.length - eligible.length;

  const closed = eligible.filter(j => j.completed_date !== null);
  const openEligible = eligible.filter(j => j.completed_date === null);

  type Bucket = { within: number; outside: number };
  const byIssue = new Map<string, Bucket>();
  const byStream = new Map<string, Bucket>();
  const byWeek = new Map<string, Bucket & { startDs: string }>();

  let within = 0, outside = 0;

  const bump = (b: Bucket, ok: boolean) => { if (ok) b.within++; else b.outside++; };

  for (const j of closed) {
    const deadline = addBizDays(j.created_at, kpiDeadlineDays(j.issue_type));
    const ok = j.completed_date! <= deadline;
    if (ok) within++; else outside++;

    if (!byIssue.has(j.issue_type)) byIssue.set(j.issue_type, { within: 0, outside: 0 });
    bump(byIssue.get(j.issue_type)!, ok);

    if (!byStream.has(j.bin_type)) byStream.set(j.bin_type, { within: 0, outside: 0 });
    bump(byStream.get(j.bin_type)!, ok);

    const openDs = localDateStr(j.created_at);
    const wk = getWeekLabel(j.created_at);
    if (!byWeek.has(wk)) byWeek.set(wk, { within: 0, outside: 0, startDs: openDs });
    bump(byWeek.get(wk)!, ok);
  }

  const total = within + outside;
  const pct = total > 0 ? Math.round((within / total) * 1000) / 10 : 0;

  const by_issue_type = Array.from(byIssue.entries())
    .map(([issue_type, b]) => {
      const t = b.within + b.outside;
      return {
        issue_type,
        within: b.within,
        outside: b.outside,
        total: t,
        pct: t > 0 ? Math.round((b.within / t) * 1000) / 10 : 0,
        targetDays: kpiDeadlineDays(issue_type),
      };
    })
    .sort((a, b) => b.total - a.total);

  const by_bin_type = Array.from(byStream.entries())
    .map(([bin_type, b]) => {
      const t = b.within + b.outside;
      return { bin_type, within: b.within, outside: b.outside, total: t, pct: t > 0 ? Math.round((b.within / t) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.total - a.total);

  const weekly_trend = Array.from(byWeek.entries())
    .map(([weekLabel, b]) => {
      const t = b.within + b.outside;
      return { weekLabel, within: b.within, outside: b.outside, total: t, pct: t > 0 ? Math.round((b.within / t) * 1000) / 10 : 0, startDs: b.startDs };
    })
    .sort((a, b) => a.startDs.localeCompare(b.startDs));

  // Aging buckets for still-open eligible jobs
  const aging = { sameDay: 0, oneToTwo: 0, threeToSeven: 0, eightToFourteen: 0, fifteenPlus: 0 };
  let overdue_open = 0;
  for (const j of openEligible) {
    const ageDays = daysBetween(j.created_at, now);
    if (ageDays < 1) aging.sameDay++;
    else if (ageDays <= 2) aging.oneToTwo++;
    else if (ageDays <= 7) aging.threeToSeven++;
    else if (ageDays <= 14) aging.eightToFourteen++;
    else aging.fifteenPlus++;

    const deadline = addBizDays(j.created_at, kpiDeadlineDays(j.issue_type));
    if (deadline < now) overdue_open++;
  }

  return {
    pct, within, outside, total,
    by_issue_type, by_bin_type, weekly_trend,
    aging, overdue_open, excluded_count,
  };
}

export type BinMaintenanceCompliance = ReturnType<typeof computeCompliance>;

// ─── Category × stream cross-tab ────────────────────────────────────────────

export type CategoryStreamCrossTab = Record<string, Record<BinType, number>>;

export function computeCategoryStreamCrossTab(jobs: Pick<BinMaintenanceJob, 'issue_type' | 'bin_type'>[]) {
  const cross: Record<string, Record<BinType, number>> = {};
  for (const j of jobs) {
    if (!cross[j.issue_type]) {
      cross[j.issue_type] = { GENERAL_WASTE: 0, RECYCLING: 0, ORGANICS: 0, BULK_WASTE: 0 };
    }
    cross[j.issue_type][j.bin_type]++;
  }
  return cross;
}

// ─── Patterns (day-of-week / hour-of-day) ───────────────────────────────────

export function computePatterns(jobs: Pick<BinMaintenanceJob, 'created_at'>[]) {
  // Mon..Sun
  const by_dow = [0, 0, 0, 0, 0, 0, 0];
  const by_hour: Record<number, number> = {};
  for (const j of jobs) {
    const idx = (j.created_at.getDay() + 6) % 7;
    by_dow[idx]++;
    const h = j.created_at.getHours();
    by_hour[h] = (by_hour[h] ?? 0) + 1;
  }
  return { by_dow, by_hour };
}

export type BinMaintenancePatterns = ReturnType<typeof computePatterns>;

// ─── Projections ─────────────────────────────────────────────────────────────

export function computeProjections(jobs: Pick<BinMaintenanceJob, 'created_at'>[]) {
  const daily = new Map<string, number>();
  for (const j of jobs) {
    const ds = localDateStr(j.created_at);
    daily.set(ds, (daily.get(ds) ?? 0) + 1);
  }
  const dailyArr = Array.from(daily.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const numDays = dailyArr.length;
  const totalReqs = dailyArr.reduce((s, d) => s + d.count, 0);
  const avg_per_day = numDays > 0 ? Math.round((totalReqs / numDays) * 10) / 10 : 0;

  const weekdayVals = dailyArr.filter(d => isBusinessDay(new Date(`${d.date}T12:00:00`))).map(d => d.count);
  const avg_per_weekday = weekdayVals.length > 0
    ? Math.round((weekdayVals.reduce((a, b) => a + b, 0) / weekdayVals.length) * 10) / 10
    : 0;

  const projected_annual = Math.round(avg_per_day * 365);

  return { daily: dailyArr, avg_per_day, avg_per_weekday, projected_annual };
}

export type BinMaintenanceProjections = ReturnType<typeof computeProjections>;

// ─── Additional Cancel (excluded from every other tab's stats) ─────────────

type AdditionalCancelJobInput = Pick<BinMaintenanceJob,
  | 'suburb' | 'bin_type' | 'status' | 'created_at' | 'completed_date'
>;

export function computeAdditionalCancel(jobs: AdditionalCancelJobInput[]) {
  const total = jobs.length;
  const open = jobs.filter(j => j.completed_date === null).length;

  const by_status: Record<string, number> = {};
  const by_bin_type: Record<string, number> = {};
  const by_suburb: Record<string, number> = {};
  const daily = new Map<string, number>();
  const turnaroundByStatus = new Map<string, number[]>();

  for (const j of jobs) {
    by_status[j.status] = (by_status[j.status] ?? 0) + 1;
    by_bin_type[j.bin_type] = (by_bin_type[j.bin_type] ?? 0) + 1;
    by_suburb[j.suburb] = (by_suburb[j.suburb] ?? 0) + 1;

    const ds = localDateStr(j.created_at);
    daily.set(ds, (daily.get(ds) ?? 0) + 1);

    if (j.completed_date) {
      const hrs = (j.completed_date.getTime() - j.created_at.getTime()) / 3600000;
      if (hrs >= 0 && hrs < 8760) {
        if (!turnaroundByStatus.has(j.status)) turnaroundByStatus.set(j.status, []);
        turnaroundByStatus.get(j.status)!.push(hrs);
      }
    }
  }

  const sortDesc = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).sort(([, a], [, b]) => b - a));

  const daily_trend = Array.from(daily.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const avg_turnaround_by_status = Array.from(turnaroundByStatus.entries())
    .map(([status, hrs]) => ({
      status,
      avg_hours: Math.round((hrs.reduce((a, b) => a + b, 0) / hrs.length) * 10) / 10,
      count: hrs.length,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total, open,
    by_status: sortDesc(by_status),
    by_bin_type: sortDesc(by_bin_type),
    by_suburb: sortDesc(by_suburb),
    daily_trend,
    avg_turnaround_by_status,
  };
}

export type BinMaintenanceAdditionalCancel = ReturnType<typeof computeAdditionalCancel>;

// ─── Main dashboard header stats (full-dataset, replaces client-side pagination) ──

type DashboardHeaderJobInput = Pick<BinMaintenanceJob,
  | 'status' | 'severity' | 'scheduled_date' | 'assigned_to' | 'issue_type' | 'completed_date'
>;

export function computeDashboardHeaderStats(jobs: DashboardHeaderJobInput[]) {
  const now = new Date();
  const active = jobs.filter(isOpen);
  const completed = jobs.filter(j => !isOpen(j));

  const critical = active.filter(j => j.severity === Severity.CRITICAL || j.status === MaintenanceStatus.ESCALATED).length;
  const unassigned = active.filter(j => !j.assigned_to).length;
  const overdue = active.filter(j => j.scheduled_date !== null && j.scheduled_date < now).length;

  const compRate = jobs.length > 0 ? Math.round((completed.length / jobs.length) * 100) : 0;

  const by_status: Record<string, number> = {};
  for (const j of jobs) by_status[j.status] = (by_status[j.status] ?? 0) + 1;

  const by_issue_type_open: Record<string, number> = {};
  for (const j of active) by_issue_type_open[j.issue_type] = (by_issue_type_open[j.issue_type] ?? 0) + 1;

  return {
    total: jobs.length,
    active: active.length,
    critical,
    unassigned,
    overdue,
    completed: completed.length,
    compRate,
    by_status,
    by_issue_type_open,
  };
}

export type BinMaintenanceDashboardHeader = ReturnType<typeof computeDashboardHeaderStats>;

// ─── Schedule status (scheduled_date vs today, distinct from business-day SLA) ──

type ScheduleStatusJobInput = Pick<BinMaintenanceJob, 'status' | 'scheduled_date' | 'suburb' | 'completed_date'>;

export function computeScheduleStatus(jobs: ScheduleStatusJobInput[]) {
  const now = new Date();
  const withSch = jobs.filter(j => j.scheduled_date !== null);
  const active = withSch.filter(isOpen);

  let breached = 0, atRisk = 0, onTrack = 0;
  for (const j of active) {
    const days = (j.scheduled_date!.getTime() - now.getTime()) / 86400000;
    if (days < 0) breached++; else if (days < 2) atRisk++; else onTrack++;
  }

  const done = withSch.filter(j => !isOpen(j)).length;
  const pct = withSch.length > 0 ? Math.round(((done + onTrack) / withSch.length) * 100) : 100;

  const breachMap: Record<string, number> = {};
  for (const j of active) {
    if (j.scheduled_date! < now) breachMap[j.suburb] = (breachMap[j.suburb] ?? 0) + 1;
  }

  return {
    breached, atRisk, onTrack, pct,
    scheduled: withSch.length,
    worstSuburbs: Object.entries(breachMap).sort(([, a], [, b]) => b - a).slice(0, 3) as [string, number][],
  };
}

export type BinMaintenanceScheduleStatus = ReturnType<typeof computeScheduleStatus>;

// ─── Stream stats (per bin_type totals/active/completed/overdue) ──────────────

type StreamStatsJobInput = Pick<BinMaintenanceJob, 'bin_type' | 'status' | 'scheduled_date' | 'completed_date'>;

const STREAM_TYPES: BinType[] = [BinType.GENERAL_WASTE, BinType.RECYCLING, BinType.ORGANICS, BinType.BULK_WASTE];

export function computeStreamStats(jobs: StreamStatsJobInput[]) {
  const now = new Date();
  return STREAM_TYPES.map(type => {
    const all = jobs.filter(j => j.bin_type === type);
    const active = all.filter(isOpen);
    const completed = all.filter(j => !isOpen(j));
    const overdue = active.filter(j => j.scheduled_date !== null && j.scheduled_date < now).length;
    return {
      type,
      total: all.length,
      active: active.length,
      completed: completed.length,
      overdue,
      compRate: all.length > 0 ? Math.round((completed.length / all.length) * 100) : 0,
      pct: jobs.length > 0 ? Math.round((all.length / jobs.length) * 100) : 0,
    };
  });
}

export type BinMaintenanceStreamStats = ReturnType<typeof computeStreamStats>;

// ─── Repeat properties (same address flagged more than once) ─────────────────

type RepeatPropertyJobInput = Pick<BinMaintenanceJob, 'suburb' | 'address' | 'issue_type' | 'status' | 'completed_date'>;

export function computeRepeatProperties(jobs: RepeatPropertyJobInput[]) {
  const map = new Map<string, { suburb: string; address: string; count: number; issues: string[]; active: number }>();
  for (const j of jobs) {
    const k = `${j.suburb.toUpperCase()}__${j.address.toUpperCase()}`;
    if (!map.has(k)) map.set(k, { suburb: j.suburb, address: j.address, count: 0, issues: [], active: 0 });
    const p = map.get(k)!;
    p.count++;
    if (!p.issues.includes(j.issue_type)) p.issues.push(j.issue_type);
    if (isOpen(j)) p.active++;
  }
  return Array.from(map.values()).filter(p => p.count > 1).sort((a, b) => b.count - a.count);
}

export type BinMaintenanceRepeatProperties = ReturnType<typeof computeRepeatProperties>;

// ─── Completion trend (weekly closed volume by completed_date, last 8 weeks) ──

type CompletionTrendJobInput = Pick<BinMaintenanceJob, 'status' | 'completed_date'>;

export function computeCompletionTrend(jobs: CompletionTrendJobInput[]) {
  const done = jobs.filter(j => !isOpen(j));
  const byWeek: Record<string, number> = {};
  for (const j of done) {
    if (!j.completed_date) continue;
    const d = new Date(j.completed_date);
    d.setDate(d.getDate() - d.getDay() + 1);
    const k = d.toISOString().substring(0, 10);
    byWeek[k] = (byWeek[k] ?? 0) + 1;
  }
  const weeks = Object.keys(byWeek).sort().slice(-8);
  const trend = weeks.map(w => byWeek[w]);
  const avg = trend.length > 0 ? Math.round(trend.reduce((a, b) => a + b, 0) / trend.length) : 0;
  return { total: done.length, avg, trend };
}

export type BinMaintenanceCompletionTrend = ReturnType<typeof computeCompletionTrend>;

// ─── Damaged parts breakdown (parsed from Notes inspection checklist Q&A) ─────

// Notes for 'Damaged Bin' rows contain structured inspection answers imported
// verbatim from the source CSV, e.g. "Question: Missing Lid - Answer: True".
const DAMAGED_PART_KEYWORDS = ['Missing Lid', 'Cracked Bin Body', 'Missing Lid Pin', 'Missing Wheel'] as const;

function matchesPart(notes: string, keyword: string): boolean {
  const m = notes.match(new RegExp(`${keyword}\\s*[-:]\\s*Answer:\\s*(True|False)`, 'i'));
  return !!m && m[1].toLowerCase() === 'true';
}

type DamagedPartsJobInput = Pick<BinMaintenanceJob, 'issue_type' | 'bin_type' | 'notes'>;

export function computeDamagedParts(jobs: DamagedPartsJobInput[]) {
  const damaged = jobs.filter(j => j.issue_type === 'Damaged Bin');

  const by_part: Record<string, number> = {};
  for (const k of DAMAGED_PART_KEYWORDS) by_part[k] = 0;

  const by_stream: Record<BinType, number> = { GENERAL_WASTE: 0, RECYCLING: 0, ORGANICS: 0, BULK_WASTE: 0 };

  for (const j of damaged) {
    by_stream[j.bin_type]++;
    const notes = j.notes ?? '';
    // A bin can have multiple faults — checks are independent, counts won't sum to total_damaged.
    for (const part of DAMAGED_PART_KEYWORDS) {
      if (matchesPart(notes, part)) by_part[part]++;
    }
  }

  const topEntry = Object.entries(by_part).sort(([, a], [, b]) => b - a)[0];

  return {
    total_damaged: damaged.length,
    pct_of_total: jobs.length > 0 ? round1((damaged.length / jobs.length) * 100) : 0,
    by_part,
    by_stream,
    top_part: topEntry && topEntry[1] > 0 ? { part: topEntry[0], count: topEntry[1] } : null,
  };
}

export type BinMaintenanceDamagedParts = ReturnType<typeof computeDamagedParts>;

// ─── Missed Collections (General Waste = internal team, Organics/Recycling = contractor) ──

const MISSED_COLLECTION_ISSUE_TYPE = 'Missed Collection';
const CONTRACTOR_STREAMS: BinType[] = [BinType.ORGANICS, BinType.RECYCLING];

type MissedCollectionJobInput = Pick<BinMaintenanceJob, 'issue_type' | 'bin_type' | 'suburb' | 'status' | 'created_at' | 'completed_date'>;

export function isMissedCollection(issueType: string): boolean {
  return issueType === MISSED_COLLECTION_ISSUE_TYPE;
}

export function computeMissedCollections(jobs: MissedCollectionJobInput[]) {
  const missed = jobs.filter(j => isMissedCollection(j.issue_type));

  const by_stream: Record<BinType, number> = { GENERAL_WASTE: 0, RECYCLING: 0, ORGANICS: 0, BULK_WASTE: 0 };
  for (const j of missed) by_stream[j.bin_type]++;

  type TeamBucket = { total: number; open: number; completed: number };
  const teams: Record<'internal' | 'contractor', TeamBucket> = {
    internal:   { total: 0, open: 0, completed: 0 },
    contractor: { total: 0, open: 0, completed: 0 },
  };
  for (const j of missed) {
    const bucket = teams[CONTRACTOR_STREAMS.includes(j.bin_type) ? 'contractor' : 'internal'];
    bucket.total++;
    if (isOpen(j)) bucket.open++; else bucket.completed++;
  }

  const by_suburb: Record<string, number> = {};
  for (const j of missed) by_suburb[j.suburb] = (by_suburb[j.suburb] ?? 0) + 1;
  const by_suburb_sorted = Object.fromEntries(Object.entries(by_suburb).sort(([, a], [, b]) => b - a));

  const daily = new Map<string, number>();
  for (const j of missed) {
    const ds = localDateStr(j.created_at);
    daily.set(ds, (daily.get(ds) ?? 0) + 1);
  }
  const daily_trend = Array.from(daily.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    total: missed.length,
    open: missed.filter(isOpen).length,
    teams,
    by_stream,
    by_suburb: by_suburb_sorted,
    daily_trend,
  };
}

export type BinMaintenanceMissedCollections = ReturnType<typeof computeMissedCollections>;
