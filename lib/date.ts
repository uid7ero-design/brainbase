export function parseLocalDate(dateStr: string): Date {
  const s = dateStr.slice(0, 10)
  const [y, m, d] = s.split('-')
  return new Date(Number(y), Number(m) - 1, Number(d))
}

export function formatDateAU(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  return d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
}

// ─── Calendar range helpers (Week/Month navigation) ────────────────────────
// Pure, hook-free date arithmetic — kept outside the sessions page component
// so it stays independently unit-testable and doesn't add to that
// component's existing hook-lint debt.

/** Inverse of parseLocalDate: local Date -> 'YYYY-MM-DD', no UTC shift. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function addWeeks(d: Date, n: number): Date {
  return addDays(d, n * 7)
}

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1)
  // Clamp to the last day of the target month if the original day doesn't
  // exist there (e.g. 31 Jan + 1 month should land on the last day of Feb,
  // not silently roll over into March).
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()
  r.setDate(Math.min(d.getDate(), lastDay))
  return r
}

/** Monday of the week containing `d` (Australian/ISO week start). */
export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = r.getDay() // 0 = Sunday .. 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day // shift back to Monday
  r.setDate(r.getDate() + diff)
  return r
}

export function endOfWeek(d: Date): Date {
  return addDays(startOfWeek(d), 6)
}

export type DateRange = { start: Date; end: Date }

/** Monday-to-Sunday range for the week containing `d`. */
export function getWeekRange(d: Date): DateRange {
  return { start: startOfWeek(d), end: endOfWeek(d) }
}

/**
 * Calendar-grid range for the month containing `d`: the Monday on/before
 * the 1st through the Sunday on/after the last day — i.e. exactly the
 * cells a 7-column month grid needs to display, including leading/trailing
 * days from adjacent months. Used for both rendering AND the bounded data
 * query, so the two never disagree.
 */
export function getMonthGridRange(d: Date): DateRange {
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1)
  const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { start: startOfWeek(firstOfMonth), end: endOfWeek(lastOfMonth) }
}

/**
 * All calendar dates from range.start to range.end inclusive, in order.
 * Steps day-by-day via addDays() (field-based, local time) rather than
 * dividing a millisecond difference by 86400000 — Australian states observe
 * DST, so a local-midnight-to-local-midnight span isn't always exactly 24h
 * on the days either side of a DST transition, which would silently drop or
 * duplicate a day if computed via ms math.
 */
export function eachDayInRange(range: DateRange): Date[] {
  const days: Date[] = []
  let cur = range.start
  while (cur.getTime() <= range.end.getTime()) {
    days.push(cur)
    cur = addDays(cur, 1)
  }
  return days
}

const AU_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** e.g. "17–23 August 2026", or "28 Aug – 3 Sep 2026" across a month boundary. */
export function formatWeekHeading(range: DateRange): string {
  const { start, end } = range
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${AU_MONTHS[start.getMonth()]} ${start.getFullYear()}`
  }
  const sameYear = start.getFullYear() === end.getFullYear()
  const startLabel = `${start.getDate()} ${AU_MONTHS[start.getMonth()].slice(0, 3)}`
  const endLabel = `${end.getDate()} ${AU_MONTHS[end.getMonth()].slice(0, 3)}`
  return sameYear
    ? `${startLabel} – ${endLabel} ${end.getFullYear()}`
    : `${startLabel} ${start.getFullYear()} – ${endLabel} ${end.getFullYear()}`
}

/** e.g. "August 2026". */
export function formatMonthHeading(d: Date): string {
  return `${AU_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
