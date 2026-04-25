import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Helpers ────────────────────────────────────────────────────────────────
const addMins = (t, m) => {
  const [h, mm] = t.split(":").map(Number);
  const tot = h * 60 + mm + m;
  return `${String(Math.floor(tot / 60)).padStart(2, "0")}:${String(tot % 60).padStart(2, "0")}`;
};
const diffMins = (t1, t2) => {
  const [h1, m1] = t1.split(":").map(Number), [h2, m2] = t2.split(":").map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1);
};

// ── Sheet 1: Fleet Data ────────────────────────────────────────────────────
const fleetData = [
  { Asset:"TRK-001", Type:"Heavy Truck", Make:"Isuzu FXZ",      Year:2019, Department:"Waste Collection",  Driver:"James Hartley",   KM:42800, Wages:52400, Fuel:18500, Maintenance:8200,  Rego:1240, Repairs:4500, Insurance:3800, Depreciation:14200, Services:4, Defects:2 },
  { Asset:"TRK-002", Type:"Heavy Truck", Make:"Isuzu FXZ",      Year:2020, Department:"Waste Collection",  Driver:"Mick Donaldson",  KM:38600, Wages:49200, Fuel:16800, Maintenance:7600,  Rego:1240, Repairs:2200, Insurance:3800, Depreciation:12800, Services:4, Defects:1 },
  { Asset:"TRK-003", Type:"Heavy Truck", Make:"Mercedes Atego", Year:2018, Department:"Waste Collection",  Driver:"Dan Rutherford",  KM:51200, Wages:54100, Fuel:19200, Maintenance:9800,  Rego:1240, Repairs:6800, Insurance:3800, Depreciation:16400, Services:5, Defects:4 },
  { Asset:"TRK-004", Type:"Heavy Truck", Make:"Isuzu FXZ",      Year:2021, Department:"Parks & Gardens",   Driver:"Steve Kowalski",  KM:36100, Wages:51000, Fuel:17600, Maintenance:6400,  Rego:1240, Repairs:1800, Insurance:3800, Depreciation:11600, Services:3, Defects:0 },
  { Asset:"TRK-005", Type:"Heavy Truck", Make:"Hino 500",       Year:2016, Department:"Waste Collection",  Driver:"Paul Nguyen",     KM:64300, Wages:48300, Fuel:15900, Maintenance:11200, Rego:1240, Repairs:9200, Insurance:3800, Depreciation:19800, Services:6, Defects:5 },
  { Asset:"TRK-006", Type:"Heavy Truck", Make:"Hino 500",       Year:2020, Department:"Roads & Drainage",  Driver:"Chris Bateman",   KM:40500, Wages:53000, Fuel:18100, Maintenance:7900,  Rego:1240, Repairs:3400, Insurance:3800, Depreciation:13200, Services:4, Defects:1 },
  { Asset:"VAN-001", Type:"Light Van",   Make:"Toyota HiAce",   Year:2022, Department:"Customer Service",  Driver:"Amy Chen",        KM:22400, Wages:42000, Fuel:8400,  Maintenance:3200,  Rego:820,  Repairs:1200, Insurance:1900, Depreciation:6800,  Services:2, Defects:0 },
  { Asset:"VAN-002", Type:"Light Van",   Make:"Toyota HiAce",   Year:2021, Department:"Facilities",        Driver:"Brett Sullivan",  KM:28600, Wages:43500, Fuel:9100,  Maintenance:4600,  Rego:820,  Repairs:2800, Insurance:1900, Depreciation:7400,  Services:3, Defects:2 },
  { Asset:"VAN-003", Type:"Light Van",   Make:"Ford Transit",   Year:2023, Department:"Customer Service",  Driver:"Sarah Mitchell",  KM:19800, Wages:41000, Fuel:7800,  Maintenance:2900,  Rego:820,  Repairs:900,  Insurance:1900, Depreciation:5600,  Services:2, Defects:0 },
  { Asset:"UTE-001", Type:"Utility",     Make:"Toyota HiLux",   Year:2022, Department:"Parks & Gardens",   Driver:"Tom Blackwood",   KM:18200, Wages:38000, Fuel:6200,  Maintenance:2100,  Rego:650,  Repairs:800,  Insurance:1400, Depreciation:4800,  Services:2, Defects:0 },
  { Asset:"UTE-002", Type:"Utility",     Make:"Toyota HiLux",   Year:2021, Department:"Roads & Drainage",  Driver:"Kyle Anderson",   KM:21400, Wages:36500, Fuel:5800,  Maintenance:1800,  Rego:650,  Repairs:1400, Insurance:1400, Depreciation:5200,  Services:2, Defects:1 },
  { Asset:"UTE-003", Type:"Utility",     Make:"Ford Ranger",    Year:2023, Department:"Parks & Gardens",   Driver:"Jake Morley",     KM:15900, Wages:39200, Fuel:6600,  Maintenance:2800,  Rego:650,  Repairs:600,  Insurance:1400, Depreciation:4200,  Services:2, Defects:0 },
];

