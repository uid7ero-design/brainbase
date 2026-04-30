import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import PropertyClient from './PropertyClient';
import type { ServiceEvent } from '../../components/ServiceTimeline';
import { verifyService } from '@/lib/wste/verifyService';
import { getDemoScenario } from '@/lib/wste/demoScenarios';
import type { VerificationResult } from '@/lib/wste/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerificationStatus =
  | 'verified' | 'likely_completed' | 'likely_missed'
  | 'no_evidence' | 'exception_recorded' | 'no_coverage' | 'not_applicable';
export type VerificationScenario = 'route_pass' | 'route_bypass' | 'gps_gap' | 'no_data';

export type BinAsset = {
  rfid?: string;
  type: string;
  volume: string;
  colour: string;
  status: 'active' | 'damaged' | 'missing';
};

export type PlannedService = {
  service_type: string;
  schedule: string;
  run: string;
  window: string;
  next_date: string;
};

export type PropertyData = {
  address: string;
  suburb: string;
  zone: string;
  account_ref: string;
  lat: number;
  lng: number;
  assets: BinAsset[];
  planned_services: PlannedService[];

  verification: {
    status: VerificationStatus;
    scenario: VerificationScenario;
    vehicle_reg: string | null;
    driver: string | null;
    run_name: string | null;
    pass_time: string | null;
    distance_m: number | null;
    speed_kmh: number | null;
    confidence: number;
    linked_exception: string | null;
    gps_points_nearby: number;
  };

  service_events: ServiceEvent[];

  intelligence_summary: string;
  intelligence_action: string | null;
  intelligence_level: 'good' | 'warning' | 'alert';
};

// ─── Mock property database ───────────────────────────────────────────────────

