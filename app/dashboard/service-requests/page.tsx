import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import ServiceRequestsClient from './ServiceRequestsClient';

const MONTH_ORDER = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];

export type SRRow = {
  request_id: string;
  service_type: string;
  suburb: string;
  month: string;
  status: string;
  priority: string;
  days_open: number;
  cost: number;
};

export type UploadMeta = {
  fileName: string;
  uploadedAt: string;
  recordCount: number;
};

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_ROWS: SRRow[] = [
  ...['Norwood','Payneham','Marden','Glynde','Royston Park','Heathpool','Trinity Gardens','Evandale'].flatMap(suburb => [
    { request_id: `SR-${suburb.slice(0,3).toUpperCase()}-01`, service_type: 'Missed Bin',       suburb, month: 'Jan', status: 'Closed',  priority: 'High',   days_open: 2,  cost: 420 },
    { request_id: `SR-${suburb.slice(0,3).toUpperCase()}-02`, service_type: 'Graffiti Removal',  suburb, month: 'Jan', status: 'Open',    priority: 'Medium', days_open: 8,  cost: 190 },
    { request_id: `SR-${suburb.slice(0,3).toUpperCase()}-03`, service_type: 'Pothole Repair',    suburb, month: 'Feb', status: 'Pending', priority: 'High',   days_open: 5,  cost: 640 },
    { request_id: `SR-${suburb.slice(0,3).toUpperCase()}-04`, service_type: 'Tree Maintenance',  suburb, month: 'Feb', status: 'Closed',  priority: 'Low',    days_open: 12, cost: 85  },
    { request_id: `SR-${suburb.slice(0,3).toUpperCase()}-05`, service_type: 'Illegal Dumping',   suburb, month: 'Mar', status: 'Open',    priority: 'High',   days_open: 4,  cost: 500 },
  ]),
];

const DEMO_META: UploadMeta | null = null;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ServiceRequestsPage() {
  const session = await getSession();
  if (!session?.organisationId) redirect('/login');
  const oid = session.organisationId;

  // Upload metadata
  let uploadMeta: UploadMeta | null = null;
  try {
    const fileRows = await sql`
      SELECT f.file_name, f.created_at,
             (SELECT COUNT(*) FROM service_requests sr WHERE sr.uploaded_file_id = f.id)::int AS record_count
      FROM uploaded_files f
      WHERE f.organisation_id = ${oid}
        AND f.upload_status = 'complete'
        AND (f.service_type = 'service_requests' OR f.file_name = 'demo-seed.csv')
      ORDER BY f.created_at DESC
      LIMIT 1
    `;
    if (fileRows.length > 0) {
      uploadMeta = {
        fileName:    fileRows[0].file_name  as string,
        uploadedAt:  fileRows[0].created_at as string,
        recordCount: Number(fileRows[0].record_count),
      };
    }
  } catch { /* table not ready */ }

  // Fetch raw rows
  let rawRows: Record<string, unknown>[] = [];
  try {
    rawRows = await sql`
      SELECT request_id, service_type, suburb, month, status, priority, days_open, cost
      FROM service_requests
      WHERE organisation_id = ${oid}
      ORDER BY
        ARRAY_POSITION(ARRAY['High','Medium','Low'], priority::text) NULLS LAST,
        days_open DESC
      LIMIT 2000
    `;
  } catch { /* table not ready */ }

  if (rawRows.length === 0) {
    return (
      <ServiceRequestsClient
        isDemo
        uploadMeta={DEMO_META}
        rows={DEMO_ROWS}
        monthOrder={MONTH_ORDER}
      />
    );
  }

  const rows: SRRow[] = rawRows.map(r => ({
    request_id:   String(r.request_id  ?? ''),
    service_type: String(r.service_type ?? 'General'),
    suburb:       String(r.suburb       ?? 'Unknown'),
    month:        String(r.month        ?? ''),
    status:       String(r.status       ?? 'Open'),
    priority:     String(r.priority     ?? 'Medium'),
    days_open:    Number(r.days_open    ?? 0),
    cost:         Number(r.cost         ?? 0),
  }));

  return (
    <ServiceRequestsClient
      isDemo={false}
      uploadMeta={uploadMeta}
      rows={rows}
      monthOrder={MONTH_ORDER}
    />
  );
}