// ── Sheet 2: Servicing ─────────────────────────────────────────────────────
const servicing = [
  { Asset:"TRK-001", Make:"Isuzu FXZ",      "Last Service":"2025-03-15", "Next Due":"2025-06-15", Odometer:42800, "Service Type":"B Service", Cost:2800, Status:"Due Soon", Notes:"Check brake pads at next service" },
  { Asset:"TRK-002", Make:"Isuzu FXZ",      "Last Service":"2025-04-01", "Next Due":"2025-07-01", Odometer:38600, "Service Type":"A Service", Cost:980,  Status:"OK",       Notes:"" },
  { Asset:"TRK-003", Make:"Mercedes Atego", "Last Service":"2025-01-20", "Next Due":"2025-04-20", Odometer:51200, "Service Type":"Major",     Cost:6200, Status:"Overdue",   Notes:"Hydraulic system inspection required" },
  { Asset:"TRK-004", Make:"Isuzu FXZ",      "Last Service":"2025-04-10", "Next Due":"2025-07-10", Odometer:36100, "Service Type":"A Service", Cost:920,  Status:"OK",       Notes:"" },
  { Asset:"TRK-005", Make:"Hino 500",       "Last Service":"2025-02-28", "Next Due":"2025-05-28", Odometer:64300, "Service Type":"B Service", Cost:2600, Status:"Due Soon",  Notes:"Transmission fluid change due" },
  { Asset:"TRK-006", Make:"Hino 500",       "Last Service":"2025-03-22", "Next Due":"2025-06-22", Odometer:40500, "Service Type":"A Service", Cost:950,  Status:"OK",       Notes:"" },
  { Asset:"VAN-001", Make:"Toyota HiAce",   "Last Service":"2025-04-05", "Next Due":"2025-07-05", Odometer:22400, "Service Type":"A Service", Cost:620,  Status:"OK",       Notes:"" },
  { Asset:"VAN-002", Make:"Toyota HiAce",   "Last Service":"2025-02-14", "Next Due":"2025-05-14", Odometer:28600, "Service Type":"B Service", Cost:1400, Status:"Overdue",   Notes:"Tyres to be inspected" },
  { Asset:"VAN-003", Make:"Ford Transit",   "Last Service":"2025-04-12", "Next Due":"2025-07-12", Odometer:19800, "Service Type":"A Service", Cost:580,  Status:"OK",       Notes:"" },
  { Asset:"UTE-001", Make:"Toyota HiLux",   "Last Service":"2025-03-28", "Next Due":"2025-06-28", Odometer:18200, "Service Type":"A Service", Cost:540,  Status:"OK",       Notes:"" },
  { Asset:"UTE-002", Make:"Toyota HiLux",   "Last Service":"2025-04-08", "Next Due":"2025-07-08", Odometer:21400, "Service Type":"A Service", Cost:520,  Status:"OK",       Notes:"" },
  { Asset:"UTE-003", Make:"Ford Ranger",    "Last Service":"2025-04-15", "Next Due":"2025-07-15", Odometer:15900, "Service Type":"A Service", Cost:510,  Status:"OK",       Notes:"" },
];