const PROPERTIES: Record<string, PropertyData> = {

  '14-edmund-ave': {
    address: '14 Edmund Ave', suburb: 'Trinity Gardens',
    zone: 'Zone B — North Trinity', account_ref: 'TG-004821',
    lat: -34.9175, lng: 138.6450,
    assets: [
      { rfid: 'BIN-4821-GW',  type: 'General Waste', volume: '140L', colour: 'Red lid',    status: 'active' },
      { rfid: 'BIN-4821-REC', type: 'Recycling',     volume: '240L', colour: 'Yellow lid', status: 'active' },
    ],
    planned_services: [
      { service_type: 'General Waste', schedule: 'Weekly · Tuesday', run: 'Trinity East — General Waste',   window: '06:00–12:00', next_date: 'Tue 6 May 2025'  },
      { service_type: 'Recycling',     schedule: 'Fortnightly · Tue', run: 'Trinity East — General Waste',  window: '06:00–12:00', next_date: 'Tue 13 May 2025' },
    ],
    verification: {
      status: 'likely_missed', scenario: 'route_bypass',
      vehicle_reg: 'S789GHI', driver: 'R. Carter', run_name: 'Trinity East — General Waste',
      pass_time: null, distance_m: 83, speed_kmh: 34,
      confidence: 28, linked_exception: 'Missed Service',
      gps_points_nearby: 1,
    },
    service_events: [
      {
        id: 'ev-001', date: '2025-04-28', time: '08:43',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'likely_missed',
        vehicle_reg: 'S789GHI', driver: 'R. Carter', run_name: 'Trinity East — General Waste',
        confidence: 28,
        evidence: [
          { type: 'gps', description: 'Nearest GPS point 83m from frontage — vehicle at transit speed (34 km/h)' },
        ],
        details: [
          { label: 'Scheduled window', value: '06:00–12:00' },
          { label: 'GPS distance',     value: '83m from frontage' },
          { label: 'Vehicle speed',    value: '34 km/h (transit)' },
          { label: 'Bin RFID',         value: 'No scan recorded' },
        ],
        notes: 'Vehicle routed via Portrush Rd — GPS confirms it did not enter Edmund Ave on this run.',
      },
      {
        id: 'ev-002', date: '2025-04-22', time: '07:52',
        service_type: 'bin_collection', service_name: 'Recycling Collection',
        verification_status: 'verified',
        vehicle_reg: 'S789GHI', driver: 'R. Carter', run_name: 'Trinity East — General Waste',
        confidence: 91,
        evidence: [
          { type: 'gps',  description: 'GPS pass confirmed: 7m from frontage at 11 km/h' },
          { type: 'rfid', description: 'Bin tag scanned: BIN-4821-REC' },
        ],
        details: [
          { label: 'Pass time',  value: '07:52:18' },
          { label: 'Distance',   value: '7m from frontage' },
          { label: 'Speed',      value: '11 km/h (collection speed)' },
          { label: 'Bin RFID',   value: 'BIN-4821-REC · Scanned' },
        ],
      },
      {
        id: 'ev-003', date: '2025-04-15', time: '08:11',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S789GHI', driver: 'R. Carter', run_name: 'Trinity East — General Waste',
        confidence: 89,
        evidence: [
          { type: 'gps',          description: 'GPS pass: 9m from frontage at 10 km/h' },
          { type: 'lift_sensor',  description: 'Lift event detected at 08:11:34' },
        ],
        details: [
          { label: 'Pass time',     value: '08:11:34' },
          { label: 'Distance',      value: '9m from frontage' },
          { label: 'Lift detected', value: 'Yes — 08:11:34' },
        ],
      },
      {
        id: 'ev-004', date: '2025-04-01', time: '07:55',
        service_type: 'missed_collection', service_name: 'Missed General Waste',
        verification_status: 'exception',
        vehicle_reg: 'S789GHI', driver: 'R. Carter', run_name: 'Trinity East — General Waste',
        confidence: 35,
        evidence: [
          { type: 'ticket', description: 'Missed service ticket raised by customer — Ticket WS-2876' },
        ],
        details: [
          { label: 'Ticket',   value: 'WS-2876' },
          { label: 'Reason',   value: 'Duplicate route issue — Trinity East ran twice on adjacent street' },
          { label: 'Resolved', value: 'Yes — follow-up collection 3 Apr' },
        ],
        notes: 'Route duplication error caused Edmund Ave to be skipped. Issue logged with routing team.',
      },
      {
        id: 'ev-005', date: '2025-03-26', time: '06:48',
        service_type: 'street_sweeping', service_name: 'Street Sweeping — Edmund Ave',
        verification_status: 'verified',
        vehicle_reg: 'S-SWEEP-02', run_name: 'Sweeping Run A',
        confidence: 96,
        evidence: [
          { type: 'gps', description: 'Sweeper GPS tracked full length of Edmund Ave at 06:48 — speed 8 km/h' },
        ],
        details: [
          { label: 'Pass time',  value: '06:48' },
          { label: 'Street',     value: 'Edmund Ave (full length)' },
          { label: 'Speed',      value: '8 km/h (sweeping speed)' },
          { label: 'Coverage',   value: '100%' },
        ],
      },
      {
        id: 'ev-006', date: '2025-02-08', time: '10:30',
        service_type: 'hard_waste', service_name: 'Hard Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S-HW-003', run_name: 'Hard Waste Run 3',
        confidence: 96,
        evidence: [
          { type: 'photo',  description: 'Before/after photos uploaded by driver at 10:30 and 10:48' },
          { type: 'ticket', description: 'Booking HW-2025-0114 marked completed at 10:49' },
        ],
        details: [
          { label: 'Booking ref',   value: 'HW-2025-0114' },
          { label: 'Items',         value: 'Couch, wardrobe, mattress, timber — ~280 kg' },
          { label: 'Start',         value: '10:30' },
          { label: 'Completed',     value: '10:49' },
        ],
      },
      {
        id: 'ev-007', date: '2025-01-15', time: '09:15',
        service_type: 'bin_maintenance', service_name: 'Bin Replacement',
        verification_status: 'verified',
        vehicle_reg: 'S-MNT-01', confidence: 100,
        evidence: [
          { type: 'manual', description: 'Technician signed off: new 140L General Waste bin delivered and tagged' },
          { type: 'rfid',   description: 'New RFID tag installed: BIN-4821-GW' },
        ],
        details: [
          { label: 'Ticket',  value: 'BM-2025-0042' },
          { label: 'Issue',   value: 'Cracked lid — damaged in collection' },
          { label: 'Action',  value: 'Full bin replacement' },
          { label: 'New bin', value: 'GW 140L · BIN-4821-GW' },
        ],
      },
    ],
    intelligence_summary: 'GPS data shows the vehicle (S789GHI) travelling at 34 km/h — transit speed — with the closest GPS point 83m from the property frontage on 28 April. The truck routed via Portrush Rd rather than Edmund Ave. This is consistent with a genuine missed service, not a reporting error. The property has a strong overall history with 8 of 9 recent bin collections verified.',
    intelligence_action: 'Review route allocation for Trinity East on Tuesdays. Edmund Ave requires a dedicated pass.',
    intelligence_level: 'alert',
  },

  '3-victoria-rd': {
    address: '3 Victoria Rd', suburb: 'Glynde',
    zone: 'Zone D — Glynde East', account_ref: 'GL-007302',
    lat: -34.8982, lng: 138.6522,
    assets: [
      { rfid: 'BIN-7302-GW',   type: 'General Waste', volume: '240L', colour: 'Red lid',   status: 'active' },
      { rfid: 'BIN-7302-REC',  type: 'Recycling',     volume: '240L', colour: 'Yellow lid', status: 'active' },
      { rfid: 'BIN-7302-FOGO', type: 'FOGO',          volume: '120L', colour: 'Green lid',  status: 'active' },
    ],
    planned_services: [
      { service_type: 'General Waste', schedule: 'Weekly · Wednesday', run: 'Glynde Central — General Waste', window: '06:00–14:00', next_date: 'Wed 7 May 2025'  },
      { service_type: 'FOGO',          schedule: 'Weekly · Wednesday', run: 'Glynde Central — General Waste', window: '06:00–14:00', next_date: 'Wed 7 May 2025'  },
      { service_type: 'Recycling',     schedule: 'Fortnightly · Wed',  run: 'Glynde Central — General Waste', window: '06:00–14:00', next_date: 'Wed 14 May 2025' },
    ],
    verification: {
      status: 'likely_missed', scenario: 'route_bypass',
      vehicle_reg: 'S654MNO', driver: 'D. Singh', run_name: 'Glynde Central — General Waste',
      pass_time: null, distance_m: 112, speed_kmh: 41,
      confidence: 18, linked_exception: 'Missed Service',
      gps_points_nearby: 0,
    },
    service_events: [
      {
        id: 'ev-b01', date: '2025-04-26', time: '09:18',
        service_type: 'exception', service_name: 'Bin Not Out — General Waste',
        verification_status: 'exception_recorded',
        vehicle_reg: 'S654MNO', driver: 'D. Singh', run_name: 'Glynde Central — General Waste',
        confidence: 70,
        evidence: [
          { type: 'gps',         description: 'Vehicle stopped 22s at frontage (0–11m) — GPS confirms attendance' },
          { type: 'driver_note', description: 'Bin not presented at kerb for collection' },
        ],
        details: [
          { label: 'Stop duration', value: '22 seconds at frontage' },
          { label: 'GPS distance',  value: '0–11m from property' },
          { label: 'Exception',     value: 'Bin not out — unable to service' },
          { label: 'Vehicle speed', value: '7–8 km/h (attended, not transit)' },
        ],
        notes: 'Vehicle attended the property and stopped. Bin was not at kerbside. Service not completed.',
      },
      {
        id: 'ev-b02', date: '2025-04-19',
        service_type: 'exception', service_name: 'No Access — FOGO Collection',
        verification_status: 'exception',
        vehicle_reg: 'S654MNO', driver: 'D. Singh', run_name: 'Glynde Central — General Waste',
        confidence: 85,
        evidence: [
          { type: 'driver_note', description: 'Driver logged: "Gate locked, bin not accessible. Attended address 09:47."' },
          { type: 'gps',        description: 'GPS confirms vehicle stopped 4m from frontage for 2 min at 09:47' },
        ],
        details: [
          { label: 'Exception type', value: 'No Access — gate locked' },
          { label: 'Time at address', value: '09:47–09:49 (2 min)' },
          { label: 'GPS distance',  value: '4m from frontage' },
        ],
        notes: 'Vehicle attended and stopped but could not access bin. Not a missed service — genuine access issue.',
      },
      {
        id: 'ev-b03', date: '2025-04-12',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S654MNO', driver: 'D. Singh', run_name: 'Glynde Central — General Waste',
        confidence: 82,
        evidence: [
          { type: 'gps',  description: 'GPS pass: 12m at 13 km/h' },
          { type: 'rfid', description: 'Bin tag scanned: BIN-7302-GW' },
        ],
        details: [{ label: 'Pass time', value: '09:22' }, { label: 'Distance', value: '12m' }],
      },
      {
        id: 'ev-b04', date: '2025-04-05',
        service_type: 'missed_collection', service_name: 'Missed General Waste',
        verification_status: 'likely_missed',
        vehicle_reg: 'S654MNO', confidence: 22,
        evidence: [{ type: 'ticket', description: 'Ticket WS-2901 — customer reported miss' }],
        details: [{ label: 'Ticket', value: 'WS-2901' }, { label: 'Pattern', value: '2nd miss in 4 weeks' }],
      },
      {
        id: 'ev-b05', date: '2025-03-20', time: '05:55',
        service_type: 'street_sweeping', service_name: 'Street Sweeping — Victoria Rd',
        verification_status: 'verified',
        vehicle_reg: 'S-SWEEP-01', run_name: 'Sweeping Run B',
        confidence: 94,
        evidence: [
          { type: 'gps', description: 'Sweeper GPS: full coverage of Victoria Rd at 7 km/h' },
        ],
        details: [{ label: 'Pass time', value: '05:55' }, { label: 'Coverage', value: '100%' }],
      },
    ],
    intelligence_summary: 'This property has had 4 exceptions in 4 months, with 3 missed collections — all confirmed by GPS to be route planning gaps. The Glynde Central route currently terminates at the Victoria Rd junction; the spur requires a dedicated 80m extension to reach this property. This is a systemic route design issue, not a driver performance issue.',
    intelligence_action: 'Route Glynde Central to include the Victoria Rd spur — estimated 4-minute addition per run.',
    intelligence_level: 'alert',
  },

  '8-ayers-ave': {
    address: '8 Ayers Ave', suburb: 'Payneham',
    zone: 'Zone A — Payneham South', account_ref: 'PH-001148',
    lat: -34.9060, lng: 138.6440,
    assets: [
      { rfid: 'BIN-1148-GW',  type: 'General Waste', volume: '140L', colour: 'Red lid',    status: 'active' },
      { rfid: 'BIN-1148-REC', type: 'Recycling',     volume: '240L', colour: 'Yellow lid', status: 'active' },
    ],
    planned_services: [
      { service_type: 'General Waste', schedule: 'Weekly · Monday', run: 'Payneham South — General Waste', window: '06:00–10:00', next_date: 'Mon 5 May 2025'  },
      { service_type: 'Recycling',     schedule: 'Fortnightly · Mon', run: 'Payneham South — General Waste', window: '06:00–10:00', next_date: 'Mon 12 May 2025' },
    ],
    verification: {
      status: 'verified', scenario: 'route_pass',
      vehicle_reg: 'S456DEF', driver: 'M. Evans', run_name: 'Payneham South — General Waste',
      pass_time: '09:12:44', distance_m: 7, speed_kmh: 9,
      confidence: 94, linked_exception: 'No Ticket Match',
      gps_points_nearby: 4,
    },
    service_events: [
      {
        id: 'ev-c01', date: '2025-04-28', time: '09:12',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S456DEF', driver: 'M. Evans', run_name: 'Payneham South — General Waste',
        confidence: 94,
        evidence: [
          { type: 'gps',          description: 'GPS pass: 7m from frontage at 09:12, speed 9 km/h' },
          { type: 'lift_sensor',  description: 'Lift event recorded at 09:12:44' },
        ],
        details: [
          { label: 'Pass time',     value: '09:12:44' },
          { label: 'GPS distance',  value: '7m from frontage' },
          { label: 'Speed',         value: '9 km/h (collection speed)' },
          { label: 'Ticket status', value: 'Not created in system — GPS confirms service' },
        ],
        notes: 'Strong GPS and lift sensor confirmation. No ticket match is a data entry gap, not a missed service.',
      },
      {
        id: 'ev-c02', date: '2025-04-21',
        service_type: 'bin_collection', service_name: 'Recycling Collection',
        verification_status: 'verified',
        vehicle_reg: 'S456DEF', driver: 'M. Evans', run_name: 'Payneham South — General Waste',
        confidence: 90,
        evidence: [
          { type: 'gps',  description: 'GPS pass: 8m at 10 km/h' },
          { type: 'rfid', description: 'Bin BIN-1148-REC scanned' },
          { type: 'ticket', description: 'Ticket WS-3041 completed' },
        ],
        details: [{ label: 'Ticket', value: 'WS-3041' }, { label: 'Pass time', value: '09:04' }],
      },
      {
        id: 'ev-c03', date: '2025-04-14',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S456DEF', confidence: 88,
        evidence: [{ type: 'gps', description: 'GPS confirmed pass 10m' }, { type: 'ticket', description: 'WS-2978' }],
        details: [{ label: 'Ticket', value: 'WS-2978' }],
      },
      {
        id: 'ev-c04', date: '2025-03-10', time: '11:02',
        service_type: 'hard_waste', service_name: 'Hard Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S-HW-002', run_name: 'Hard Waste Run 2',
        confidence: 98,
        evidence: [
          { type: 'photo',  description: '3 photos uploaded: before, during, after collection' },
          { type: 'ticket', description: 'HW-2025-0088 marked completed 11:15' },
          { type: 'weighbridge', description: 'Weight recorded: 185 kg' },
        ],
        details: [
          { label: 'Booking',     value: 'HW-2025-0088' },
          { label: 'Items',       value: 'TV, bookcase, metal shelving' },
          { label: 'Weight',      value: '185 kg (weighbridge)' },
          { label: 'Completed',   value: '11:15' },
        ],
      },
    ],
    intelligence_summary: 'GPS evidence is strong: vehicle S456DEF passed 8 Ayers Ave at 09:12 at 9 km/h — consistent with active bin collection — with a lift sensor event confirming physical bin movement. The single exception flag is a data system issue (no ticket created), not a service failure. This property has a clean record with 8 consecutive verified collections.',
    intelligence_action: 'Raise with ticketing integration team. No customer-facing action required.',
    intelligence_level: 'good',
  },

  '56-church-tce': {
    address: '56 Church Tce', suburb: 'Trinity Gardens',
    zone: 'Zone B — North Trinity', account_ref: 'TG-004892',
    lat: -34.9165, lng: 138.6430,
    assets: [
      { rfid: 'BIN-4892-GW',   type: 'General Waste', volume: '240L', colour: 'Red lid',   status: 'active' },
      { rfid: 'BIN-4892-REC',  type: 'Recycling',     volume: '240L', colour: 'Yellow lid', status: 'active' },
      { rfid: 'BIN-4892-FOGO', type: 'FOGO',          volume: '120L', colour: 'Green lid',  status: 'active' },
    ],
    planned_services: [
      { service_type: 'General Waste', schedule: 'Weekly · Tuesday', run: 'Trinity East — General Waste', window: '06:00–12:00', next_date: 'Tue 6 May 2025' },
      { service_type: 'FOGO',          schedule: 'Weekly · Tuesday', run: 'Trinity East — General Waste', window: '06:00–12:00', next_date: 'Tue 6 May 2025' },
    ],
    verification: {
      status: 'no_evidence', scenario: 'gps_gap',
      vehicle_reg: 'S789GHI', driver: 'R. Carter', run_name: 'Trinity East — General Waste',
      pass_time: null, distance_m: null, speed_kmh: null,
      confidence: 42, linked_exception: 'GPS Gap > 5 min',
      gps_points_nearby: 0,
    },
    service_events: [
      {
        id: 'ev-d01', date: '2025-04-28', time: '08:41–08:47',
        service_type: 'bin_collection', service_name: 'FOGO Collection',
        verification_status: 'no_evidence',
        vehicle_reg: 'S789GHI', driver: 'R. Carter', run_name: 'Trinity East — General Waste',
        confidence: 42,
        evidence: [
          { type: 'gps',    description: '6-minute GPS gap (08:41–08:47) — no position data recorded in this period' },
          { type: 'ticket', description: 'Ticket WS-3108 created — GPS gap exception auto-raised' },
        ],
        details: [
          { label: 'GPS gap period', value: '08:41 – 08:47 (6 min)' },
          { label: 'Last known GPS', value: '340m north of property at 08:41' },
          { label: 'GPS resumed',    value: '08:47 — 290m south of property' },
          { label: 'Bin RFID',       value: 'No scan recorded' },
        ],
        notes: 'Verification inconclusive. Property has strong prior history. Request driver declaration.',
      },
      {
        id: 'ev-d02', date: '2025-04-21',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S789GHI', driver: 'R. Carter', run_name: 'Trinity East — General Waste', confidence: 89,
        evidence: [{ type: 'gps', description: '11m at 10 km/h' }, { type: 'rfid', description: 'BIN-4892-GW scanned' }, { type: 'ticket', description: 'WS-3044 completed' }],
        details: [{ label: 'Ticket', value: 'WS-3044' }, { label: 'Pass time', value: '08:38' }],
      },
      {
        id: 'ev-d03', date: '2025-04-14',
        service_type: 'bin_collection', service_name: 'FOGO Collection',
        verification_status: 'verified',
        vehicle_reg: 'S789GHI', confidence: 91,
        evidence: [{ type: 'gps', description: '9m at 9 km/h' }, { type: 'rfid', description: 'BIN-4892-FOGO scanned' }],
        details: [{ label: 'Ticket', value: 'WS-2981' }],
      },
      {
        id: 'ev-d04', date: '2025-02-10',
        service_type: 'missed_collection', service_name: 'GPS Gap — Feb',
        verification_status: 'no_evidence',
        vehicle_reg: 'S789GHI', confidence: 38,
        evidence: [{ type: 'gps', description: 'Second GPS gap at this address — 4 min on Feb 10' }],
        details: [{ label: 'Gap duration', value: '4 min (07:55–07:59)' }],
        notes: 'Second GPS gap event at this address. Possible GPS hardware issue with S789GHI in this street segment.',
      },
    ],
    intelligence_summary: 'A 6-minute GPS data gap (08:41–08:47) was recorded near Church Tce on 28 April, making verification inconclusive. This is the second GPS gap exception at this address — both involving vehicle S789GHI. The vehicle\'s GPS hardware may have an intermittent fault in this street segment. The property\'s 10 prior consecutive completions suggest service was likely performed.',
    intelligence_action: 'Request driver declaration for 28 Apr. Log S789GHI GPS hardware for investigation.',
    intelligence_level: 'warning',
  },

  '28-fifth-ave': {
    address: '28 Fifth Ave', suburb: 'Joslin',
    zone: 'Zone A — Payneham South', account_ref: 'PH-002281',
    lat: -34.9048, lng: 138.6455,
    assets: [
      { rfid: 'BIN-2281-GW',  type: 'General Waste', volume: '140L', colour: 'Red lid',    status: 'active' },
      { rfid: 'BIN-2281-REC', type: 'Recycling',     volume: '240L', colour: 'Yellow lid', status: 'active' },
    ],
    planned_services: [
      { service_type: 'General Waste', schedule: 'Weekly · Tuesday', run: 'Payneham South — General Waste', window: '06:00–10:00', next_date: 'Tue 6 May 2025'  },
      { service_type: 'Recycling',     schedule: 'Fortnightly · Tue', run: 'Payneham South — General Waste', window: '06:00–10:00', next_date: 'Tue 13 May 2025' },
    ],
    verification: {
      status: 'verified', scenario: 'route_pass',
      vehicle_reg: 'S456DEF', driver: 'M. Evans', run_name: 'Payneham South — General Waste',
      pass_time: '08:50:31', distance_m: 11, speed_kmh: 12,
      confidence: 55, linked_exception: null,
      gps_points_nearby: 2,
    },
    service_events: [
      {
        id: 'ev-e01', date: '2025-04-29', time: '08:50',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'likely_completed',
        vehicle_reg: 'S456DEF', driver: 'M. Evans', run_name: 'Payneham South — General Waste',
        confidence: 55,
        evidence: [
          { type: 'gps', description: 'GPS pass confirmed: 11m from frontage at 12 km/h — collection speed' },
        ],
        details: [
          { label: 'Pass time',     value: '08:50:31' },
          { label: 'GPS distance',  value: '11m from frontage' },
          { label: 'Vehicle speed', value: '12 km/h (collection speed)' },
          { label: 'Bin RFID',      value: 'No scan recorded' },
        ],
        notes: 'GPS confirms vehicle pass at collection speed. RFID reader may have been offline this run — no bin scan logged.',
      },
      {
        id: 'ev-e02', date: '2025-04-22',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S456DEF', driver: 'M. Evans', confidence: 91,
        evidence: [{ type: 'gps', description: '9m at 10 km/h' }, { type: 'rfid', description: 'BIN-2281-GW scanned' }],
        details: [{ label: 'Pass time', value: '08:44' }, { label: 'Distance', value: '9m' }],
      },
      {
        id: 'ev-e03', date: '2025-04-15',
        service_type: 'bin_collection', service_name: 'General Waste Collection',
        verification_status: 'verified',
        vehicle_reg: 'S456DEF', confidence: 89,
        evidence: [{ type: 'gps', description: '12m at 11 km/h' }, { type: 'rfid', description: 'BIN-2281-GW scanned' }],
        details: [{ label: 'Ticket', value: 'WS-2994' }],
      },
    ],
    intelligence_summary: 'GPS confirms vehicle S456DEF passed 28 Fifth Ave on 29 April at 12 km/h — consistent with active bin collection. No RFID bin scan was recorded, which is likely a reader fault on this run rather than a missed service. Two prior verified collections with RFID confirmation support this interpretation.',
    intelligence_action: 'Check RFID reader logs for S456DEF on 29 April. Likely hardware fault, not a service miss.',
    intelligence_level: 'warning',
  },
};

