import type { VerifyServiceInput } from './types';

/**
 * Demo GPS scenarios using real inner-eastern Adelaide suburb coordinates.
 * Property addresses correspond to the WSTe property intelligence pages.
 *
 * Coordinate maths (verified):
 *   1° lat ≈ 111,320m   |   1° lng ≈ 91,220m at lat −34.9
 *
 * Scenarios:
 *   1. 8-ayers-ave    → verified          (RFID + GPS stop + dwell 42s)
 *   2. 28-fifth-ave   → likely_completed  (GPS pass within 25m, speed > 8 km/h, no RFID)
 *   3. 14-edmund-ave  → likely_missed     (nearest GPS 77.7m, transit speed 33–34 km/h)
 *   4. 3-victoria-rd  → exception_recorded (stop + dwell 22s + bin_not_out)
 *   5. 56-church-tce  → no_coverage       (nearest GPS 167m, 11-min 56s gap)
 */

export const DEMO_SCENARIOS: Record<string, VerifyServiceInput> = {

  // ── Scenario 1: Verified ──────────────────────────────────────────────────
  // Vehicle S456DEF stops for 42s at Ayers Ave, Payneham. RFID bin scan at 08:43:55.
  // All 4 slow-pass points within 25m, speed 3–7 km/h.
  '8-ayers-ave': {
    organisationId: 'demo-org',
    propertyId: '8-ayers-ave',
    propertyLat: -34.9060,
    propertyLng: 138.6440,
    serviceType: 'bin_collection',
    serviceDate: '2025-04-28',
    runId: 'payneham-south-gw',
    vehicleId: 'S456DEF',
    gpsPoints: [
      // Approach — accelerating down Ayers Ave
      { lat: -34.9040, lng: 138.6440, timestamp: '2025-04-28T08:42:05+09:30', speed_kmh: 32 },
      { lat: -34.9050, lng: 138.6440, timestamp: '2025-04-28T08:42:30+09:30', speed_kmh: 28 },
      { lat: -34.9055, lng: 138.6440, timestamp: '2025-04-28T08:43:10+09:30', speed_kmh: 20 },
      { lat: -34.9057, lng: 138.6440, timestamp: '2025-04-28T08:43:25+09:30', speed_kmh: 15 },
      // Slow pass / dwell — all within 25m of property (−34.9060, 138.6440)
      // −34.905901 → 11m;  −34.905973 → 3m;  −34.906099 → 11m;  −34.906216 → 24m
      { lat: -34.905901, lng: 138.6440, timestamp: '2025-04-28T08:43:38+09:30', speed_kmh: 6 },
      { lat: -34.905973, lng: 138.6440, timestamp: '2025-04-28T08:43:48+09:30', speed_kmh: 3 },
      { lat: -34.906099, lng: 138.6440, timestamp: '2025-04-28T08:44:05+09:30', speed_kmh: 4 },
      { lat: -34.906216, lng: 138.6440, timestamp: '2025-04-28T08:44:20+09:30', speed_kmh: 7 },
      // Departure
      { lat: -34.9065, lng: 138.6440, timestamp: '2025-04-28T08:44:40+09:30', speed_kmh: 18 },
      { lat: -34.9070, lng: 138.6440, timestamp: '2025-04-28T08:45:00+09:30', speed_kmh: 25 },
    ],
    evidenceItems: [
      { type: 'rfid', timestamp: '2025-04-28T08:43:55+09:30', asset_id: 'BIN-1148-GW', description: 'Bin tag BIN-1148-GW scanned during collection' },
    ],
    exceptions: [],
  },

  // ── Scenario 2: Likely Completed ─────────────────────────────────────────
  // Vehicle passes within 22m at 11–12 km/h — route pass confirmed by GPS.
  // No RFID scan recorded. Speed above 8 km/h so no stop/dwell detected.
  '28-fifth-ave': {
    organisationId: 'demo-org',
    propertyId: '28-fifth-ave',
    propertyLat: -34.9048,
    propertyLng: 138.6455,
    serviceType: 'bin_collection',
    serviceDate: '2025-04-29',
    runId: 'payneham-south-gw',
    vehicleId: 'S456DEF',
    gpsPoints: [
      // Approach
      { lat: -34.9035, lng: 138.6455, timestamp: '2025-04-29T08:49:52+09:30', speed_kmh: 34 },
      { lat: -34.9040, lng: 138.6455, timestamp: '2025-04-29T08:50:05+09:30', speed_kmh: 28 },
      { lat: -34.9044, lng: 138.6455, timestamp: '2025-04-29T08:50:16+09:30', speed_kmh: 22 },
      // Pass — within 25m but speed > 8 km/h (11–12 km/h)
      // −34.904602 → 22m;  −34.904899 → 11m
      { lat: -34.904602, lng: 138.6455, timestamp: '2025-04-29T08:50:24+09:30', speed_kmh: 11 },
      { lat: -34.904899, lng: 138.6455, timestamp: '2025-04-29T08:50:31+09:30', speed_kmh: 12 },
      // Departure
      { lat: -34.9052, lng: 138.6455, timestamp: '2025-04-29T08:50:40+09:30', speed_kmh: 18 },
      { lat: -34.9058, lng: 138.6455, timestamp: '2025-04-29T08:50:52+09:30', speed_kmh: 30 },
    ],
    evidenceItems: [],
    exceptions: [],
  },

  // ── Scenario 3: Likely Missed ─────────────────────────────────────────────
  // Vehicle routes along Portrush Rd (parallel street), nearest GPS 77.7m north.
  // Transit speed 33–34 km/h. No GPS points within 50m of Edmund Ave.
  // 3 bypass points within 100m (at 77.7m, 90m, 90m) to avoid single-point penalty.
  '14-edmund-ave': {
    organisationId: 'demo-org',
    propertyId: '14-edmund-ave',
    propertyLat: -34.9175,
    propertyLng: 138.6450,
    serviceType: 'bin_collection',
    serviceDate: '2025-04-28',
    runId: 'trinity-east-gw',
    vehicleId: 'S789GHI',
    gpsPoints: [
      // Vehicle on Portrush Rd (lat −34.9168, ~77.7m north of property lat −34.9175)
      { lat: -34.9168, lng: 138.6410, timestamp: '2025-04-28T08:31:55+09:30', speed_kmh: 33 },
      { lat: -34.9168, lng: 138.6430, timestamp: '2025-04-28T08:32:10+09:30', speed_kmh: 34 },
      // Three closest points (within 100m of property)
      // lng 138.6445 → dlng=0.0005 → 0.0005×91220≈46m, dlat=77.7m → dist≈90m
      { lat: -34.9168, lng: 138.6445, timestamp: '2025-04-28T08:32:22+09:30', speed_kmh: 34 },
      // lng 138.6450 → dlng=0 → dist=77.7m (nearest)
      { lat: -34.9168, lng: 138.6450, timestamp: '2025-04-28T08:32:28+09:30', speed_kmh: 33 },
      // lng 138.6455 → dlng=0.0005 → dist≈90m
      { lat: -34.9168, lng: 138.6455, timestamp: '2025-04-28T08:32:34+09:30', speed_kmh: 34 },
      { lat: -34.9168, lng: 138.6470, timestamp: '2025-04-28T08:32:46+09:30', speed_kmh: 34 },
      { lat: -34.9168, lng: 138.6490, timestamp: '2025-04-28T08:32:58+09:30', speed_kmh: 33 },
    ],
    evidenceItems: [],
    exceptions: [],
  },

  // ── Scenario 4: Exception Recorded ───────────────────────────────────────
  // Vehicle S654MNO stops at 3 Victoria Rd for 22s. Bin was not out.
  // GPS confirms attendance; exception recorded by driver.
  '3-victoria-rd': {
    organisationId: 'demo-org',
    propertyId: '3-victoria-rd',
    propertyLat: -34.8982,
    propertyLng: 138.6522,
    serviceType: 'bin_collection',
    serviceDate: '2025-04-26',
    runId: 'glynde-central-gw',
    vehicleId: 'S654MNO',
    gpsPoints: [
      // Approach
      { lat: -34.8972, lng: 138.6522, timestamp: '2025-04-26T09:17:20+09:30', speed_kmh: 22 },
      { lat: -34.8976, lng: 138.6522, timestamp: '2025-04-26T09:17:40+09:30', speed_kmh: 15 },
      { lat: -34.8979, lng: 138.6522, timestamp: '2025-04-26T09:17:58+09:30', speed_kmh: 10 },
      // Stop — all within 25m of property (−34.8982, 138.6522), speed ≤ 8 km/h
      // −34.898101 → 11m;  −34.898200 → 0m;  −34.898299 → 11m
      { lat: -34.898101, lng: 138.6522, timestamp: '2025-04-26T09:18:14+09:30', speed_kmh: 8 },
      { lat: -34.898200, lng: 138.6522, timestamp: '2025-04-26T09:18:22+09:30', speed_kmh: 7 },
      { lat: -34.898299, lng: 138.6522, timestamp: '2025-04-26T09:18:36+09:30', speed_kmh: 8 },
      // Departure
      { lat: -34.8985, lng: 138.6522, timestamp: '2025-04-26T09:18:52+09:30', speed_kmh: 12 },
      { lat: -34.8990, lng: 138.6522, timestamp: '2025-04-26T09:19:10+09:30', speed_kmh: 22 },
    ],
    evidenceItems: [
      { type: 'driver_note', timestamp: '2025-04-26T09:18:40+09:30', description: 'Bin not at kerbside. Attended property, unable to service.' },
    ],
    exceptions: [
      { type: 'bin_not_out', description: 'Bin not presented at kerb for collection', recorded_at: '2025-04-26T09:18:40+09:30', vehicle_reg: 'S654MNO' },
    ],
  },

  // ── Scenario 5: No Coverage ───────────────────────────────────────────────
  // 11-minute 56-second GPS gap (08:40:12–08:52:08). Nearest GPS point 167m away.
  // No data available to confirm or deny service at Church Tce.
  '56-church-tce': {
    organisationId: 'demo-org',
    propertyId: '56-church-tce',
    propertyLat: -34.9165,
    propertyLng: 138.6430,
    serviceType: 'bin_collection',
    serviceDate: '2025-04-28',
    runId: 'trinity-east-gw',
    vehicleId: 'S789GHI',
    gpsPoints: [
      // Pre-gap — vehicle heading south, still north of property
      { lat: -34.9110, lng: 138.6430, timestamp: '2025-04-28T08:37:45+09:30', speed_kmh: 28 },
      { lat: -34.9125, lng: 138.6430, timestamp: '2025-04-28T08:38:40+09:30', speed_kmh: 30 },
      { lat: -34.9135, lng: 138.6430, timestamp: '2025-04-28T08:39:20+09:30', speed_kmh: 29 },
      // Last GPS before gap — 167m north of property (−34.9150 vs −34.9165: 0.0015×111320≈167m)
      { lat: -34.9150, lng: 138.6430, timestamp: '2025-04-28T08:40:12+09:30', speed_kmh: 25 },
      // ── GPS GAP: 08:40:12 → 08:52:08 (716 seconds = 11min 56s) ──
      // First GPS after gap — 222m south of property (−34.9185 vs −34.9165: 0.0020×111320≈222m)
      { lat: -34.9185, lng: 138.6430, timestamp: '2025-04-28T08:52:08+09:30', speed_kmh: 26 },
      { lat: -34.9200, lng: 138.6430, timestamp: '2025-04-28T08:52:55+09:30', speed_kmh: 30 },
      { lat: -34.9215, lng: 138.6430, timestamp: '2025-04-28T08:53:40+09:30', speed_kmh: 31 },
    ],
    evidenceItems: [],
    exceptions: [],
  },
};

export function getDemoScenario(propertySlug: string): VerifyServiceInput | null {
  const slug = propertySlug.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  for (const [key, scenario] of Object.entries(DEMO_SCENARIOS)) {
    if (slug.includes(key)) return scenario;
  }
  return null;
}