// ── Sheet 3: HR ────────────────────────────────────────────────────────────
const hr = [
  { Asset:"TRK-001", Driver:"James Hartley",  Department:"Waste Collection",  "Scheduled Hours":800, "Worked Hours":842, Overtime:42, "Absent Days":2, "Hourly Rate":38, "Total Labour":32000 },
  { Asset:"TRK-002", Driver:"Mick Donaldson", Department:"Waste Collection",  "Scheduled Hours":800, "Worked Hours":795, Overtime:0,  "Absent Days":5, "Hourly Rate":36, "Total Labour":28620 },
  { Asset:"TRK-003", Driver:"Dan Rutherford", Department:"Waste Collection",  "Scheduled Hours":800, "Worked Hours":858, Overtime:58, "Absent Days":1, "Hourly Rate":38, "Total Labour":32600 },
  { Asset:"TRK-004", Driver:"Steve Kowalski", Department:"Parks & Gardens",   "Scheduled Hours":800, "Worked Hours":820, Overtime:20, "Absent Days":3, "Hourly Rate":37, "Total Labour":30340 },
  { Asset:"TRK-005", Driver:"Paul Nguyen",    Department:"Waste Collection",  "Scheduled Hours":800, "Worked Hours":780, Overtime:0,  "Absent Days":8, "Hourly Rate":35, "Total Labour":27300 },
  { Asset:"TRK-006", Driver:"Chris Bateman",  Department:"Roads & Drainage",  "Scheduled Hours":800, "Worked Hours":835, Overtime:35, "Absent Days":2, "Hourly Rate":38, "Total Labour":31730 },
  { Asset:"VAN-001", Driver:"Amy Chen",       Department:"Customer Service",  "Scheduled Hours":760, "Worked Hours":762, Overtime:2,  "Absent Days":1, "Hourly Rate":32, "Total Labour":24384 },
  { Asset:"VAN-002", Driver:"Brett Sullivan", Department:"Facilities",        "Scheduled Hours":760, "Worked Hours":774, Overtime:14, "Absent Days":4, "Hourly Rate":31, "Total Labour":23994 },
  { Asset:"VAN-003", Driver:"Sarah Mitchell", Department:"Customer Service",  "Scheduled Hours":760, "Worked Hours":751, Overtime:0,  "Absent Days":2, "Hourly Rate":30, "Total Labour":22530 },
  { Asset:"UTE-001", Driver:"Tom Blackwood",  Department:"Parks & Gardens",   "Scheduled Hours":760, "Worked Hours":768, Overtime:8,  "Absent Days":0, "Hourly Rate":28, "Total Labour":21504 },
  { Asset:"UTE-002", Driver:"Kyle Anderson",  Department:"Roads & Drainage",  "Scheduled Hours":760, "Worked Hours":748, Overtime:0,  "Absent Days":5, "Hourly Rate":27, "Total Labour":20196 },
  { Asset:"UTE-003", Driver:"Jake Morley",    Department:"Parks & Gardens",   "Scheduled Hours":760, "Worked Hours":772, Overtime:12, "Absent Days":1, "Hourly Rate":28, "Total Labour":21616 },
];

