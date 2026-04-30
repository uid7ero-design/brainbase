import { haversineMeters, filterByRadius, nearestPoint } from './geo';
import type {
  VerifyServiceInput,
  VerificationResult,
  VerificationStatus,
  ConfidenceLabel,
  GpsPoint,
  EvidenceItem,
  ServiceWindow,
  ServiceException,
} from './types';

// ─── Thresholds ───────────────────────────────────────────────────────────────

const PRIMARY_M    = 25;   // definitive pass zone
const SECONDARY_M  = 50;   // likely-pass zone (2+ points required for pass)
const STREET_M     = 100;  // street-level proximity
const STOP_KMH     = 8;    // max speed to count as stopped/slow
const DWELL_SEC    = 10;   // min dwell duration to confirm stop
const GAP_SEC      = 300;  // GPS gap threshold (5 min)

const DEFAULT_WINDOW: ServiceWindow = {
  start_hhmm: '05:00',
  end_hhmm: '18:00',
  tz_offset: '+09:30',   // ACST
};

// ─── Time helpers ─────────────────────────────────────────────────────────────

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function isoToLocalMinutes(iso: string, tzOffset: string): number {
  const date = new Date(iso);
  const match = tzOffset.match(/([+-])(\d{2}):(\d{2})/);
  if (!match) return date.getUTCHours() * 60 + date.getUTCMinutes();
  const sign = match[1] === '+' ? 1 : -1;
  const offsetMin = sign * (parseInt(match[2]) * 60 + parseInt(match[3]));
  const local = new Date(date.getTime() + offsetMin * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function isoToLocalTime(iso: string, tzOffset: string): string {
  const date = new Date(iso);
  const match = tzOffset.match(/([+-])(\d{2}):(\d{2})/);
  if (!match) return iso;
  const sign = match[1] === '+' ? 1 : -1;
  const offsetMin = sign * (parseInt(match[2]) * 60 + parseInt(match[3]));
  const local = new Date(date.getTime() + offsetMin * 60_000);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  const ss = String(local.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ─── Detection functions ──────────────────────────────────────────────────────

function detectPass(
  pts: GpsPoint[],
  lat: number,
  lng: number,
): { detected: boolean; nearestM: number | null; passTimeIso: string | null; countNear50: number } {
  if (pts.length === 0) return { detected: false, nearestM: null, passTimeIso: null, countNear50: 0 };

  const near50 = filterByRadius(pts, lat, lng, SECONDARY_M);
  const nr = nearestPoint(pts, lat, lng);

  const sortedNear = [...near50].sort(
    (a, b) => haversineMeters(a.lat, a.lng, lat, lng) - haversineMeters(b.lat, b.lng, lat, lng),
  );

  return {
    detected: near50.length >= 2,
    nearestM: nr?.distanceM ?? null,
    passTimeIso: sortedNear[0]?.timestamp ?? null,
    countNear50: near50.length,
  };
}

function detectStop(
  pts: GpsPoint[],
  lat: number,
  lng: number,
): { detected: boolean; durationSec: number | null } {
  const primary = filterByRadius(pts, lat, lng, PRIMARY_M).filter(
    (p) => (p.speed_kmh ?? 0) <= STOP_KMH,
  );

  if (primary.length < 2) return { detected: false, durationSec: null };

  const sorted = [...primary].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const durationSec =
    (new Date(sorted[sorted.length - 1].timestamp).getTime() -
      new Date(sorted[0].timestamp).getTime()) /
    1000;

  return {
    detected: durationSec >= DWELL_SEC,
    durationSec: durationSec >= DWELL_SEC ? Math.round(durationSec) : null,
  };
}

function detectLift(evidence: EvidenceItem[]): boolean {
  return evidence.some((e) => e.type === 'rfid' || e.type === 'lift_sensor');
}

function detectException(exceptions: ServiceException[]): boolean {
  return exceptions.length > 0;
}

function detectGpsGap(pts: GpsPoint[]): number | null {
  if (pts.length < 2) return null;
  const sorted = [...pts].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      (new Date(sorted[i].timestamp).getTime() -
        new Date(sorted[i - 1].timestamp).getTime()) /
      1000;
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap > GAP_SEC ? Math.round(maxGap) : null;
}

function isInWindow(
  pts: GpsPoint[],
  serviceDate: string,
  window: ServiceWindow,
): boolean | null {
  if (pts.length === 0) return null;
  for (const p of pts) {
    if (!p.timestamp.startsWith(serviceDate)) continue;
    const localMin = isoToLocalMinutes(p.timestamp, window.tz_offset);
    if (
      localMin >= hmToMinutes(window.start_hhmm) &&
      localMin <= hmToMinutes(window.end_hhmm)
    )
      return true;
  }
  return false;
}

function hasSlowPass(pts: GpsPoint[], lat: number, lng: number): boolean {
  return filterByRadius(pts, lat, lng, SECONDARY_M).some(
    (p) => (p.speed_kmh ?? 999) <= STOP_KMH,
  );
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

function calcConfidence(p: {
  liftDetected: boolean;
  nearestM: number | null;
  vehicleId: string | undefined;
  stopDetected: boolean;
  slowPass: boolean;
  hasPhoto: boolean;
  inWindow: boolean | null;
  gpsGapSec: number | null;
  singlePointNear: boolean;
}): number {
  let score = 0;

  if (p.liftDetected) score += 40;

  if (p.nearestM !== null) {
    if (p.nearestM <= PRIMARY_M)   score += 30;
    else if (p.nearestM <= SECONDARY_M) score += 20;
    else if (p.nearestM <= STREET_M)    score += 10;
  }

  if (p.vehicleId) score += 20;
  if (p.stopDetected) score += 15;
  if (p.slowPass && !p.stopDetected) score += 10;
  if (p.hasPhoto) score += 10;
  if (p.inWindow) score += 5;

  if (p.gpsGapSec !== null) score -= 25;
  if (p.singlePointNear) score -= 15;
  if (p.nearestM !== null && p.nearestM >= 75 && p.nearestM <= STREET_M) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

// ─── Status determination ─────────────────────────────────────────────────────

function determineStatus(p: {
  passDetected: boolean;
  stopDetected: boolean;
  liftDetected: boolean;
  exceptionDetected: boolean;
  nearestM: number | null;
  gpsGapSec: number | null;
  hasAnyGps: boolean;
}): VerificationStatus {
  const { passDetected, stopDetected, liftDetected, exceptionDetected, nearestM, gpsGapSec, hasAnyGps } = p;

  // No useful GPS: either nothing at all or nearest point is beyond street-level
  if (!hasAnyGps || (nearestM !== null && nearestM > STREET_M)) {
    return 'no_coverage';
  }

  // Exception: vehicle attended and recorded a problem — takes priority over verified
  if (exceptionDetected && (stopDetected || liftDetected || passDetected)) {
    return 'exception_recorded';
  }

  // Verified: physical evidence (lift/RFID/stop-dwell) with GPS confirmation
  if ((liftDetected || stopDetected) && nearestM !== null && nearestM <= PRIMARY_M) {
    return 'verified';
  }

  // Likely completed: GPS pass through service zone, no physical evidence recorded
  if (passDetected && !liftDetected && !stopDetected) {
    return 'likely_completed';
  }

  // Likely missed: GPS exists near street but vehicle clearly bypassed
  if (nearestM !== null && nearestM <= STREET_M) {
    return 'likely_missed';
  }

  // GPS gap: data interruption prevents definitive verification
  if (gpsGapSec !== null) {
    return 'no_evidence';
  }

  return 'no_evidence';
}

// ─── Evidence summary ─────────────────────────────────────────────────────────

function buildSummary(
  status: VerificationStatus,
  p: {
    vehicleId: string | undefined;
    nearestM: number | null;
    passTimeIso: string | null;
    stopDurationSec: number | null;
    liftDetected: boolean;
    matchedEvidence: EvidenceItem[];
    gpsGapSec: number | null;
    exceptions: ServiceException[];
    tz: string;
  },
): string {
  const vehicle = p.vehicleId ? `Vehicle ${p.vehicleId}` : 'Vehicle';
  const dist = p.nearestM != null ? `${Math.round(p.nearestM)}m` : 'unknown distance';
  const time = p.passTimeIso ? ` at ${isoToLocalTime(p.passTimeIso, p.tz)}` : '';

  const rfid = p.matchedEvidence.find((e) => e.type === 'rfid');

  switch (status) {
    case 'verified': {
      const parts: string[] = [];
      if (rfid) parts.push(`${rfid.asset_id ?? 'Bin'} scanned${rfid.timestamp ? ` at ${isoToLocalTime(rfid.timestamp, p.tz)}` : ''}`);
      if (p.stopDurationSec) parts.push(`${vehicle} stopped for ${p.stopDurationSec}s at ${dist} from frontage`);
      else if (p.nearestM != null) parts.push(`${vehicle} passed ${dist} from frontage${time}`);
      return parts.join('. ') + '. Service confirmed.';
    }
    case 'likely_completed':
      return `${vehicle} passed within ${dist} of property${time} — GPS confirms route pass. No bin scan recorded.`;
    case 'likely_missed':
      return `Nearest GPS ${dist} from frontage${time} at transit speed — vehicle did not enter the street. Route bypass recorded.`;
    case 'exception_recorded': {
      const exc = p.exceptions[0];
      const excLabel = exc?.type === 'bin_not_out' ? 'bin not out'
        : exc?.type === 'access_blocked' ? 'access blocked'
        : exc?.type === 'contamination' ? 'contamination'
        : exc?.type ?? 'exception';
      const dwell = p.stopDurationSec ? `stopped for ${p.stopDurationSec}s at ${dist}.` : `attended property${time}.`;
      return `${vehicle} ${dwell} Exception recorded: ${excLabel}. Service not completed.`;
    }
    case 'no_coverage':
      if (p.gpsGapSec) {
        const mins = Math.floor(p.gpsGapSec / 60);
        const secs = p.gpsGapSec % 60;
        return `${mins}min ${secs}s GPS gap during expected service window — vehicle position unknown. No evidence confirming or denying service.`;
      }
      return 'No GPS data recorded near this property on the service date. Vehicle location unavailable.';
    case 'no_evidence':
      return 'GPS data exists for the service period but no points recorded within 100m. Verification inconclusive.';
    case 'not_applicable':
      return 'Service not scheduled for this property on this date.';
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function verifyService(input: VerifyServiceInput): VerificationResult {
  const pts = input.gpsPoints ?? [];
  const evidence = input.evidenceItems ?? [];
  const exceptions = input.exceptions ?? [];
  const window = input.serviceWindow ?? DEFAULT_WINDOW;
  const { propertyLat: lat, propertyLng: lng, serviceDate, vehicleId } = input;

  // ── GPS analysis
  const pass = detectPass(pts, lat, lng);
  const stop = detectStop(pts, lat, lng);
  const liftDetected = detectLift(evidence);
  const exceptionDetected = detectException(exceptions);
  const gpsGapSec = detectGpsGap(pts);
  const inWindow = isInWindow(pts, serviceDate, window);
  const slow = hasSlowPass(pts, lat, lng);

  const near100 = filterByRadius(pts, lat, lng, STREET_M);
  const singlePointNear = near100.length === 1;
  const hasAnyGps = pts.length > 0;

  // ── Matched evidence (items that contribute to the result)
  const matchedEvidence: EvidenceItem[] = evidence.filter(
    (e) => e.type === 'rfid' || e.type === 'lift_sensor' || e.type === 'photo',
  );

  // ── Status
  const status = determineStatus({
    passDetected: pass.detected,
    stopDetected: stop.detected,
    liftDetected,
    exceptionDetected,
    nearestM: pass.nearestM,
    gpsGapSec,
    hasAnyGps,
  });

  // ── Confidence
  const hasPhoto = evidence.some((e) => e.type === 'photo');
  const confidence = calcConfidence({
    liftDetected,
    nearestM: pass.nearestM,
    vehicleId,
    stopDetected: stop.detected,
    slowPass: slow,
    hasPhoto,
    inWindow,
    gpsGapSec,
    singlePointNear,
  });

  // ── Summary
  const evidenceSummary = buildSummary(status, {
    vehicleId,
    nearestM: pass.nearestM,
    passTimeIso: pass.passTimeIso,
    stopDurationSec: stop.durationSec,
    liftDetected,
    matchedEvidence,
    gpsGapSec,
    exceptions,
    tz: window.tz_offset,
  });

  return {
    status,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    passDetected: pass.detected,
    stopDetected: stop.detected,
    liftDetected,
    exceptionDetected,
    nearestGpsM: pass.nearestM !== null ? Math.round(pass.nearestM) : null,
    passTimeIso: pass.passTimeIso,
    stopDurationSec: stop.durationSec,
    vehicleMatch: vehicleId != null,
    inServiceWindow: inWindow,
    gpsGapSec,
    evidenceSummary,
    matchedEvidence,
  };
}
