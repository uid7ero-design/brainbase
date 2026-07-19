import type { BinType, Severity, MaintenanceStatus } from '@prisma/client';

// ─── Column map ─────────────────────────────────────────────────────────────

export const BIN_MAINTENANCE_COLUMN_MAP: Record<string, string> = {
  // ticket number
  'ticket #':          'ticket_number',
  ticket:              'ticket_number',
  'ticket#':           'ticket_number',
  ticketnumber:        'ticket_number',
  ticketno:            'ticket_number',
  // suburb
  suburb:              'suburb',
  suburbname:          'suburb',
  'site suburb':       'suburb',
  sitesuburb:          'suburb',
  locality:            'suburb',
  area:                'suburb',
  town:                'suburb',
  city:                'suburb',
  // address (street name / full address)
  address:             'address',
  'street address':    'address',
  streetaddress:       'address',
  propertyaddress:     'address',
  'site address':      'address',
  siteaddress:         'address',
  location:            'address',
  sitename:            'address',
  site:                'address',
  streetno:            'address',
  propertyno:          'address',
  // street number — kept separate so we can combine with address
  'street number':     'street_number',
  streetnumber:        'street_number',
  'street no':         'street_number',
  streetno2:           'street_number',
  houseno:             'street_number',
  housenumber:         'street_number',
  // bin type / stream — Civica-style exports use a bare "Type" column
  // (Waste/Organics/Recycling) as the real stream indicator; "Bin Type" is a
  // separate bin-size/description field that's often blank. "Type" is earlier
  // in Civica's column order so it wins via mapRow's first-write-wins rule.
  type:                'bin_type',
  'bin type':          'bin_type',
  bin_type:            'bin_type',
  bintype:             'bin_type',
  bincolour:           'bin_type',
  bincolor:            'bin_type',
  binsize:             'bin_type',
  container:           'bin_type',
  containertype:       'bin_type',
  'waste stream':      'bin_type',
  wastestream:         'bin_type',
  stream:              'bin_type',
  // issue type
  'issue type':        'issue_type',
  issue_type:          'issue_type',
  issuetype:           'issue_type',
  issue:               'issue_type',
  'issue description': 'issue_type',
  issuedescription:    'issue_type',
  issuedetail:         'issue_type',
  'fault type':        'issue_type',
  fault_type:          'issue_type',
  faulttype:           'issue_type',
  fault:               'issue_type',
  'fault description': 'issue_type',
  faultdescription:    'issue_type',
  defect:              'issue_type',
  defecttype:          'issue_type',
  problem:             'issue_type',
  problemtype:         'issue_type',
  complaint:           'issue_type',
  complainttype:       'issue_type',
  description:         'issue_type',
  'job type':          'issue_type',
  jobtype:             'issue_type',
  'service fault':     'issue_type',
  servicefault:        'issue_type',
  maintenancetype:     'issue_type',
  repairtype:          'issue_type',
  category:            'issue_type',
  'service category':  'issue_type',
  servicecategory:     'issue_type',
  'request type':      'issue_type',
  requesttype:         'issue_type',
  'service type':      'issue_type',
  servicetype:         'issue_type',
  // severity
  severity:            'severity',
  priority:            'severity',
  urgency:             'severity',
  'job priority':      'severity',
  jobpriority:         'severity',
  // status
  status:              'status',
  state:               'status',
  'job status':        'status',
  jobstatus:           'status',
  // assigned to
  'assigned to':       'assigned_to',
  assigned_to:         'assigned_to',
  assignedto:          'assigned_to',
  assignee:            'assigned_to',
  technician:          'assigned_to',
  operator:            'assigned_to',
  crew:                'assigned_to',
  worker:              'assigned_to',
  officer:             'assigned_to',
  inspector:           'assigned_to',
  // scheduled date
  'scheduled date':    'scheduled_date',
  scheduled_date:      'scheduled_date',
  scheduleddate:       'scheduled_date',
  'due date':          'scheduled_date',
  duedate:             'scheduled_date',
  'target date':       'scheduled_date',
  targetdate:          'scheduled_date',
  // opened / reported date
  'date reported':     'opened_date',
  datereported:        'opened_date',
  'call time':         'opened_date',
  calltime:            'opened_date',
  'date lodged':       'opened_date',
  datelodged:          'opened_date',
  lodged:              'opened_date',
  'open date':         'opened_date',
  opendate:            'opened_date',
  opened:              'opened_date',
  openeddate:          'opened_date',
  'request date':      'opened_date',
  requestdate:         'opened_date',
  'created date':      'opened_date',
  createddate:         'opened_date',
  reported:            'opened_date',
  // closed / resolved / completed date
  'closed timestamp':  'closed_date',
  closedtimestamp:     'closed_date',
  'closed date':       'closed_date',
  closeddate:          'closed_date',
  closed:              'closed_date',
  'resolved date':     'closed_date',
  resolveddate:        'closed_date',
  resolved:            'closed_date',
  'completion date':   'closed_date',
  completiondate:      'closed_date',
  'completed date':    'closed_date',
  completeddate:       'closed_date',
  'date completed':    'closed_date',
  datecompleted:       'closed_date',
  // notes
  notes:               'notes',
  comments:            'notes',
  remarks:             'notes',
  'additional notes':  'notes',
  additionalnotes:     'notes',
  detail:              'notes',
};

// ─── Generic row-mapping helpers ────────────────────────────────────────────

// For column mapping — preserves spaces so "issue type" matches the map key "issue type"
export function normaliseKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, ' ');
}