// ── Sheet 4: Downtime ──────────────────────────────────────────────────────
const downtime = [
  { Asset:"TRK-001", Date:"2025-02-10", Category:"Breakdown",  Reason:"Engine fault",           Hours:16, Cost:1280, Resolved:"Yes" },
  { Asset:"TRK-003", Date:"2025-01-15", Category:"Breakdown",  Reason:"Hydraulic failure",      Hours:24, Cost:1920, Resolved:"Yes" },
  { Asset:"TRK-003", Date:"2025-03-02", Category:"Scheduled",  Reason:"Brake inspection",       Hours:8,  Cost:640,  Resolved:"Yes" },
  { Asset:"TRK-005", Date:"2025-01-08", Category:"Breakdown",  Reason:"Transmission issue",     Hours:32, Cost:2560, Resolved:"Yes" },
  { Asset:"TRK-005", Date:"2025-02-20", Category:"Breakdown",  Reason:"Electrical fault",       Hours:12, Cost:960,  Resolved:"Yes" },
  { Asset:"TRK-005", Date:"2025-04-01", Category:"Accident",   Reason:"Minor collision",        Hours:40, Cost:3200, Resolved:"No"  },
  { Asset:"VAN-002", Date:"2025-02-28", Category:"Breakdown",  Reason:"Tyre blowout",           Hours:4,  Cost:320,  Resolved:"Yes" },
  { Asset:"VAN-002", Date:"2025-03-15", Category:"Scheduled",  Reason:"Service overdue",        Hours:6,  Cost:480,  Resolved:"Yes" },
  { Asset:"TRK-006", Date:"2025-03-10", Category:"Scheduled",  Reason:"Roadworthy inspection",  Hours:8,  Cost:640,  Resolved:"Yes" },
  { Asset:"UTE-002", Date:"2025-04-02", Category:"Breakdown",  Reason:"Battery failure",        Hours:4,  Cost:320,  Resolved:"Yes" },
  { Asset:"TRK-002", Date:"2025-04-18", Category:"External",   Reason:"Road closure delay",     Hours:6,  Cost:480,  Resolved:"Yes" },
];

// ── Sheet 5: Utilisation ───────────────────────────────────────────────────
const utilisation = [
  { Asset:"TRK-001", Type:"Heavy Truck", "Scheduled Hours":800, "Operating Hours":612, "Idle Hours":188, "Utilisation %":76.5, "Idle Cost":4700 },
  { Asset:"TRK-002", Type:"Heavy Truck", "Scheduled Hours":800, "Operating Hours":658, "Idle Hours":142, "Utilisation %":82.3, "Idle Cost":3550 },
  { Asset:"TRK-003", Type:"Heavy Truck", "Scheduled Hours":800, "Operating Hours":580, "Idle Hours":220, "Utilisation %":72.5, "Idle Cost":5500 },
  { Asset:"TRK-004", Type:"Heavy Truck", "Scheduled Hours":800, "Operating Hours":698, "Idle Hours":102, "Utilisation %":87.3, "Idle Cost":2550 },
  { Asset:"TRK-005", Type:"Heavy Truck", "Scheduled Hours":800, "Operating Hours":542, "Idle Hours":258, "Utilisation %":67.8, "Idle Cost":6450 },
  { Asset:"TRK-006", Type:"Heavy Truck", "Scheduled Hours":800, "Operating Hours":634, "Idle Hours":166, "Utilisation %":79.3, "Idle Cost":4150 },
  { Asset:"VAN-001", Type:"Light Van",   "Scheduled Hours":760, "Operating Hours":628, "Idle Hours":132, "Utilisation %":82.6, "Idle Cost":2640 },
  { Asset:"VAN-002", Type:"Light Van",   "Scheduled Hours":760, "Operating Hours":598, "Idle Hours":162, "Utilisation %":78.7, "Idle Cost":3240 },
  { Asset:"VAN-003", Type:"Light Van",   "Scheduled Hours":760, "Operating Hours":652, "Idle Hours":108, "Utilisation %":85.8, "Idle Cost":2160 },
  { Asset:"UTE-001", Type:"Utility",     "Scheduled Hours":760, "Operating Hours":682, "Idle Hours":78,  "Utilisation %":89.7, "Idle Cost":1560 },
  { Asset:"UTE-002", Type:"Utility",     "Scheduled Hours":760, "Operating Hours":664, "Idle Hours":96,  "Utilisation %":87.4, "Idle Cost":1920 },
  { Asset:"UTE-003", Type:"Utility",     "Scheduled Hours":760, "Operating Hours":702, "Idle Hours":58,  "Utilisation %":92.4, "Idle Cost":1160 },
];

