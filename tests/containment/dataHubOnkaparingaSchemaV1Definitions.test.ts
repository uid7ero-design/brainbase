import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { classifyHeader, matchedPiiTerms, PII_TRIGGER_TERMS } from '../helpers/dataHubOnkaparingaSchemaV1Policy'

// Data Hub 6.2D3B — governed Onkaparinga dataset / June-v1 definitions.
// Static containment on config/data-hub/onkaparinga-monthly-operations-v1.json
// and scripts/seed-datahub-onkaparinga-schema-v1.sql. Locks in: the
// approved STRUCTURAL-ONLY manifest (exact sheets, literal headers incl.
// duplicates/typo, roles/dispositions, committed sensitivity classes),
// the DRAFT/inactive boundary, an INSERT-only seed that never touches
// ImportBatch / SourceSystem / SourceMapping / MappingVersion, and no
// runtime consumer (XLSX mapping/confirm stay CSV-only). Real PostgreSQL
// behavior (apply, zero-write rerun, drift/partial fail-loud, SourceSystem
// resolution, atomic rollback) is proven by
// scripts/tests/verify-datahub-onkaparinga-schema-v1.sh.

const REPO_ROOT = path.resolve(__dirname, '../..')

function readSource(relPath: string): string {
  // Normalize CRLF (Windows checkouts) so exact-text assertions are stable.
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf-8').replace(/\r\n/g, '\n')
}

const MANIFEST_PATH = 'config/data-hub/onkaparinga-monthly-operations-v1.json'
const MANIFEST_TEXT = readSource(MANIFEST_PATH)
const MANIFEST = JSON.parse(MANIFEST_TEXT)
const SEED = readSource('scripts/seed-datahub-onkaparinga-schema-v1.sql')
const HARNESS = readSource('scripts/tests/verify-datahub-onkaparinga-schema-v1.sh')

const MANIFEST_OPEN = '$manifest$\n'
const MANIFEST_CLOSE = '$manifest$;'
const EMBEDDED_MANIFEST = SEED.slice(SEED.indexOf(MANIFEST_OPEN) + MANIFEST_OPEN.length, SEED.indexOf(MANIFEST_CLOSE))
// Executable SQL only: comment lines and the embedded manifest literal removed.
const ACTIVE_SQL = (SEED.slice(0, SEED.indexOf(MANIFEST_OPEN)) + SEED.slice(SEED.indexOf(MANIFEST_CLOSE)))
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .join('\n')

