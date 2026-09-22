// Data Hub 6.2C2 — Onkaparinga reporting-period detector (PURE DETECTOR
// CONTRACT ONLY).
//
// This module is a pure, read-only function over immutable, already-
// extracted, safe structural signals. It NEVER reads XLSX bytes, NEVER
// touches Prisma/the DB, NEVER resolves a session/org, NEVER hits the
// filesystem or network, and is NOT wired into confirm/import persistence
// in this phase — see the 6.2C2 task brief for the full list of hard
// safety rules this module exists under.
//
// Operational row dates, upload timestamps, filesystem timestamps, and
// XLSX-modified timestamps are always NON_AUTHORITATIVE and are NEVER
// used to determine a period or a suggestion — they are surfaced in the
// evidence array purely to prove (by construction, and by the containment
// tests) that they were seen and ignored.
//
// Conflicts between trusted signals are NEVER silently resolved: any
// disagreement between AUTHORITATIVE/STRONG/CORROBORATING signals yields
// AMBIGUOUS with a null period — never a "best guess" period.

export type DetectionOutcome = "EXACT" | "AMBIGUOUS" | "ABSENT";

export type DetectorReasonCode =
  | "EXACT_CORROBORATED"
  | "EXACT_EXPLICIT_METADATA"
  | "TRUSTED_SIGNALS_CONFLICT"
  | "MONTH_WITHOUT_YEAR"
  | "FILENAME_ONLY_UNCORROBORATED"
  | "MULTIPLE_FILENAME_CANDIDATES"
  | "EXPECTED_CONTENT_SIGNAL_MISSING"
  | "INVALID_FILENAME_PERIOD"
  | "INVALID_PERIOD_RANGE"
  | "MULTIPERIOD_TREND_ONLY"
  | "NO_TRUSTED_PERIOD_SIGNAL"
  | "UNRECOGNISED_SOURCE_SCHEMA";

export type EvidenceType =
  | "EXPLICIT_PERIOD_METADATA"
  | "FILENAME_PERIOD"
  | "WORKBOOK_OVERVIEW_MONTH"
  | "SERVICE_EXCEPTION_TOTALS_MONTH"
  | "TRENDS_PERIOD_CORROBORATION"
  | "OPERATIONAL_ROW_DATES"
  | "UPLOAD_TIMESTAMP"
  | "FILE_TIMESTAMP"
  | "SOURCE_SCHEMA_MATCH";

export type EvidenceAuthority = "AUTHORITATIVE" | "STRONG" | "CORROBORATING" | "NON_AUTHORITATIVE";

export type EvidenceStatus = "SUPPORTS" | "CONFLICTS" | "MISSING" | "INVALID" | "IGNORED";

export interface PeriodBounds {
  start: string;
  end: string;
}

export interface EvidenceCandidate {
  month: number | null;
  year: number | null;
  start: string | null;
  end: string | null;
}

export interface EvidenceItem {
  type: EvidenceType;
  source: string;
  authority: EvidenceAuthority;
  status: EvidenceStatus;
  candidate: EvidenceCandidate | null;
  details: string;
}

export interface DetectorResult {
  outcome: DetectionOutcome;
  period: PeriodBounds | null;
  suggestedPeriod: PeriodBounds | null;
  reasonCode: DetectorReasonCode;
  requiresManualSelection: boolean;
  evidence: EvidenceItem[];
}

export interface NonAuthoritativeEvidenceFlags {
  operationalRowDatesPresent?: boolean;
  uploadTimestampPresent?: boolean;
  fileTimestampPresent?: boolean;
  xlsxModifiedTimestampPresent?: boolean;
}

// Source/schema-specific pure input contract — every field is an already-
// extracted safe structural signal. This module is never responsible for
// reading workbook bytes.
export interface OnkaparingaDetectorInput {
  originalFilename: string;
  schemaMatched: boolean;
  explicitPeriodMetadata?: string | null;
  overviewHeading?: string | null;
  serviceExceptionTotalsHeading?: string | null;
  trendsHeading?: string | null;
  trendsYear?: number | null;
  nonAuthoritativeEvidence?: NonAuthoritativeEvidenceFlags;
}