// ── Geofence: Trip Log, Stop Log, Co-location ─────────────────────────────

const vCfg = [
  { a:"TRK-001", d:"James Hartley",  dep:"05:45", ret:"14:20", baseStops:6, vo:0,   type:"waste",    zones:"Northern Suburbs, Transfer Station" },
  { a:"TRK-002", d:"Mick Donaldson", dep:"06:00", ret:"15:05", baseStops:7, vo:3,   type:"waste",    zones:"Northern Suburbs, Transfer Station" },
  { a:"TRK-003", d:"Dan Rutherford", dep:"05:30", ret:"14:00", baseStops:5, vo:-2,  type:"waste",    zones:"Southern Suburbs, Transfer Station" },
  { a:"TRK-004", d:"Steve Kowalski", dep:"06:30", ret:"15:30", baseStops:4, vo:5,   type:"parks",    zones:"Eastern Zone, Parks Depot" },
  { a:"TRK-005", d:"Paul Nguyen",    dep:"05:45", ret:"13:45", baseStops:8, vo:-4,  type:"waste",    zones:"Southern Suburbs, Transfer Station" },
  { a:"TRK-006", d:"Chris Bateman",  dep:"07:00", ret:"16:10", baseStops:3, vo:2,   type:"roads",    zones:"Western Zone, Industrial Area" },
  { a:"VAN-001", d:"Amy Chen",       dep:"08:00", ret:"17:00", baseStops:5, vo:-1,  type:"customer", zones:"CBD & Inner, Northern Suburbs" },
  { a:"VAN-002", d:"Brett Sullivan", dep:"07:30", ret:"16:45", baseStops:4, vo:4,   type:"facilities",zones:"CBD & Inner, Eastern Zone" },
  { a:"VAN-003", d:"Sarah Mitchell", dep:"08:15", ret:"17:20", baseStops:6, vo:-3,  type:"customer", zones:"CBD & Inner, Southern Suburbs" },
  { a:"UTE-001", d:"Tom Blackwood",  dep:"06:30", ret:"15:00", baseStops:3, vo:1,   type:"parks",    zones:"Parks Portfolio, Eastern Zone" },
  { a:"UTE-002", d:"Kyle Anderson",  dep:"07:00", ret:"15:30", baseStops:4, vo:-2,  type:"roads",    zones:"Roads Network, Western Zone" },
  { a:"UTE-003", d:"Jake Morley",    dep:"06:45", ret:"15:15", baseStops:3, vo:3,   type:"parks",    zones:"Parks Portfolio, Eastern Zone" },
];

const dayOffsets = [
  { label:"Mon 21 Apr", depOff:0,   retOff:0   },
  { label:"Tue 22 Apr", depOff:5,   retOff:-8  },
  { label:"Wed 23 Apr", depOff:-3,  retOff:12  },
  { label:"Thu 24 Apr", depOff:8,   retOff:-5  },
  { label:"Fri 25 Apr", depOff:-6,  retOff:18  },
];

// Trip Log
const tripLog = [];
for (const v of vCfg) {
  for (let di = 0; di < dayOffsets.length; di++) {
    const day = dayOffsets[di];
    const dep = addMins(v.dep, day.depOff + v.vo);
    const ret = addMins(v.ret, day.retOff + v.vo);
    const hoursOut = +(diffMins(dep, ret) / 60).toFixed(1);
    const stopVar = (vCfg.indexOf(v) + di) % 3 - 1;
    tripLog.push({
      Asset:            v.a,
      Driver:           v.d,
      Date:             day.label,
      "Yard Departure": dep,
      "Yard Return":    ret,
      "Hours Out":      hoursOut,
      "Stops Made":     Math.max(1, v.baseStops + stopVar),
      "Areas Visited":  v.zones,
    });
  }
}