// For detection only — strips ALL non-alpha chars so "Issue Type" = "issue_type" = "issuetype"
export function normDetect(k: string): string {
  return k.toLowerCase().replace(/[^a-z]/g, '');
}

export function mapRow(raw: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk  = normaliseKey(k);
    const nkd = normDetect(k);
    const mapped = map[nk] ?? map[nkd];
    // First non-empty write wins — don't overwrite a good value with N/A or empty
    if (mapped && !(mapped in out)) out[mapped] = v;
  }
  return out;
}

export function strVal(v: unknown): string {
  const s = v != null ? String(v).trim() : '';
  return s;
}

export function normBinType(s: string): BinType {
  const l = s.toLowerCase().replace(/[\s_-]/g, '');
  if (l.includes('recycl') || l === 'yellow') return 'RECYCLING';
  if (l.includes('organic') || l.includes('green') || l === 'fogo') return 'ORGANICS';
  if (l.includes('bulk') || l.includes('hard'))  return 'BULK_WASTE';
  return 'GENERAL_WASTE';
}

export function normSeverity(s: string): Severity {
  const l = s.toLowerCase();
  if (l === 'critical' || l === 'urgent') return 'CRITICAL';
  if (l === 'high')                       return 'HIGH';
  if (l === 'low' || l === 'minor')       return 'LOW';
  return 'MEDIUM';
}

export function normStatus(s: string): MaintenanceStatus {
  const l = s.toLowerCase().replace(/[\s_-]/g, '');
  if (l.startsWith('completed') || l === 'complete' || l === 'done' || l === 'resolved') return 'COMPLETED';
  if (l === 'closed' || l.startsWith('closed'))     return 'CLOSED';
  if (l === 'inprogress' || l === 'active')         return 'IN_PROGRESS';
  if (l === 'assigned')                             return 'ASSIGNED';
  if (l === 'scheduled')                            return 'SCHEDULED';
  if (l === 'escalated')                            return 'ESCALATED';
  return 'OPEN';
}

// Civica-style Australian D/M/YYYY or D/M/YYYY H:MM. Must be parsed explicitly —
// JS's native Date constructor assumes US M/D/YYYY and silently corrupts these:
// "1/04/2026" gets read as Jan 4 instead of Apr 1, and "13/04/2026" (day > 12,
// invalid as a US month) returns Invalid Date and is silently dropped to null.
const AU_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/;

// Sanity bound — reject anything outside a plausible operational date range
// rather than silently writing a garbage timestamp from a malformed cell.
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function sane(d: Date): Date | null {
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return y >= MIN_YEAR && y <= MAX_YEAR ? d : null;
}

export function normDate(v: unknown): Date | null {
  if (!v) return null;
  // Already a Date object (XLSX cellDates: true)
  if (v instanceof Date) return sane(v);
  // Excel serial number (days since 1900-01-01 with 1900 leap-year bug offset)
  if (typeof v === 'number') {
    return sane(new Date((v - 25569) * 86400 * 1000));
  }
  const s = String(v).trim();
  const m = s.match(AU_DATE_RE);
  if (m) {
    const [, dd, mm, yyyy, hh, min] = m;
    return sane(new Date(Number(yyyy), Number(mm) - 1, Number(dd), hh ? Number(hh) : 0, min ? Number(min) : 0));
  }
  // Fallback for anything not in D/M/YYYY form (e.g. already-ISO dates)
  return sane(new Date(s));
}

// ─── Row → record mapping ───────────────────────────────────────────────────

export type BinMaintenanceRecordInput = {
  ticket_number:  string | null;
  suburb:         string;
  address:        string;
  bin_type:       BinType;
  issue_type:     string;
  severity:       Severity;
  status:         MaintenanceStatus;
  assigned_to:    string | null;
  scheduled_date: Date | null;
  completed_date: Date | null;
  notes:          string | null;
  created_at?:    Date;
};

export type MapRowResult =
  | { ok: true; record: BinMaintenanceRecordInput }
  | { ok: false; reason: 'no_suburb' | 'no_address' | 'no_issue_type' };

export function mapBinMaintenanceRow(raw: Record<string, unknown>): MapRowResult {
  const rec = mapRow(raw, BIN_MAINTENANCE_COLUMN_MAP);

  const suburb = strVal(rec.suburb);
  if (!suburb) return { ok: false, reason: 'no_suburb' };

  // Combine "Street Number" + "Site Address" (or similar) into a full address
  const streetName = strVal(rec.address);
  const streetNum  = strVal(rec.street_number);
  const address    = streetNum && streetName ? `${streetNum} ${streetName}` : (streetName || streetNum);
  if (!address) return { ok: false, reason: 'no_address' };

  const issueType = strVal(rec.issue_type) || strVal(rec.description) || strVal(rec.fault) || strVal(rec.defect);
  if (!issueType) return { ok: false, reason: 'no_issue_type' };

  const openedDate = normDate(rec.opened_date);

  return {
    ok: true,
    record: {
      ticket_number:  strVal(rec.ticket_number) || null,
      suburb,
      address,
      bin_type:       normBinType(strVal(rec.bin_type)),
      issue_type:     issueType,
      severity:       normSeverity(strVal(rec.severity) || strVal(rec.priority)),
      status:         normStatus(strVal(rec.status) || strVal(rec.state)),
      assigned_to:    strVal(rec.assigned_to) || null,
      scheduled_date: normDate(rec.scheduled_date),
      completed_date: normDate(rec.closed_date),
      notes:          strVal(rec.notes) || null,
      ...(openedDate ? { created_at: openedDate } : {}),
    },
  };
}