// Independent restatement of the approved structural inventory (literal
// headers, one-based header row 3). Trends has no approved tabular header.
const APPROVED: Array<[string, string, string, string, string | null]> = [
  ['Overview', 'overview', 'SUMMARY', 'RECONCILIATION_SUMMARY', 'Service Type | Runs | Loads | Collections | Pres Rate | Contam Rate | Weight | Ave Wt / Bin'],
  ['Trends', 'trends', 'SUMMARY', 'RECONCILIATION_SUMMARY', null],
  ['Runs', 'runs', 'DATA', 'STAGING_DATASET', 'Id | Date | Run | Vehicles | Service Type | Drivers | Loads | Collections Booked | Collections Performed | Not Presented | Contaminated | Total Weight | Ave Bin Weight | Bins Per Hour | Weight Per Hour | Travel Time Hrs | Collection Time Hrs | Duration | Travel Distance Kms | Collection Distance Kms | Total Distance'],
  ['Driver Run', 'driver_run', 'DATA', 'STAGING_DATASET', 'Driver Name | Employee Id | Vehicle | Run Date | Run | Run Number | Service Type | Waste Type | Shift Start Date | Shift Start Time | Shift End Date | Shift End Time | Shift Duration | Run Start Time | Run End Time | Run Time Hrs | Depot Depart Time | Depot Depart Odo | Depot Return Time | Depot Return Odo | Loads | Collections Performed | Total Weight | Travel Time Hrs | Collection Time Hrs | Travel Kms | Collection Kms | Rest 1 Date | Rest 1 Time | Rest 1 Duration Mins | Rest 2 Date | Rest 2 Time | Rest 2 Duration Mins'],
  ['Loads', 'loads', 'DATA', 'STAGING_DATASET', 'Run Name | Run Number | Service Type | Waste Type | Run Date | Load Number | Driver | Vehicle | Vehicle Rego | Depot Depart Time | Depot Depart Date | Depot Depart Odo | Mins To Col Start | Kms To Col Start | Col Start Time | Col Start Lat | Col Start Lng | Col Start Location | Col Start Odometer | Col End Time | Col End Lat | Col End Lng | Col End Location | Col End Odometer | Collection Time | Collection Distance | Collections Performed | Mins To Tip | Kms To Tip | Tip Arrival | Tip Arrive Odometer | Tip Departure | Tipping Facility | Run Net Weight | Tipping Weight Net | Tipping Weight Gross | Tipping Weight Tare | Tipping Docket | Disposal Time | Split Percentage | Global Id | Tip Depot Travel Mins | Tip Depot Travel Kms | Tip Date | Depot First Job Time Mins | Depot First Job Distance | Depot Return Date | Depot Return Time | Depot Return Odo'],
  ['Jobs', 'jobs', 'DATA', 'STAGING_DATASET', 'Id | Run Name | Run Date | Vehicle | Driver | Service Type | Service Code | Status | Property Id | Unit Number | Street No | Street Name | Suburb | Postcode | Commenced Date | Commenced Time | Completed Date | Completed Time | Duration | Job Lat | Job Lng | Collection Lat | Collection Lng | Site Collection Delta | Collections Booked | Collections Performed | Missed | Not Presented | Not Accessible | Contaminated | Allocated Sequence | Collection Sequence | Global Uuid | Exception 1 | Count 1 | Exception 2 | Count 2 | Exception 3 | Count 3 | Exception 4 | Count 4 | Exception 5 | Count 5 | Street Number | Site Category'],
  ['Tickets', 'tickets', 'DATA', 'STAGING_DATASET', 'Id | Priority | Movement | Category | Type | Asset Type | Serial | Rfid | Site Category | Property Id | Account Number | Lot Number | Unit Number | Street Number | Street Name | Suburb | Postcode | Zone | Requested Date | Requested Time | Run | Status | Closed Date | Closed Time | First Service | Final Service | Type Of Service | Notes | Other Details Columns | Created By | Call Date | Call Time | Reported By | Contact Number | Tasks Completed | Tasks Incomplete | Full Address'],
  ['Ticket Tasks', 'ticket_tasks', 'DATA', 'STAGING_DATASET', 'Ticket Id | Ticket Category | Ticket Type | Ticket Status | Call Date | Call Time | Auth Date | Auth Time | Auth Agent | Auth Result | Auth Note | Property Category | Property Id | Lot Number | Unit Number | Street Number | Address | Suburb | Postcode | Zone | Task | Task Detail | Task Result | Task Commenced | Task Completed | Handheld | User | Notes | Type Of Service | Driver Notes | Service Exceptions | Resolution Note | Notes'],
  ['Vouchers', 'vouchers', 'DATA', 'STAGING_DATASET', 'Voucher Number | Customer Name | Phone Number | Address | Status | Expiration | Service Type | Created Date | Created Time | Booked By'],
  ['Prestart Checks', 'prestart_checks', 'DATA', 'STAGING_DATASET', 'Vehicle | Driver | Result | Problem Count | Date | Time'],
  ['Contamination Inspections', 'contamination_inspections', 'DATA', 'STAGING_DATASET', 'Username | Date | Time | Property Id | Site Id | Site Full Address | Suburb | Asset Id | Asset Type Name | Serial | Result | Level | Contaminants'],
  ['Service Exception Totals', 'service_exception_totals', 'SUMMARY', 'RECONCILIATION_SUMMARY', 'Category | Garbage | Organics | Bin Repairs | Illegal Dumping | Garbage | Recycling | Sweeper | Waste Services | Waste and Recycling'],
  ['Service Exceptions', 'service_exceptions', 'DATA', 'STAGING_DATASET', 'Id | Classification | Category | Type | Recorded Date | Recorded Time | Property Id | Waste Type | Service Type | Run Name | Run Number | Service Code | Service Name | Run Date | Vehicle | Driver | Unit No | Street No | Street Name | Suburb | Postcode | Geocoded Address | Lat | Lng | Google Maps Link'],
  ['Definitions', 'definitions', 'METADATA', 'METADATA', 'Sheet | Field | Defintion | Format | 3Logix Notes'],
]
const EXPECTED_TOTAL_COLUMNS = 295

