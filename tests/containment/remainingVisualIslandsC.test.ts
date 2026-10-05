import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

// Remaining visual islands pass — worker C surfaces:
//   4A /briefings  (app/briefings/BriefingsClient.tsx)
//   4B /data       (app/data/DataClient.tsx)
//   4C /portal     (app/portal/page.tsx)
//   4D /reports    (app/reports/page.tsx) + /reports/[id] chrome (ReportView.tsx)
// Each used to be a dark-only island: private hex slabs (#07080B / #0e1014 /
// #1a1d24 / #06070F / #111318), white-alpha neutrals, old violet / indigo
// chrome, local Inter font stacks, a decorative gradient rule, outline
// suppression and clickable <div>s. This guard keeps those out while
// allowing exactly the documented DATA encodings:
//   - BriefingsClient AGENT_COLOR (+ DEFAULT_AGENT_COLOR): agent identity
//   - reports/page.tsx TYPE_COLORS (+ its '#9ca3af' fallback): report category
// Both only colour decorative glyphs/dots — never text.
// It also pins the behaviour the visual work relied on: every data-flow
// function body is hashed and must equal the pre-pass source byte-for-byte.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

const BRIEFINGS = 'app/briefings/BriefingsClient.tsx'
const DATA = 'app/data/DataClient.tsx'
const PORTAL = 'app/portal/page.tsx'
const REPORTS = 'app/reports/page.tsx'
const REPORT_VIEW = 'app/reports/[id]/ReportView.tsx'
const CSS = [
  'app/briefings/Briefings.module.css',
  'app/data/Data.module.css',
  'app/portal/Portal.module.css',
  'app/reports/Reports.module.css',
  'app/reports/[id]/ReportView.module.css',
]
const TSX = [BRIEFINGS, DATA, PORTAL, REPORTS, REPORT_VIEW]
const ALL = [...TSX, ...CSS]

const AGENT_MAP = /^const AGENT_COLOR: Record<string, string> = \{\n(?: {2}\w+: +'#[0-9A-Fa-f]{6}',\n){5}\};$/m
const AGENT_DEFAULT = /^const DEFAULT_AGENT_COLOR = '#6366F1';$/m
const TYPE_MAP = /^const TYPE_COLORS: Record<string, string> = \{\n(?: {2}\w+: +'#[0-9a-f]{6}',\n){5}\};$/m
const TYPE_FALLBACK = "const typeColor = TYPE_COLORS[String(r.report_type)] ?? '#9ca3af';"

/** Comment-stripped source with the documented data encodings removed. */
function surface(rel: string): string {
  return stripComments(read(rel))
    .replace(AGENT_MAP, '')
    .replace(AGENT_DEFAULT, '')
    .replace(TYPE_MAP, '')
    .replace(TYPE_FALLBACK, '')
}

