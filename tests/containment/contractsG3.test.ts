import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

// G3 source-level contracts (complements tests/components/app/ContractsG3.test.tsx
// and the existing function-body pins in remainingVisualIslandsC.test.ts,
// which were independently re-verified against `git show ecb5b03:<file>`).
// Every hash below was computed from the BASE source (commit ecb5b03),
// CRLF-normalised, and pins data/behaviour segments the existing pins do not
// cover: data maps, component state declarations, and the /reports server
// query + component preamble.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function segment(src: string, start: string, end: string): string {
  const i = src.indexOf(start)
  expect(i, `start marker ${start}`).toBeGreaterThanOrEqual(0)
  const j = src.indexOf(end, i)
  expect(j, `end marker ${JSON.stringify(end)}`).toBeGreaterThan(i)
  return src.slice(i, j)
}

const cases: Array<[string, string, string, string, string]> = [
  ['app/briefings/BriefingsClient.tsx', 'AGENT_ICON / TYPE_LABELS / FILTERS / types', 'const AGENT_ICON', 'function timeAgo',
    '9133f3536112d576e9946600dd75c5063d9ca33e1efe7177a0931fac97dd4b94'],
  ['app/briefings/BriefingsClient.tsx', 'BriefingsClient state', 'export default function BriefingsClient', '  const load = useCallback',
    '54b80571f9e9cb9c091218744b5066063a002069f01abdae448a371d0b877480'],
  ['app/data/DataClient.tsx', 'types + REPORT_TYPES', 'type UploadedFile', '\n];\n',
    '95d7bc35ea2db15744db7cb236ef4fe6cf6a16fc729de73c92a2794c15f8836b'],
  ['app/data/DataClient.tsx', 'DataClient state + refs', 'export default function DataClient', '  const loadFiles',
    '71c7f3f2a6aad014dc338355d26ff1df1fd16b00ddab6da1a18d1f432e895c8d'],
  ['app/portal/page.tsx', 'types + TYPE_OPTIONS', 'type Message', '\n]\n',
    '05eaaed7bd5652dc746c243cd1f0b1f32608027ada789234289d4729acf4eb16'],
  ['app/portal/page.tsx', 'PortalPage state', 'export default function PortalPage', '  useEffect(() => {',
    'f146edca5a66c11fec8085a22ec458629dc86d900c18f53e2baff83e70edcf5b'],
  ['app/reports/page.tsx', 'session gate + org-scoped query', 'export default async function ReportsPage', '  return (\n',
    'fd1c0a93ca569fbe7efbfedc4da5f3ca80f7825729cbb0f5e9ab2db5cf2ec90f'],
  ['app/reports/page.tsx', 'TYPE_LABELS', 'const TYPE_LABELS', '\n};\n',
    'f230b0fc0d3d49e91a8575f2b987c271c5b7c47e54c3e6a24624ecc289daadd9'],
  ['app/reports/page.tsx', 'TYPE_COLORS', 'const TYPE_COLORS', '\n};\n',
    '85ef39b8026042d547972f6c33f430e09a9298cc2b53d85c7c8dfaca2e01364f'],
  ['app/reports/[id]/ReportView.tsx', 'TYPE_LABELS + Props', 'const TYPE_LABELS', 'function renderMarkdown',
    '13d8e6940b9aff9f5e39b922b205aa6a6271f98d013c375d7bcea89334579743'],
  ['app/reports/[id]/ReportView.tsx', 'ReportView signature + state', 'export default function ReportView', '  async function handleDelete',
    '78e695ce787f874cdc683e6ac52e85df3e0aa9382b2c5a9be7935f8b215f56e6'],
]

describe('G3 contracts — base data/state segments are byte-identical', () => {
  for (const [rel, what, start, end, hash] of cases) {
    it(`${rel}: ${what}`, () => {
      expect(sha(segment(read(rel), start, end))).toBe(hash)
    })
  }
})

describe('G3 contracts — wiring', () => {
  it('/reports/[id]: the generated body is the only dangerouslySetInnerHTML and uses renderMarkdown(content)', () => {
    const src = read('app/reports/[id]/ReportView.tsx')
    expect(src.match(/dangerouslySetInnerHTML/g) ?? []).toHaveLength(1)
    expect(src).toContain('dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}')
    expect(src.match(/onClick=\{handlePdfExport\}/g) ?? []).toHaveLength(1)
  })

  it('/briefings: export still uses the shared evidence-report generator', () => {
    expect(read('app/briefings/BriefingsClient.tsx')).toContain("import { generateReportHTML } from '../../lib/evidence-report'")
  })
})