// ─── Calendar helpers (self-contained — mirrors selectWorksheetPeriod.ts's
// own ISO calendar-date discipline; never delegates to `new Date(string)`'s
// lenient/locale-dependent parsing) ──────────────────────────────────────

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function monthBounds(year: number, month: number): PeriodBounds {
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  };
}

const ISO_CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidIsoCalendarDate(value: string): boolean {
  const match = ISO_CALENDAR_DATE_RE.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

// Small exported pure validator for a candidate explicit start/end range —
// deliberately separate from the main detector's own month-boundary
// construction (which always derives calendar-valid bounds from a
// month+year pair by construction and can never itself produce an invalid
// range). Exists so an out-of-order or malformed candidate range can be
// proven INVALID_PERIOD_RANGE without contriving impossible runtime state
// inside the detector itself.
export function validateCandidateRange(
  startIso: string,
  endIso: string
): { valid: true } | { valid: false; reasonCode: "INVALID_PERIOD_RANGE" } {
  if (!isValidIsoCalendarDate(startIso) || !isValidIsoCalendarDate(endIso)) {
    return { valid: false, reasonCode: "INVALID_PERIOD_RANGE" };
  }
  if (startIso > endIso) {
    return { valid: false, reasonCode: "INVALID_PERIOD_RANGE" };
  }
  return { valid: true };
}

// ─── Month-name parsing ─────────────────────────────────────────────────

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function parseMonthName(word: string): number | null {
  const idx = MONTH_NAMES.indexOf(word.trim().toLowerCase());
  return idx === -1 ? null : idx + 1;
}

function findMonthWord(text: string): number | null {
  const words = text.toLowerCase().split(/[^a-z]+/);
  for (const word of words) {
    const month = parseMonthName(word);
    if (month !== null) return month;
  }
  return null;
}

// ─── Filename grammar ───────────────────────────────────────────────────
//
// Strict shape: city of onkaparinga-month-<month>-<yyyy>.xlsx
// Case-insensitive. Allowed separators between tokens: hyphen, underscore,
// single/multiple spaces (in any run/combination). No loose "filename
// happens to contain a month word" acceptance, no current-year/timestamp
// use.

const SEP = "[-_ ]+";
const PREFIX_RE = new RegExp(`^city${SEP}of${SEP}onkaparinga${SEP}month${SEP}`, "i");
const ANCHORED_RE = new RegExp(`^city${SEP}of${SEP}onkaparinga${SEP}month${SEP}([a-z]+)${SEP}(\\d+)$`, "i");
const LOOSE_CANDIDATE_RE = new RegExp(`month${SEP}([a-z]+)${SEP}(\\d+)`, "gi");

type FilenameOutcome =
  | { status: "MATCH"; month: number; year: number }
  | { status: "MULTIPLE" }
  | { status: "INVALID" }
  | { status: "UNRELATED" };

function evaluateFilename(originalFilename: string): FilenameOutcome {
  const xlsxMatch = /^(.*)\.xlsx$/i.exec(originalFilename.trim());
  if (!xlsxMatch) return { status: "UNRELATED" };
  const base = xlsxMatch[1];

  const anchored = ANCHORED_RE.exec(base);
  if (anchored) {
    const month = parseMonthName(anchored[1]);
    const yearToken = anchored[2];
    if (month !== null && /^\d{4}$/.test(yearToken)) {
      return { status: "MATCH", month, year: Number(yearToken) };
    }
    return { status: "INVALID" };
  }

  if (!PREFIX_RE.test(base)) return { status: "UNRELATED" };

  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  LOOSE_CANDIDATE_RE.lastIndex = 0;
  while ((m = LOOSE_CANDIDATE_RE.exec(base)) !== null) {
    const month = parseMonthName(m[1]);
    if (month !== null && /^\d{4}$/.test(m[2])) {
      seen.add(`${month}-${m[2]}`);
    }
  }
  if (seen.size >= 2) return { status: "MULTIPLE" };
  return { status: "INVALID" };
}

// ─── Trends heading ("<label> <month> to <month>") ─────────────────────

function parseTrendsRange(trendsHeading: string): { startMonth: number; endMonth: number } | null {
  const match = /([a-z]+)\s+to\s+([a-z]+)\s*$/i.exec(trendsHeading.trim());
  if (!match) return null;
  const startMonth = parseMonthName(match[1]);
  const endMonth = parseMonthName(match[2]);
  if (startMonth === null || endMonth === null) return null;
  return { startMonth, endMonth };
}

// ─── Explicit period metadata ("YYYY-MM", strict) ───────────────────────

const EXPLICIT_METADATA_RE = /^(\d{4})-(\d{2})$/;

function parseExplicitMetadata(value: string): { month: number; year: number } | null {
  const match = EXPLICIT_METADATA_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { month, year };
}

// ─── Candidate comparison ────────────────────────────────────────────────

interface Candidate {
  month: number;
  year: number | null;
}

function candidatesConflict(a: Candidate, b: Candidate): boolean {
  if (a.month !== b.month) return true;
  if (a.year !== null && b.year !== null && a.year !== b.year) return true;
  return false;
}

function candidateToEvidenceCandidate(c: Candidate): EvidenceCandidate {
  return {
    month: c.month,
    year: c.year,
    start: c.year !== null ? monthBounds(c.year, c.month).start : null,
    end: c.year !== null ? monthBounds(c.year, c.month).end : null,
  };
}

// ─── Main detector ────────────────────────────────────────────────────────

export function detectOnkaparingaReportingPeriod(input: OnkaparingaDetectorInput): DetectorResult {
  const flags = input.nonAuthoritativeEvidence ?? {};

  // ---- Filename evidence -------------------------------------------------
  const filenameOutcome = evaluateFilename(input.originalFilename);
  const filenameCandidate: Candidate | null =
    filenameOutcome.status === "MATCH" ? { month: filenameOutcome.month, year: filenameOutcome.year } : null;

  const filenameEvidence: EvidenceItem = {
    type: "FILENAME_PERIOD",
    source: "originalFilename",
    authority: "STRONG",
    status:
      filenameOutcome.status === "MATCH"
        ? "SUPPORTS"
        : filenameOutcome.status === "INVALID"
          ? "INVALID"
          : filenameOutcome.status === "MULTIPLE"
            ? "CONFLICTS"
            : "MISSING",
    candidate: filenameCandidate ? candidateToEvidenceCandidate(filenameCandidate) : null,
    details:
      filenameOutcome.status === "MATCH"
        ? `strict filename period ${filenameOutcome.year}-${pad2(filenameOutcome.month)}`
        : filenameOutcome.status === "INVALID"
          ? "recognisable Onkaparinga filename prefix with a malformed month/year token"
          : filenameOutcome.status === "MULTIPLE"
            ? "recognisable Onkaparinga filename prefix with more than one candidate month/year pair"
            : "filename does not match the strict Onkaparinga naming grammar",
  };

  // ---- Explicit period metadata evidence ---------------------------------
  const explicitRaw = input.explicitPeriodMetadata ?? null;
  const explicitParsed = explicitRaw !== null ? parseExplicitMetadata(explicitRaw) : null;
  const explicitCandidate: Candidate | null = explicitParsed
    ? { month: explicitParsed.month, year: explicitParsed.year }
    : null;

  const explicitEvidence: EvidenceItem = {
    type: "EXPLICIT_PERIOD_METADATA",
    source: "explicitPeriodMetadata",
    authority: "AUTHORITATIVE",
    status: explicitRaw === null ? "MISSING" : explicitCandidate ? "SUPPORTS" : "INVALID",
    candidate: explicitCandidate ? candidateToEvidenceCandidate(explicitCandidate) : null,
    details:
      explicitRaw === null
        ? "no explicit period metadata field supplied"
        : explicitCandidate
          ? `explicit period metadata ${explicitRaw}`
          : "explicit period metadata present but not a strict YYYY-MM value",
  };

  // ---- Source schema match evidence --------------------------------------
  const schemaEvidence: EvidenceItem = {
    type: "SOURCE_SCHEMA_MATCH",
    source: "schemaMatched",
    authority: "AUTHORITATIVE",
    status: input.schemaMatched ? "SUPPORTS" : "CONFLICTS",
    candidate: null,
    details: input.schemaMatched
      ? "workbook structurally matches the configured Onkaparinga schema"
      : "workbook does not match the configured Onkaparinga schema",
  };

  // ---- Content evidence (only trustworthy when schemaMatched=true) ------
  function contentFieldEvidence(
    type: EvidenceType,
    source: string,
    raw: string | null | undefined
  ): { evidence: EvidenceItem; candidate: Candidate | null } {
    const value = raw ?? null;
    if (value === null) {
      return {
        evidence: {
          type,
          source,
          authority: "CORROBORATING",
          status: "MISSING",
          candidate: null,
          details: "no heading supplied",
        },
        candidate: null,
      };
    }
    const month = findMonthWord(value);
    if (month === null) {
      return {
        evidence: {
          type,
          source,
          authority: "CORROBORATING",
          status: "INVALID",
          candidate: null,
          details: `heading "${value}" does not contain a recognisable month`,
        },
        candidate: null,
      };
    }
    const candidate: Candidate = { month, year: null };
    return {
      evidence: {
        type,
        source,
        authority: "CORROBORATING",
        status: "SUPPORTS",
        candidate: candidateToEvidenceCandidate(candidate),
        details: `heading "${value}" -> month ${month}`,
      },
      candidate,
    };
  }

  const overview = contentFieldEvidence("WORKBOOK_OVERVIEW_MONTH", "overviewHeading", input.overviewHeading);
  const setTotals = contentFieldEvidence(
    "SERVICE_EXCEPTION_TOTALS_MONTH",
    "serviceExceptionTotalsHeading",
    input.serviceExceptionTotalsHeading
  );

  // Trends is its own shape: a "<month> to <month>" range, optionally
  // corroborated by a separately-supplied trends year. A range with no
  // year is never treated as a single-month SUPPORTS candidate — it is
  // surfaced through the dedicated MULTIPERIOD_TREND_ONLY path instead.
  const trendsRaw = input.trendsHeading ?? null;
  const trendsRange = trendsRaw !== null ? parseTrendsRange(trendsRaw) : null;
  const trendsYear = input.trendsYear ?? null;
  let trendsCandidate: Candidate | null = null;
  let trendsEvidence: EvidenceItem;
  if (trendsRaw === null) {
    trendsEvidence = {
      type: "TRENDS_PERIOD_CORROBORATION",
      source: "trendsHeading",
      authority: "CORROBORATING",
      status: "MISSING",
      candidate: null,
      details: "no trends heading supplied",
    };
  } else if (trendsRange === null) {
    trendsEvidence = {
      type: "TRENDS_PERIOD_CORROBORATION",
      source: "trendsHeading",
      authority: "CORROBORATING",
      status: "INVALID",
      candidate: null,
      details: `heading "${trendsRaw}" does not contain a recognisable month range`,
    };
  } else if (trendsYear === null) {
    // A trend range without a corroborating year is not (by itself) a
    // resolvable single-month candidate — handled by the
    // MULTIPERIOD_TREND_ONLY path below rather than as a SUPPORTS entry.
    trendsEvidence = {
      type: "TRENDS_PERIOD_CORROBORATION",
      source: "trendsHeading",
      authority: "CORROBORATING",
      status: "MISSING",
      candidate: null,
      details: `heading "${trendsRaw}" spans ${trendsRange.startMonth}-${trendsRange.endMonth} with no corroborating year`,
    };
  } else {
    trendsCandidate = { month: trendsRange.endMonth, year: trendsYear };
    trendsEvidence = {
      type: "TRENDS_PERIOD_CORROBORATION",
      source: "trendsHeading+trendsYear",
      authority: "CORROBORATING",
      status: "SUPPORTS",
      candidate: candidateToEvidenceCandidate(trendsCandidate),
      details: `heading "${trendsRaw}" with trendsYear ${trendsYear} -> end month ${trendsRange.endMonth}/${trendsYear}`,
    };
  }

  // ---- Non-authoritative evidence (always IGNORED, never used) ----------
  function nonAuthEvidence(type: EvidenceType, source: string, present: boolean | undefined): EvidenceItem {
    return {
      type,
      source,
      authority: "NON_AUTHORITATIVE",
      status: "IGNORED",
      candidate: null,
      details: present
        ? `${source} present but never used to determine period`
        : `${source} not supplied; would never be used to determine period regardless`,
    };
  }
  const operationalRowsEvidence = nonAuthEvidence(
    "OPERATIONAL_ROW_DATES",
    "operationalRowDatesPresent",
    flags.operationalRowDatesPresent
  );
  const uploadTimestampEvidence = nonAuthEvidence(
    "UPLOAD_TIMESTAMP",
    "uploadTimestampPresent",
    flags.uploadTimestampPresent
  );
  const fileTimestampEvidence = nonAuthEvidence(
    "FILE_TIMESTAMP",
    "fileTimestampPresent",
    flags.fileTimestampPresent || flags.xlsxModifiedTimestampPresent
  );

  const evidence: EvidenceItem[] = [
    explicitEvidence,
    filenameEvidence,
    schemaEvidence,
    overview.evidence,
    setTotals.evidence,
    trendsEvidence,
    operationalRowsEvidence,
    uploadTimestampEvidence,
    fileTimestampEvidence,
  ];

  // Evidence statuses must reflect the FINAL interpretation, not merely
  // raw per-field parse success: whenever a branch below determines that
  // one or more SUPPORTS-status evidence items actually disagree with the
  // period the detector settled on (or with each other, when there is no
  // single anchor candidate), those items are re-stamped CONFLICTS here —
  // never silently left as SUPPORTS. MISSING/INVALID/IGNORED items are
  // never touched.
  function result(
    outcome: DetectionOutcome,
    reasonCode: DetectorReasonCode,
    period: Candidate | null,
    suggestion: Candidate | null,
    conflictingTypes: EvidenceType[] = []
  ): DetectorResult {
    const finalEvidence =
      conflictingTypes.length === 0
        ? evidence
        : evidence.map((item) =>
            conflictingTypes.includes(item.type) && item.status === "SUPPORTS"
              ? { ...item, status: "CONFLICTS" as EvidenceStatus }
              : item
          );
    return {
      outcome,
      period: period ? monthBounds(period.year as number, period.month) : null,
      suggestedPeriod: suggestion ? monthBounds(suggestion.year as number, suggestion.month) : null,
      reasonCode,
      requiresManualSelection: outcome !== "EXACT",
      evidence: finalEvidence,
    };
  }

  // ---- Rule 1: explicit metadata is AUTHORITATIVE and takes first look --
  if (explicitCandidate) {
    // Trusted workbook content/trends is only meaningful once the workbook
    // has actually matched the configured Onkaparinga schema — mirrors the
    // same schemaMatched gate Rule 3 applies below.
    const trustedContent: { type: EvidenceType; candidate: Candidate | null }[] = input.schemaMatched
      ? [
          { type: "WORKBOOK_OVERVIEW_MONTH", candidate: overview.candidate },
          { type: "SERVICE_EXCEPTION_TOTALS_MONTH", candidate: setTotals.candidate },
          { type: "TRENDS_PERIOD_CORROBORATION", candidate: trendsCandidate },
        ]
      : [];
    const conflictingContentTypes = trustedContent
      .filter((c) => c.candidate !== null && candidatesConflict(explicitCandidate, c.candidate))
      .map((c) => c.type);
    const conflictsWithFilename = filenameCandidate !== null && candidatesConflict(explicitCandidate, filenameCandidate);

    if (conflictsWithFilename || conflictingContentTypes.length > 0) {
      // No hidden precedence between AUTHORITATIVE and STRONG/CORROBORATING
      // signals — a real disagreement is always surfaced, never silently
      // resolved, and every disagreeing side is marked CONFLICTS (there is
      // no single "winning" anchor here, so no suggestion is offered).
      const conflictingTypes: EvidenceType[] = ["EXPLICIT_PERIOD_METADATA", ...conflictingContentTypes];
      if (conflictsWithFilename) conflictingTypes.push("FILENAME_PERIOD");
      return result("AMBIGUOUS", "TRUSTED_SIGNALS_CONFLICT", null, null, conflictingTypes);
    }
    return result("EXACT", "EXACT_EXPLICIT_METADATA", explicitCandidate, null);
  }

  // ---- Rule 2: filename came back malformed/ambiguous on its own -------
  if (filenameOutcome.status === "MULTIPLE") {
    return result("AMBIGUOUS", "MULTIPLE_FILENAME_CANDIDATES", null, null);
  }
  if (filenameOutcome.status === "INVALID") {
    return result("AMBIGUOUS", "INVALID_FILENAME_PERIOD", null, null);
  }

  // ---- Rule 3: filename gives a clean single candidate ------------------
  if (filenameCandidate) {
    if (!input.schemaMatched) {
      return result("AMBIGUOUS", "EXPECTED_CONTENT_SIGNAL_MISSING", null, filenameCandidate);
    }

    const contentInvalid = overview.evidence.status === "INVALID" || setTotals.evidence.status === "INVALID";
    if (contentInvalid) {
      return result("AMBIGUOUS", "EXPECTED_CONTENT_SIGNAL_MISSING", null, filenameCandidate);
    }

    const candidateEntries: { type: EvidenceType; candidate: Candidate | null }[] = [
      { type: "WORKBOOK_OVERVIEW_MONTH", candidate: overview.candidate },
      { type: "SERVICE_EXCEPTION_TOTALS_MONTH", candidate: setTotals.candidate },
      { type: "TRENDS_PERIOD_CORROBORATION", candidate: trendsCandidate },
    ];
    const supportingEntries = candidateEntries.filter(
      (c): c is { type: EvidenceType; candidate: Candidate } => c.candidate !== null
    );

    if (supportingEntries.length === 0) {
      return result("AMBIGUOUS", "FILENAME_ONLY_UNCORROBORATED", null, filenameCandidate);
    }

    const conflictingTypes = supportingEntries
      .filter((c) => candidatesConflict(filenameCandidate, c.candidate))
      .map((c) => c.type);
    if (conflictingTypes.length > 0) {
      // filenameCandidate remains the anchor/suggestion here — it is left
      // as SUPPORTS while every disagreeing corroborator is re-stamped
      // CONFLICTS.
      return result("AMBIGUOUS", "TRUSTED_SIGNALS_CONFLICT", null, filenameCandidate, conflictingTypes);
    }

    return result("EXACT", "EXACT_CORROBORATED", filenameCandidate, null);
  }

  // ---- Rule 4: no filename/explicit candidate — content-only signals ---
  const contentCandidates = [overview.candidate, setTotals.candidate].filter((c): c is Candidate => c !== null);
  if (contentCandidates.length >= 2) {
    const conflicting = candidatesConflict(contentCandidates[0], contentCandidates[1]);
    if (conflicting) {
      // Neither content signal is an anchor here — both sides of the
      // disagreement are re-stamped CONFLICTS.
      return result("AMBIGUOUS", "TRUSTED_SIGNALS_CONFLICT", null, null, [
        "WORKBOOK_OVERVIEW_MONTH",
        "SERVICE_EXCEPTION_TOTALS_MONTH",
      ]);
    }
  }
  if (contentCandidates.length > 0) {
    // Content-only + trends-year corroboration: when the workbook has
    // actually matched the configured schema, every trusted content
    // heading agrees on a single month (guaranteed by the conflict check
    // above), and a trusted trends end-month+year is present, that trends
    // candidate either corroborates the content month into a complete
    // EXACT period or — if it disagrees — is a genuine trusted-signal
    // conflict. Never a silent "best guess".
    if (input.schemaMatched && trendsCandidate !== null) {
      const contentMonth = contentCandidates[0].month;
      const contentTrustedTypes = (
        [
          { type: "WORKBOOK_OVERVIEW_MONTH" as EvidenceType, candidate: overview.candidate },
          { type: "SERVICE_EXCEPTION_TOTALS_MONTH" as EvidenceType, candidate: setTotals.candidate },
        ] as { type: EvidenceType; candidate: Candidate | null }[]
      )
        .filter((c) => c.candidate !== null)
        .map((c) => c.type);

      if (trendsCandidate.month === contentMonth) {
        return result("EXACT", "EXACT_CORROBORATED", { month: contentMonth, year: trendsCandidate.year }, null);
      }
      return result("AMBIGUOUS", "TRUSTED_SIGNALS_CONFLICT", null, null, [
        ...contentTrustedTypes,
        "TRENDS_PERIOD_CORROBORATION",
      ]);
    }
    // A content-only month, with no filename/explicit signal and no
    // trusted year anywhere, can never be a complete period.
    return result("AMBIGUOUS", "MONTH_WITHOUT_YEAR", null, null);
  }

  if (trendsRaw !== null && trendsRange !== null && trendsYear === null) {
    return result("AMBIGUOUS", "MULTIPERIOD_TREND_ONLY", null, null);
  }

  // ---- Rule 5: genuinely nothing trusted ---------------------------------
  if (filenameOutcome.status === "UNRELATED" && !input.schemaMatched) {
    return result("ABSENT", "UNRECOGNISED_SOURCE_SCHEMA", null, null);
  }
  return result("ABSENT", "NO_TRUSTED_PERIOD_SIGNAL", null, null);
}

// ─── Manual selection (small pure helper — NOT a DB service) ────────────

export type ManualSelectionReasonCode =
  | "MANUAL_SELECTION_VALID"
  | "MANUAL_SELECTION_INVALID_RANGE"
  | "MANUAL_SELECTION_MISSING_START"
  | "MANUAL_SELECTION_MISSING_END";

export function validateManualSelection(
  start: unknown,
  end: unknown
): { valid: true; start: string; end: string; reasonCode: "MANUAL_SELECTION_VALID" } | { valid: false; reasonCode: ManualSelectionReasonCode } {
  if (start === null || start === undefined || start === "") {
    return { valid: false, reasonCode: "MANUAL_SELECTION_MISSING_START" };
  }
  if (end === null || end === undefined || end === "") {
    return { valid: false, reasonCode: "MANUAL_SELECTION_MISSING_END" };
  }
  if (typeof start !== "string" || typeof end !== "string") {
    return { valid: false, reasonCode: "MANUAL_SELECTION_INVALID_RANGE" };
  }
  const range = validateCandidateRange(start, end);
  if (!range.valid) {
    return { valid: false, reasonCode: "MANUAL_SELECTION_INVALID_RANGE" };
  }
  return { valid: true, start, end, reasonCode: "MANUAL_SELECTION_VALID" };
}

// ─── Confirmation eligibility gate (pure calculation only) ──────────────

export type GateReasonCode =
  | "PERIOD_OPTIONAL"
  | "PERIOD_PRESENT"
  | "PERIOD_REQUIRED_NOT_PERSISTED"
  | "PERIOD_REQUIRED_AMBIGUOUS"
  | "PERIOD_REQUIRED_ABSENT"
  | "PERIOD_INVALID";

export interface PersistedPeriod {
  start: string;
  end: string;
}

export interface ConfirmationEligibilityInput {
  reportingPeriodRequired: boolean;
  persistedPeriod: PersistedPeriod | null;
  detectorResult: DetectorResult | null;
}

export interface ConfirmationEligibilityResult {
  allowed: boolean;
  reasonCode: GateReasonCode;
}

function hasCompleteValidPersistedPeriod(persistedPeriod: PersistedPeriod | null): boolean {
  if (persistedPeriod === null) return false;
  return validateCandidateRange(persistedPeriod.start, persistedPeriod.end).valid;
}

// Pure calculation only — never reads/writes any persistence layer. The
// caller is solely responsible for sourcing `persistedPeriod` from
// whatever store it trusts; this function never mutates it and never
// backfills a null persisted period from `detectorResult`.
export function evaluateConfirmationEligibility(
  input: ConfirmationEligibilityInput
): ConfirmationEligibilityResult {
  const persistedComplete = hasCompleteValidPersistedPeriod(input.persistedPeriod);

  if (input.persistedPeriod !== null && !persistedComplete) {
    return { allowed: false, reasonCode: "PERIOD_INVALID" };
  }

  if (!input.reportingPeriodRequired) {
    return { allowed: true, reasonCode: persistedComplete ? "PERIOD_PRESENT" : "PERIOD_OPTIONAL" };
  }

  if (persistedComplete) {
    return { allowed: true, reasonCode: "PERIOD_PRESENT" };
  }

  const outcome = input.detectorResult?.outcome ?? "ABSENT";
  if (outcome === "EXACT") {
    return { allowed: false, reasonCode: "PERIOD_REQUIRED_NOT_PERSISTED" };
  }
  if (outcome === "AMBIGUOUS") {
    return { allowed: false, reasonCode: "PERIOD_REQUIRED_AMBIGUOUS" };
  }
  return { allowed: false, reasonCode: "PERIOD_REQUIRED_ABSENT" };
}