type Column = { header: string; sensitivityClass: string }
type Worksheet = { ordinal: number; logicalKey: string; name: string; role: string; disposition: string; headerRowOneBased: number | null; columns: Column[] }
const WORKSHEETS: Worksheet[] = MANIFEST.worksheets

// ── Manifest: approved structural keys only ───────────────────────────
describe('6.2D3B — manifest contains only approved structural metadata', () => {
  it('has exactly the approved top-level / nested keys (nothing else)', () => {
    expect(Object.keys(MANIFEST)).toEqual(['manifestVersion', 'phase', 'sourceSystemName', 'datasetType', 'schemaVersion', 'mappingProfile', 'draftPolicy', 'worksheets'])
    expect(Object.keys(MANIFEST.datasetType)).toEqual(['name', 'description', 'active'])
    expect(Object.keys(MANIFEST.schemaVersion)).toEqual(['versionNumber', 'label'])
    expect(Object.keys(MANIFEST.mappingProfile)).toEqual(['name'])
    for (const ws of WORKSHEETS) {
      expect(Object.keys(ws), ws.name).toEqual(['ordinal', 'logicalKey', 'name', 'role', 'disposition', 'headerRowOneBased', 'columns'])
      for (const c of ws.columns) expect(Object.keys(c), `${ws.name}/${c.header}`).toEqual(['header', 'sensitivityClass'])
    }
  })

  it('uses the authoritative plan terms exactly', () => {
    expect(MANIFEST.manifestVersion).toBe(1)
    expect(MANIFEST.sourceSystemName).toBe('City of Onkaparinga operational export')
    expect(MANIFEST.datasetType.name).toBe('Monthly waste and collection operations')
    expect(MANIFEST.datasetType.active).toBe(true)
    expect(MANIFEST.schemaVersion).toEqual({ versionNumber: 1, label: 'Version derived from the June 2026 workbook' })
    expect(MANIFEST.mappingProfile).toEqual({ name: 'June-v1 treatment' })
  })

  it('draftPolicy is exactly the D3B DRAFT/inactive/OPTIONAL/UNKNOWN policy', () => {
    expect(MANIFEST.draftPolicy).toEqual({
      schemaStatus: 'DRAFT', schemaActivatedAt: null, worksheetPresence: 'OPTIONAL', columnPresence: 'OPTIONAL',
      columnDeclaredType: 'UNKNOWN', columnLogicalFieldKey: null, profileActive: false, profileActiveVersionId: null,
      profileVersionNumber: 1, profileDocumentVersion: 1,
    })
  })

  it('carries no row counts, totals, sample values, org ids, source-system ids, credentials or personal data', () => {
    const keys: string[] = []
    const numbers: Array<[string, number]> = []
    const walk = (v: unknown, k: string) => {
      if (Array.isArray(v)) v.forEach(x => walk(x, k))
      else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) { keys.push(kk); walk(vv, kk) }
      else if (typeof v === 'number') numbers.push([k, v])
    }
    walk(MANIFEST, '')
    for (const k of keys) {
      expect(k).not.toMatch(/count|total|sample|value|example|organisation|^org|tenant|sourceSystemId|secret|token|password|credential|url|email/i)
      expect(k).not.toBe('id')
    }
    // The ONLY numbers are structural positions / versions.
    for (const [k] of numbers) expect(['manifestVersion', 'versionNumber', 'profileVersionNumber', 'profileDocumentVersion', 'ordinal', 'headerRowOneBased']).toContain(k)
    expect(MANIFEST_TEXT).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i) // uuid
    expect(MANIFEST_TEXT).not.toMatch(/\bc[a-z0-9]{24}\b/) // cuid
    expect(MANIFEST_TEXT).not.toMatch(/@|https?:|\d{5,}/) // emails, urls, phone/ids/totals
    // The only 4-digit number is the plan-mandated schema label year.
    expect(MANIFEST_TEXT.match(/\d{4}/g)).toEqual(['2026'])
  })

  it('exactly 14 sheets in the approved order with approved logical keys, roles and dispositions', () => {
    expect(WORKSHEETS.map(w => w.name)).toEqual(APPROVED.map(a => a[0]))
    WORKSHEETS.forEach((w, i) => {
      expect(w.ordinal).toBe(i)
      expect([w.logicalKey, w.role, w.disposition]).toEqual([APPROVED[i][1], APPROVED[i][2], APPROVED[i][3]])
    })
  })

  it('headers are the exact literal inventory, including duplicates and the "Defintion" typo', () => {
    WORKSHEETS.forEach((w, i) => {
      const approved = APPROVED[i][4]
      expect(w.columns.map(c => c.header), w.name).toEqual(approved === null ? [] : approved.split(' | '))
      expect(w.headerRowOneBased, w.name).toBe(approved === null ? null : 3)
    })
    const total = WORKSHEETS.reduce((n, w) => n + w.columns.length, 0)
    expect(total).toBe(EXPECTED_TOTAL_COLUMNS)
    const tt = WORKSHEETS.find(w => w.name === 'Ticket Tasks')!.columns.map(c => c.header)
    expect(tt.flatMap((h, i) => (h === 'Notes' ? [i] : []))).toEqual([27, 32])
    const set = WORKSHEETS.find(w => w.name === 'Service Exception Totals')!.columns.map(c => c.header)
    expect(set.flatMap((h, i) => (h === 'Garbage' ? [i] : []))).toEqual([1, 5])
    const defs = WORKSHEETS.find(w => w.name === 'Definitions')!.columns.map(c => c.header)
    expect(defs).toContain('Defintion')
    expect(defs).not.toContain('Definition')
  })

  it('Trends has no invented columns and a null header row', () => {
    const trends = WORKSHEETS.find(w => w.name === 'Trends')!
    expect(trends.columns).toEqual([])
    expect(trends.headerRowOneBased).toBeNull()
  })
})