// Stop templates per vehicle type
const stopTemplates = {
  waste: [
    { area:"Northern / Southern Suburbs", type:"Collection",        dur:9  },
    { area:"Northern / Southern Suburbs", type:"Collection",        dur:11 },
    { area:"Northern / Southern Suburbs", type:"Collection",        dur:8  },
    { area:"Northern / Southern Suburbs", type:"Collection",        dur:10 },
    { area:"Transfer Station",            type:"Transfer Station",  dur:28 },
    { area:"Yard (Fuel Bay)",             type:"Fuel Stop",         dur:14 },
    { area:"Rest Area",                   type:"Rest Break",        dur:12 },
    { area:"Northern / Southern Suburbs", type:"Collection",        dur:7  },
  ],
  parks: [
    { area:"Parks Depot",                 type:"Depot Check-in",    dur:20 },
    { area:"Eastern Zone",                type:"Site Inspection",   dur:45 },
    { area:"Parks Portfolio",             type:"Maintenance Work",  dur:65 },
    { area:"Yard (Fuel Bay)",             type:"Fuel Stop",         dur:12 },
    { area:"Site Office",                 type:"Lunch Break",       dur:35 },
  ],
  roads: [
    { area:"Industrial Area",             type:"Site Inspection",   dur:40 },
    { area:"Western Zone",                type:"Road Works",        dur:90 },
    { area:"Yard (Fuel Bay)",             type:"Fuel Stop",         dur:15 },
    { area:"Site Office",                 type:"Lunch Break",       dur:30 },
  ],
  customer: [
    { area:"CBD & Inner",                 type:"Customer Site",     dur:45 },
    { area:"Northern / Southern Suburbs", type:"Customer Site",     dur:35 },
    { area:"CBD & Inner",                 type:"Customer Site",     dur:50 },
    { area:"CBD & Inner",                 type:"Lunch Break",       dur:35 },
    { area:"CBD & Inner",                 type:"Customer Site",     dur:30 },
    { area:"CBD & Inner",                 type:"Customer Site",     dur:40 },
  ],
  facilities: [
    { area:"CBD & Inner",                 type:"Customer Site",     dur:60 },
    { area:"Eastern Zone",                type:"Customer Site",     dur:40 },
    { area:"CBD & Inner",                 type:"Lunch Break",       dur:30 },
    { area:"CBD & Inner",                 type:"Maintenance Stop",  dur:75 },
  ],
};

// Stop Log
const stopLog = [];
for (let vi = 0; vi < vCfg.length; vi++) {
  const v = vCfg[vi];
  const tmpl = stopTemplates[v.type];
  for (let di = 0; di < dayOffsets.length; di++) {
    const day = dayOffsets[di];
    const numStops = Math.max(1, v.baseStops + (vi + di) % 3 - 1);
    let cur = addMins(v.dep, day.depOff + v.vo + 28); // first stop ~28 min after yard departure
    for (let si = 0; si < Math.min(numStops, tmpl.length); si++) {
      const t = tmpl[si];
      const durVar = (vi + si + di) % 5 - 2;
      const dur = Math.max(3, t.dur + durVar);
      const arrival = cur;
      const departure = addMins(arrival, dur);
      stopLog.push({
        Asset:            v.a,
        Driver:           v.d,
        Date:             day.label,
        Area:             t.area,
        Arrival:          arrival,
        Departure:        departure,
        "Duration (mins)":dur,
        "Stop Type":      t.type,
      });
      cur = addMins(departure, 18 + (vi + si) % 12); // travel time to next stop
    }
  }
}