const DEFAULT_PROPERTY: PropertyData = {
  address: 'Property', suburb: 'Suburb',
  zone: 'Zone A', account_ref: 'ACC-000000',
  lat: -34.9200, lng: 138.6400,
  assets: [
    { rfid: 'BIN-0000-GW',  type: 'General Waste', volume: '240L', colour: 'Red lid',    status: 'active' },
    { rfid: 'BIN-0000-REC', type: 'Recycling',     volume: '240L', colour: 'Yellow lid', status: 'active' },
  ],
  planned_services: [
    { service_type: 'General Waste', schedule: 'Weekly · Monday', run: 'Norwood West — General Waste', window: '06:00–12:00', next_date: 'Mon 5 May 2025' },
  ],
  verification: {
    status: 'verified', scenario: 'route_pass',
    vehicle_reg: 'S123ABC', driver: 'J. Thompson', run_name: 'Norwood West — General Waste',
    pass_time: '08:43:21', distance_m: 11, speed_kmh: 11,
    confidence: 88, linked_exception: null,
    gps_points_nearby: 3,
  },
  service_events: [
    {
      id: 'ev-def-01', date: '2025-04-28', time: '08:43',
      service_type: 'bin_collection', service_name: 'General Waste Collection',
      verification_status: 'verified',
      vehicle_reg: 'S123ABC', driver: 'J. Thompson', run_name: 'Norwood West — General Waste',
      confidence: 88,
      evidence: [{ type: 'gps', description: '11m from frontage at 11 km/h' }, { type: 'ticket', description: 'WS-3091 completed' }],
      details: [{ label: 'Pass time', value: '08:43:21' }, { label: 'Ticket', value: 'WS-3091' }],
    },
    {
      id: 'ev-def-02', date: '2025-04-21', time: '08:39',
      service_type: 'bin_collection', service_name: 'General Waste Collection',
      verification_status: 'verified',
      vehicle_reg: 'S123ABC', confidence: 86,
      evidence: [{ type: 'gps', description: '13m at 12 km/h' }, { type: 'ticket', description: 'WS-3028' }],
      details: [{ label: 'Ticket', value: 'WS-3028' }],
    },
  ],
  intelligence_summary: 'This property has a clean service record. GPS evidence confirms regular passes at appropriate collection speed. No concerns.',
  intelligence_action: null,
  intelligence_level: 'good',
};

function resolveProperty(id: string): PropertyData {
  const slug = decodeURIComponent(id).toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  for (const [key, data] of Object.entries(PROPERTIES)) {
    if (slug.includes(key)) return data;
  }
  return DEFAULT_PROPERTY;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.organisationId) redirect('/login');

  const { id } = await params;
  if (!id) notFound();

  const data = resolveProperty(id);

  // Run the verification engine server-side using demo GPS data
  let engineResult: VerificationResult | null = null;
  const scenario = getDemoScenario(id);
  if (scenario) {
    engineResult = verifyService({ ...scenario, organisationId: session.organisationId });
  }

  return <PropertyClient data={data} propertyId={id} engineResult={engineResult} />;
}
