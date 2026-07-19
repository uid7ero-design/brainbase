// South Australian public holidays (weekday-observed dates only).
// Used for 2BD/5BD SLA business-day math on bin maintenance jobs.
export const SA_HOLIDAYS = new Set<string>([
  // 2025
  '2025-12-25', '2025-12-26',
  // 2026
  '2026-01-01', '2026-01-26',
  '2026-04-03', '2026-04-04', '2026-04-06', // Good Fri, Easter Sat, Easter Mon
  '2026-04-25', // ANZAC Day
  '2026-05-18', '2026-06-08', // Adelaide Cup, King's Birthday
  '2026-12-25', '2026-12-28',
  // 2027
  '2027-01-01', '2027-01-26',
  '2027-03-26', '2027-03-27', '2027-03-29',
  '2027-04-26',
  '2027-05-17', '2027-06-14',
  '2027-12-27', '2027-12-28',
  // 2028
  '2028-01-01', '2028-01-26',
  '2028-04-14', '2028-04-15', '2028-04-17',
  '2028-04-25',
  '2028-05-15', '2028-06-12',
  '2028-12-25', '2028-12-26',
  // 2029
  '2029-01-01', '2029-01-28',
  '2029-03-29', '2029-03-30', '2029-04-01',
  '2029-04-25',
  '2029-05-19', '2029-06-10',
  '2029-12-25', '2029-12-26',
  // 2030
  '2030-01-01', '2030-01-26',
  '2030-04-18', '2030-04-19', '2030-04-21',
  '2030-04-25',
  '2030-05-20', '2030-06-10',
  '2030-12-25', '2030-12-26',
  // 2031
  '2031-01-01', '2031-01-26',
  '2031-04-11', '2031-04-12', '2031-04-14',
  '2031-04-25',
  '2031-05-19', '2031-06-09',
  '2031-12-25', '2031-12-26',
]);

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6 && !SA_HOLIDAYS.has(localDateStr(date));
}

export function addBizDays(date: Date, n: number): Date {
  const d = new Date(date);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) added++;
  }
  d.setHours(23, 59, 59, 999);
  return d;
}