// ── Sensitivity: committed values == deterministic policy ─────────────
describe('6.2D3B — sensitivity_class policy', () => {
  it('every committed class is exactly what the header-label policy yields (no hand-edited downgrade)', () => {
    for (const w of WORKSHEETS) for (const c of w.columns) {
      expect(c.sensitivityClass, `${w.name}/${c.header}`).toBe(classifyHeader(c.header))
    }
  })

  it('only CONFIDENTIAL / PERSONALLY_IDENTIFIABLE are used — never PUBLIC / INTERNAL / HIGHLY_SENSITIVE', () => {
    const classes = new Set(WORKSHEETS.flatMap(w => w.columns.map(c => c.sensitivityClass)))
    expect([...classes].sort()).toEqual(['CONFIDENTIAL', 'PERSONALLY_IDENTIFIABLE'])
    expect(MANIFEST_TEXT).not.toMatch(/"(PUBLIC|INTERNAL|HIGHLY_SENSITIVE)"/)
  })

  it('the trigger list is exactly the approved set', () => {
    expect([...PII_TRIGGER_TERMS].sort()).toEqual([
      'account', 'address', 'booked by', 'contact', 'created by', 'driver', 'employee', 'google maps', 'lat', 'lng', 'location', 'lot',
      'name', 'note', 'notes', 'phone', 'postcode', 'property', 'reported by', 'street', 'suburb', 'unit', 'user', 'username',
    ])
  })

  it('obvious person/contact/address/property/location/notes headers are PERSONALLY_IDENTIFIABLE', () => {
    for (const h of ['Driver Name', 'Employee Id', 'Drivers', 'Driver', 'Customer Name', 'Phone Number', 'Contact Number', 'Full Address', 'Address',
      'Site Full Address', 'Geocoded Address', 'Street Name', 'Street No', 'Suburb', 'Postcode', 'Property Id', 'Account Number', 'Lot Number',
      'Unit Number', 'Unit No', 'Created By', 'Reported By', 'Booked By', 'User', 'Username', 'Notes', 'Auth Note', 'Driver Notes',
      'Resolution Note', '3Logix Notes', 'Lat', 'Lng', 'Job Lat', 'Col Start Lng', 'Col End Location', 'Google Maps Link']) {
      expect(classifyHeader(h), h).toBe('PERSONALLY_IDENTIFIABLE')
    }
  })

  it('whole-token matching: no substring false positives on operational measures', () => {
    for (const h of ['Contam Rate', 'Total Weight', 'Total Distance', 'Allocated Sequence', 'Service Type', 'Id', 'Collections Performed',
      'Vehicle', 'Status', 'Garbage', 'Defintion', 'Rfid', 'Split Percentage', 'Tipping Docket', 'Contaminated', 'Contaminants']) {
      expect(matchedPiiTerms(h), h).toEqual([])
      expect(classifyHeader(h), h).toBe('CONFIDENTIAL')
    }
  })
})