const ANY_HEX = /#[0-9a-f]{3,8}\b/i
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|818CF8|6366F1)\b|rgba?\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241)/i
const WHITE_ALPHA = /rgba?\(\s*255\s*,\s*255\s*,\s*255/i
const DARK_SLABS = /#(07080B|08090C|0a0a0f|0e1014|13131a|1a1d24|06070F|111318|1f2937)\b/i

describe('remaining islands C — documented data encodings are the only colour literals', () => {
  it('AGENT_COLOR / DEFAULT_AGENT_COLOR are declared exactly once and only feed the glyph + dot', () => {
    const src = stripComments(read(BRIEFINGS))
    expect(src.match(new RegExp(AGENT_MAP.source, 'gm')) ?? []).toHaveLength(1)
    expect(src.match(new RegExp(AGENT_DEFAULT.source, 'gm')) ?? []).toHaveLength(1)
    // `color` (the agent hue) is only used as the icon colour and the dot fill.
    const uses = src.match(/\{\s*(?:color|background: color)\s*\}/g) ?? []
    expect(uses.sort()).toEqual(['{ background: color }', '{ color }'])
    expect(src).toContain('<span className={styles.agentIcon} style={{ color }} aria-hidden="true">{icon}</span>')
    expect(src).toContain('<span className={styles.agentDot} style={{ background: color }} aria-hidden="true" />')
  })

  it('TYPE_COLORS is declared exactly once and only feeds the decorative type dot', () => {
    const src = stripComments(read(REPORTS))
    expect(src.match(new RegExp(TYPE_MAP.source, 'gm')) ?? []).toHaveLength(1)
    expect(src).toContain(TYPE_FALLBACK)
    expect(src.match(/typeColor/g) ?? []).toHaveLength(2)
    expect(src).toContain('<span className={styles.typeDot} style={{ background: typeColor }} aria-hidden="true" />')
  })

  for (const rel of ALL) {
    it(`${rel}: no hex literal outside the documented maps`, () => {
      expect(surface(rel)).not.toMatch(ANY_HEX)
    })
    it(`${rel}: no old violet / indigo chrome, white-alpha neutrals, dark slabs or black alpha`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(OLD_VIOLET)
      expect(src).not.toMatch(WHITE_ALPHA)
      expect(src).not.toMatch(DARK_SLABS)
      expect(src).not.toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,/)
    })
    it(`${rel}: no forced dark scheme, blur/glass, gradients or glow`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(/colorScheme\s*:|color-scheme\s*:/)
      expect(src).not.toMatch(/backdrop|blur\(/i)
      expect(src).not.toMatch(/gradient\(/i)
      expect(src).not.toMatch(/(boxShadow|box-shadow)\s*:[^;\n]*\b0 0 \d+px/)
    })
    it(`${rel}: no outline suppression and no local font stacks`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(/outline\s*:\s*['"]?(none|0)\b/)
      expect(src).not.toMatch(/--font-inter|\bInter\b|-apple-system|BlinkMacSystemFont|'Segoe UI'|\bmonospace\b/)
    })
  }

  for (const rel of TSX) {
    it(`${rel}: no inline colour/font styling, Tailwind dark-only classes or const FONT`, () => {
      const src = surface(rel)
      expect(src).not.toMatch(/\bconst (FONT|BG|CARD|BORDER)\b/)
      expect(src).not.toMatch(/\b(text-white|bg-black|bg-\[#)/)
      expect(src).not.toMatch(/style=\{\{[^}]*\b(color|background|border|fontFamily)\s*:\s*['`]/)
      expect(src).not.toMatch(/<style>/)
    })
    it(`${rel}: exactly one page h1, via the shared PageHeader`, () => {
      // renderMarkdown's '<h1>$1</h1>' is generated report CONTENT, not page chrome.
      const src = surface(rel).replace(/function renderMarkdown[\s\S]*?\n}\n/, '')
      const pageHeaders = (src.match(/<PageHeader\b/g) ?? []).length
      const rawH1 = (src.match(/<h1\b/g) ?? []).length
      // DataClient's session-expired branch replaces the whole page and owns its own h1.
      expect(pageHeaders).toBe(1)
      expect(rawH1).toBe(rel === DATA ? 1 : 0)
    })
  }

  it('selected segmented controls use raised surface + accent border + accent text (not outline)', () => {
    for (const [rel, sel] of [
      ['app/briefings/Briefings.module.css', ".filter[aria-pressed='true']"],
      ['app/portal/Portal.module.css', ".typeButton[aria-pressed='true']"],
    ] as const) {
      const css = stripComments(read(rel))
      const rule = css.slice(css.indexOf(sel + ' {'), css.indexOf('}', css.indexOf(sel + ' {')) + 1)
      expect(rule, rel).toMatch(/background:\s*var\(--bg-surface\)/)
      expect(rule, rel).toMatch(/border-color:\s*var\(--brand-brainbase-accent-border\)/)
      expect(rule, rel).toMatch(/color:\s*var\(--brand-brainbase-accent\)/)
      expect(rule, rel).not.toMatch(/outline|box-shadow/)
    }
  })
})

// ── Behaviour preserved (hashes of the pre-pass function bodies) ────────

function segment(src: string, start: string, end: string): string {
  const i = src.indexOf(start)
  expect(i, `start marker ${start}`).toBeGreaterThanOrEqual(0)
  const j = src.indexOf(end, i)
  expect(j, `end marker ${end}`).toBeGreaterThan(i)
  return src.slice(i, j)
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('remaining islands C — data flow is byte-identical to the pre-pass source', () => {
  const cases: Array<[string, string, string, string]> = [
    [DATA, '  const loadFiles = useCallback', '  if (sessionExpired) {', '9272e04e61198a51efc97d75dc99bd31bcbb4a75b8a1a895080b6465cd1f115d'],
    [PORTAL, '  useEffect(() => {', '  return (\n', '9f316f92f5d0f444ebbc548c537ba7d07861a3f031a7fc746f0ab2753ab3a8b9'],
    [PORTAL, 'function fmtDate', 'd ago`\n}', '9ed27bb8ffc579405accae32498543e97168b596d3c52f67eda2f787313ba7fc'],
    [BRIEFINGS, '  function exportReport()', '  return (\n', 'bae25923b1e3adc24e0da958af0631b893d8fbc3a7979ecdc2f034c0530499bd'],
    [BRIEFINGS, '  const load = useCallback', '  return (\n', 'd1971638e9a29431363f7f732e697e1150a0afa9fedb7aa9abecff09e6382a0a'],
    [BRIEFINGS, 'function timeAgo', '\nfunction EvidencePanel', 'fdf78b119890f771c205d84331670f754006d5798fba3613c400fa4a28d4e0b3'],
    [REPORT_VIEW, 'function renderMarkdown', '\nexport default function', 'b953df80b7e2e2ef584446eceaddb92da59617186ce1b57c63fe88f02516c66a'],
    [REPORT_VIEW, '  async function handleDelete', '  return (\n', '0e515c60d14087c026f889fb589313cfd18f24cf656fbe5b2469c90cc7d97baf'],
  ]
  for (const [rel, start, end, hash] of cases) {
    it(`${rel}: ${start.trim().slice(0, 32)}… unchanged`, () => {
      expect(sha(segment(read(rel), start, end))).toBe(hash)
    })
  }
})

describe('remaining islands C — wiring the new markup depends on', () => {
  it('/briefings: filters, card toggles and actions keep their handlers', () => {
    const src = read(BRIEFINGS)
    expect(src).toContain('onClick={() => setFilter(f.key)}')
    expect(src).toContain('aria-pressed={active}')
    expect(src).toContain('onClick={() => setOpen(p => !p)}')
    expect(src).toContain('onClick={() => setEvidenceOpen(p => !p)}')
    expect(src).toContain('<Button size="sm" variant="secondary" onClick={exportReport}>')
    expect(src).toContain('<Button size="sm" variant="danger" onClick={() => onDelete(b.id)}>')
    expect(src).toContain('<BriefingCard key={b.id} b={b} onDelete={deleteBriefing} />')
    expect(src).toContain("import { generateReportHTML } from '../../lib/evidence-report'")
    for (const k of ["{ key: null,         label: 'All' }", "{ key: 'briefing',  label: 'Briefing' }", "{ key: 'chat',      label: 'Chat' }"]) {
      expect(src).toContain(k)
    }
  })

  it('/data: upload zone, table actions, permission gate and report dialog keep their handlers', () => {
    const src = read(DATA)
    expect(src).toContain("onDragOver={e => { e.preventDefault(); setDragging(true); }}")
    expect(src).toContain('onDragLeave={() => setDragging(false)}')
    expect(src).toContain('onDrop={onDrop}')
    expect(src).toContain('onClick={() => fileInputRef.current?.click()}')
    expect(src).toContain('accept=".xlsx,.xls,.csv"')
    expect(src).toContain("onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}")
    expect(src).toContain('onClick={() => handleViewRecords(f)}')
    expect(src).toContain('{canDelete && (')
    expect(src).toContain('onClick={() => handleDelete(f.id)}')
    expect(src).toContain("{f.upload_status === 'complete' && (")
    expect(src).toContain('onClick={() => setShowReportModal(true)}')
    expect(src).toContain('disabled={noCompleteFiles}')
    expect(src).toContain("const noCompleteFiles = files.filter(f => f.upload_status === 'complete').length === 0;")
    expect(src).toContain('<Dialog open={showReportModal} onClose={() => setShowReportModal(false)} title="Generate Report"')
    expect(src).toContain('onClick={handleGenerateReport}')
    expect(src).toContain('disabled={generating}')
    expect(src).toContain("await fetch('/api/auth/logout', { method: 'POST' });")
    expect(src).toContain("router.push('/login');")
    for (const v of ['waste_summary', 'contamination', 'cost_analysis', 'diversion_rate', 'custom']) expect(src).toContain(`value: '${v}'`)
    expect(read('app/data/page.tsx')).toContain('return <DataClient canDelete={isAdmin} />;')
  })

  it('/portal: request, reply and booking controls keep their handlers', () => {
    const src = read(PORTAL)
    expect(src).toContain('onClick={() => setShowForm(f => !f)}')
    expect(src).toContain('onClick={() => setType(t.value)}')
    expect(src).toContain('onClick={submit}')
    expect(src).toContain('disabled={!title.trim() || submitting}')
    expect(src).toContain('onClick={() => open(req)}')
    expect(src).toContain('onClick={() => confirmBooking(req, booking.id)}')
    expect(src).toContain('onClick={() => openReschedule(req.id)}')
    expect(src).toContain('onClick={() => requestReschedule(req, booking.id)}')
    expect(src).toContain('onClick={() => setReschedule(s => ({ ...s, [req.id]: { ...s[req.id], show: false } }))}')
    expect(src).toContain('onClick={() => sendReply(req)}')
    expect(src).toContain("disabled={!(replies[req.id] ?? '').trim() || sending[req.id]}")
    expect(src).toContain("{req.status !== 'resolved' && (")
    for (const l of ["label: 'New'", "label: 'In progress'", "label: 'Awaiting your reply'", "label: 'Resolved'", "label: 'Awaiting confirmation'", "label: '✅ Confirmed'", "label: '🔁 Awaiting new time'", "label: 'Cancelled'"]) {
      expect(src).toContain(l)
    }
  })

  it('/reports/[id]: generated content is rendered unchanged; chrome keeps its handlers', () => {
    const src = read(REPORT_VIEW)
    expect(src).toContain('dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}')
    expect(src).toContain('onClick={handlePdfExport} disabled={exportingPdf}')
    expect(src).toContain('{canDelete && (')
    expect(src).toContain('onClick={handleDelete} disabled={deleting}')
    expect(src).toContain('<Link href="/reports"')
  })
})