// Co-location — vehicles in the same area at overlapping times
const coLocation = [
  { Date:"Mon 21 Apr", Area:"Transfer Station",            Vehicles:"TRK-001, TRK-002",           "Start Time":"11:20", "Duration (mins)":22, Notes:"Scheduled drop-off overlap" },
  { Date:"Mon 21 Apr", Area:"Transfer Station",            Vehicles:"TRK-003, TRK-005",           "Start Time":"10:45", "Duration (mins)":18, Notes:"Scheduled drop-off overlap" },
  { Date:"Mon 21 Apr", Area:"Eastern Zone",                Vehicles:"TRK-004, UTE-001, UTE-003",  "Start Time":"09:30", "Duration (mins)":35, Notes:"Parks team morning briefing on site" },
  { Date:"Tue 22 Apr", Area:"Transfer Station",            Vehicles:"TRK-001, TRK-003",           "Start Time":"11:05", "Duration (mins)":14, Notes:"" },
  { Date:"Tue 22 Apr", Area:"CBD & Inner",                 Vehicles:"VAN-001, VAN-003",           "Start Time":"12:30", "Duration (mins)":40, Notes:"Lunch — same location (council building)" },
  { Date:"Wed 23 Apr", Area:"Western Zone",                Vehicles:"TRK-006, UTE-002",           "Start Time":"08:45", "Duration (mins)":55, Notes:"Joint road inspection — scheduled" },
  { Date:"Wed 23 Apr", Area:"Transfer Station",            Vehicles:"TRK-002, TRK-005",           "Start Time":"10:30", "Duration (mins)":20, Notes:"" },
  { Date:"Wed 23 Apr", Area:"CBD & Inner",                 Vehicles:"VAN-001, VAN-002, VAN-003",  "Start Time":"12:20", "Duration (mins)":35, Notes:"All vans at council admin building" },
  { Date:"Thu 24 Apr", Area:"Parks Portfolio",             Vehicles:"UTE-001, UTE-003",           "Start Time":"09:10", "Duration (mins)":60, Notes:"Shared maintenance task — Birdwood Park" },
  { Date:"Thu 24 Apr", Area:"Transfer Station",            Vehicles:"TRK-001, TRK-002, TRK-005", "Start Time":"11:40", "Duration (mins)":25, Notes:"High volume — 3 trucks queued simultaneously" },
  { Date:"Fri 25 Apr", Area:"Eastern Zone",                Vehicles:"TRK-004, UTE-001",           "Start Time":"07:30", "Duration (mins)":45, Notes:"End-of-week site check" },
  { Date:"Fri 25 Apr", Area:"Transfer Station",            Vehicles:"TRK-003, TRK-005",           "Start Time":"10:15", "Duration (mins)":30, Notes:"" },
];

// ── Build workbook ─────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
const addSheet = (data, name, colWidths) => {
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = colWidths.map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, name);
};

addSheet(fleetData,   "Fleet Data",   [10,14,18,6,22,18,8,8,8,12,6,9,10,14,8,8]);
addSheet(servicing,   "Servicing",    [10,18,14,12,10,14,8,10,35]);
addSheet(hr,          "HR",           [10,18,22,14,12,10,12,12,16]);
addSheet(downtime,    "Downtime",     [10,12,12,30,8,8,10]);
addSheet(utilisation, "Utilisation",  [10,14,16,16,12,14,12]);
addSheet(tripLog,     "Trip Log",     [10,18,14,16,14,12,12,30]);
addSheet(stopLog,     "Stop Log",     [10,18,14,28,10,10,16,18]);
addSheet(coLocation,  "Co-location",  [14,24,30,12,16,40]);

const outPath = path.join(__dirname, "..", "public", "fleet-dummy-data.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Generated: ${outPath}`);
console.log(`  Trip Log:    ${tripLog.length} rows`);
console.log(`  Stop Log:    ${stopLog.length} rows`);
console.log(`  Co-location: ${coLocation.length} events`);