// ── Seed SQL ──────────────────────────────────────────────────────────
describe('6.2D3B — seed SQL', () => {
  it('embeds the manifest byte-identically (single source of truth)', () => {
    expect(SEED.indexOf(MANIFEST_OPEN)).toBeGreaterThan(-1)
    expect(EMBEDDED_MANIFEST).toBe(MANIFEST_TEXT)
    expect(SEED.split(MANIFEST_OPEN).length).toBe(2)
  })

  it('hard-codes the DRAFT policy independently and it equals the manifest draftPolicy', () => {
    const m = ACTIVE_SQL.match(/c_draft_policy CONSTANT jsonb := '([^']+)';/)
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1])).toEqual(MANIFEST.draftPolicy)
  })

  it('is a single BEGIN/COMMIT transaction around one DO block', () => {
    expect(ACTIVE_SQL.match(/^BEGIN;$/gm)).toHaveLength(1)
    expect(ACTIVE_SQL.match(/^COMMIT;$/gm)).toHaveLength(1)
    expect(ACTIVE_SQL.match(/\bDO \$d3b\$/g)).toHaveLength(1)
    expect(ACTIVE_SQL.indexOf('BEGIN;')).toBeLessThan(ACTIVE_SQL.indexOf('DO $d3b$'))
    expect(ACTIVE_SQL.indexOf('$d3b$;')).toBeLessThan(ACTIVE_SQL.indexOf('COMMIT;'))
  })

  it('is INSERT-only configuration: no UPDATE / DELETE / TRUNCATE / DROP / ALTER / permanent CREATE', () => {
    // (ON COMMIT DROP only scopes the session temp tables.)
    expect(ACTIVE_SQL.replace(/ON COMMIT DROP/g, '')).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|\bDROP\b|\bALTER\b|\bUPSERT\b|ON CONFLICT/i)
    expect(ACTIVE_SQL).not.toMatch(/CREATE\s+(?!TEMP TABLE d3b_exp_)/)
    expect(ACTIVE_SQL.match(/CREATE TEMP TABLE d3b_exp_\w+ ON COMMIT DROP/g)).toHaveLength(4)
    const inserts = [...ACTIVE_SQL.matchAll(/INSERT INTO (public\.\w+)/g)].map(m => m[1])
    expect(inserts).toEqual([
      'public.dataset_types', 'public.source_schema_versions', 'public.source_schema_worksheets',
      'public.source_schema_columns', 'public.worksheet_mapping_profiles', 'public.worksheet_mapping_profile_versions',
    ])
  })

  it('never references ImportBatch, reporting_period_required, SourceMapping / MappingVersion or Uploads in executable SQL', () => {
    expect(ACTIVE_SQL).not.toMatch(/import_batches|reporting_period|source_mappings|mapping_versions|mapping_document|uploads/i)
  })

  it('locates the SourceSystem by exact name, requiring exactly one ACTIVE row — no hard-coded org / source ids', () => {
    expect(ACTIVE_SQL).toContain("SELECT count(*) INTO v_n FROM public.source_systems WHERE name = v_ss_name AND active;")
    expect(ACTIVE_SQL).toMatch(/IF v_n <> 1 THEN\s*\n\s*RAISE EXCEPTION 'D3B seed: expected exactly one active source_systems row/)
    expect(ACTIVE_SQL).not.toMatch(/organisation_id\s*=\s*'|source_system_id\s*=\s*'|'org-|'ss-/)
    expect(ACTIVE_SQL).not.toMatch(/\bc[a-z0-9]{24}\b|[0-9a-f]{8}-[0-9a-f]{4}-/i)
  })

  it('uses only deterministic dhcfg-onk-mwco- ids', () => {
    for (const m of ACTIVE_SQL.matchAll(/'(dhcfg-[^']*)'/g)) expect(m[1]).toMatch(/^dhcfg-onk-mwco-(%|dt|sv1|)$/)
    expect(ACTIVE_SQL).toContain("c_dt_id     CONSTANT text := 'dhcfg-onk-mwco-dt';")
    expect(ACTIVE_SQL).toContain("c_sv_id     CONSTANT text := 'dhcfg-onk-mwco-sv1';")
  })

  it('inserts the schema DRAFT with NULL activated_at, and profiles inactive with NULL pointers', () => {
    expect(ACTIVE_SQL).toContain("VALUES (c_sv_id, v_org_id, c_dt_id, 1, v_sv_label, 'DRAFT', NULL, NULL);")
    expect(ACTIVE_SQL).toMatch(/false AS active,\s*\n\s*NULL::text AS active_profile_version_id/)
    expect(ACTIVE_SQL).toMatch(/'OPTIONAL'::text AS presence,\s*\n\s*'UNKNOWN'::text AS declared_type/)
    expect(ACTIVE_SQL).toContain('NULL::text AS logical_field_key')
    expect(ACTIVE_SQL).toContain("jsonb_build_object('documentVersion', 1, 'schemaStatus', 'DRAFT', 'headerRowOneBased', ws->'headerRowOneBased')")
    expect(ACTIVE_SQL).not.toMatch(/'ACTIVE'|'REQUIRED'|now\(\)/)
  })

  it('fails loud on partial state: FRESH only when nothing D3B exists, then always validates exactly', () => {
    expect(ACTIVE_SQL).toContain('IF v_n = 0 AND v_hits = 0 THEN')
    for (const t of ['source_schema_worksheets', 'source_schema_columns', 'worksheet_mapping_profiles', 'worksheet_mapping_profile_versions']) {
      expect(ACTIVE_SQL).toContain(`RAISE EXCEPTION 'D3B seed: ${t} differ from the governed`)
    }
    // Validation runs after the IF (i.e. on BOTH paths), never inside it.
    const freshIf = ACTIVE_SQL.indexOf('IF v_n = 0 AND v_hits = 0 THEN')
    expect(ACTIVE_SQL.indexOf("expected exactly one D3B dataset_types row")).toBeGreaterThan(ACTIVE_SQL.indexOf('END IF;', freshIf))
  })
})

