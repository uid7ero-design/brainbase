export type ServiceType =
  | 'bin_collection' | 'hard_waste' | 'street_sweeping'
  | 'bin_maintenance' | 'fogo' | 'recycling' | 'mattress_collection'
  | 'illegal_dumping' | 'special_service';

export type EvidenceType =
  | 'gps' | 'rfid' | 'lift_sensor' | 'photo' | 'video'
  | 'driver_note' | 'ticket' | 'weighbridge' | 'manual';

export type VerificationStatus =
  | 'verified'
  | 'likely_completed'
  | 'likely_missed'
  | 'no_evidence'
  | 'exception_recorded'
  | 'no_coverage'
  | 'not_applicable';

export type ConfidenceLabel = 'high' | 'medium' | 'low';

export type GpsPoint = {
  lat: number;
  lng: number;
  timestamp: string;       // ISO-8601 with tz offset, e.g. '2025-04-28T08:43:38+09:30'
  speed_kmh?: number;
  heading?: number;
  accuracy_m?: number;
};

export type EvidenceItem = {
  type: EvidenceType;
  timestamp?: string;
  description?: string;
  value?: string;
  asset_id?: string;       // RFID tag / bin ID
};

export type ServiceException = {
  type: 'bin_not_out' | 'contamination' | 'access_blocked' | 'damaged_bin'
      | 'no_access' | 'overloaded' | 'wrong_day' | 'other';
  description?: string;
  recorded_at?: string;
  vehicle_reg?: string;
};

export type ServiceWindow = {
  start_hhmm: string;      // '05:00'
  end_hhmm: string;        // '18:00'
  tz_offset: string;       // '+09:30' for ACST
};

export type VerifyServiceInput = {
  organisationId: string;
  propertyId: string;
  propertyLat: number;
  propertyLng: number;
  serviceType: ServiceType;
  serviceDate: string;             // 'YYYY-MM-DD'
  runId?: string;
  vehicleId?: string;
  serviceWindow?: ServiceWindow;
  gpsPoints?: GpsPoint[];
  evidenceItems?: EvidenceItem[];
  exceptions?: ServiceException[];
};

export type VerificationResult = {
  status: VerificationStatus;
  confidence: number;              // 0–100
  confidenceLabel: ConfidenceLabel;
  passDetected: boolean;
  stopDetected: boolean;
  liftDetected: boolean;
  exceptionDetected: boolean;
  nearestGpsM: number | null;
  passTimeIso: string | null;
  stopDurationSec: number | null;
  vehicleMatch: boolean | null;
  inServiceWindow: boolean | null;
  gpsGapSec: number | null;
  evidenceSummary: string;
  matchedEvidence: EvidenceItem[];
};