// ── Runtime boundary ──────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('6.2D3B — no runtime consumer; XLSX mapping/confirm/import remain disabled', () => {
  const runtimeFiles = ['app', 'lib', 'modules', 'components']
    .map(d => path.join(REPO_ROOT, d))
    .filter(d => fs.existsSync(d))
    .flatMap(d => walk(d))

  it('no app/lib/modules/components file imports or mentions the D3B manifest, config dir, seed or policy helper', () => {
    expect(runtimeFiles.length).toBeGreaterThan(50)
    const forbidden = /onkaparinga-monthly-operations-v1|config\/data-hub|seed-datahub-onkaparinga-schema-v1|dataHubOnkaparingaSchemaV1Policy|dhcfg-onk-mwco|June-v1 treatment|Monthly waste and collection operations/
    const offenders = runtimeFiles.filter(f => forbidden.test(fs.readFileSync(f, 'utf-8'))).map(f => path.relative(REPO_ROOT, f))
    expect(offenders).toEqual([])
  })

  it('the policy helper has no imports (pure, test-side only)', () => {
    expect(readSource('tests/helpers/dataHubOnkaparingaSchemaV1Policy.ts')).not.toMatch(/^\s*import\b|require\(/m)
  })

  it('selectWorksheetMapping keeps its CSV-only format gate (XLSX mapping selection rejected)', () => {
    const src = readSource('lib/data-hub/importBatch/selectWorksheetMapping.ts')
    expect(src).toMatch(/if \(batch\.content_type !== "csv"\) \{\s*\n\s*return fail\("UNSUPPORTED_FORMAT"\);/)
    expect(src).not.toMatch(/profile|DatasetType|dataset_type|SourceSchema|source_schema/i)
  })

  it('confirmWorksheet keeps its CSV-only format gate (XLSX confirmation/import rejected) and reporting-period gate', () => {
    const src = readSource('lib/data-hub/importBatch/confirmWorksheet.ts')
    expect(src).toMatch(/if \(batch\.content_type !== "csv"\) \{\s*\n\s*return fail\("UNSUPPORTED_FORMAT"\);/)
    expect(src).not.toMatch(/^import[^;]*(workbookParser|["']xlsx["'])/m)
    expect(src).not.toMatch(/profile|DatasetType|dataset_type|SourceSchema|source_schema/i)
    expect(src).toContain('reporting_period_required === true')
  })
})

// ── The behavioral proof exists and covers the required cases ─────────
describe('6.2D3B — disposable Postgres harness coverage', () => {
  it('uses a disposable postgres:16-alpine container on top of the real D3A foundation; never a real database', () => {
    expect(HARNESS).toContain('postgres:16-alpine')
    expect(HARNESS).toContain('trap cleanup EXIT')
    expect(HARNESS).toContain('scripts/create-datahub-source-schema-profiles.sql')
    expect(HARNESS).toContain('scripts/seed-datahub-onkaparinga-schema-v1.sql')
    expect(HARNESS).not.toMatch(/DATABASE_URL|neon\.tech|vercel\.app|vercel env|psql -h/i)
    expect(HARNESS).toContain(`EXPECTED_COLUMNS=${EXPECTED_TOTAL_COLUMNS}`)
  })

  it('covers apply, zero-write rerun, exact state, untouched lineage, drift, SourceSystem resolution and atomic rollback', () => {
    for (const marker of [
      'seed applies cleanly on the D3A foundation',
      'reruns performed ZERO writes',
      'negative control: the fingerprint DOES change',
      'exactly 1 DatasetType, 1 SchemaVersion, 14 worksheets',
      'status DRAFT, activated_at NULL',
      'every one OPTIONAL',
      'exact roles and dispositions per worksheet',
      'active=false, active_profile_version_id NULL',
      'every column is OPTIONAL, UNKNOWN-typed',
      'no column sensitivity outside CONFIDENTIAL / PERSONALLY_IDENTIFIABLE',
      'duplicate headers preserved at separate ordinals',
      'Trends has zero column rows and headerRowOneBased null',
      'no ImportBatch lineage populated',
      'reporting_period_required unchanged',
      'SourceMapping / MappingVersion / Upload rows byte-identical',
      'one governed column deleted (partial state)',
      'extra manual worksheet added under schema version 1',
      'natural-key row with a different id is never silently adopted',
      'missing SourceSystem',
      'duplicate active SourceSystems',
      'transaction rollback left ZERO rows in all six config tables',
    ]) {
      expect(HARNESS, marker).toContain(marker)
    }
  })
})
