import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { HELP_ENTRIES, getHelpEntry, helpHref, resolveHelpHref, slugifyHeading } from '@/lib/assurance/help/registry'
import { parseHelpMarkdown, inlineText, type HelpBlock, type HelpInline } from '@/lib/assurance/help/markdown'
import { buildHelpSections, helpQueryTerms, searchHelp, MAX_QUERY_LENGTH } from '@/lib/assurance/help/search'
import { HELP_TOPICS } from '@/lib/assurance/help/topics'
import { loadAllHelpDocs, loadHelpDoc, searchAssuranceHelp } from '@/lib/assurance/help/content'

// BrainBase Assurance in-app Help — registry, limited Markdown, link safety,
// search, and integrity of the real docs/assurance content.

const ROOT = path.resolve(__dirname, '../..')
const HELP_ROOT = path.join(ROOT, 'docs', 'assurance')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const parse = (md: string, from = 'user-guide.md') => parseHelpMarkdown(md, h => resolveHelpHref(h, from), slugifyHeading)

function walkMd(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMd(p))
    else if (e.name.endsWith('.md')) out.push(path.relative(HELP_ROOT, p).split(path.sep).join('/'))
  }
  return out
}

function allInlines(blocks: HelpBlock[]): HelpInline[] {
  const out: HelpInline[] = []
  const visit = (ns: HelpInline[]) => { for (const n of ns) { out.push(n); if (n.type === 'strong' || n.type === 'link') visit(n.children) } }
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'paragraph') visit(b.children)
    else if (b.type === 'list') b.items.forEach(i => out.push(...allInlines(i)))
    else if (b.type === 'table') { b.header.forEach(visit); b.rows.forEach(r => r.forEach(visit)) }
    else if (b.type === 'blockquote') out.push(...allInlines(b.children))
  }
  return out
}

describe('registry: explicit slug → file allow-list', () => {
  it('every Markdown file under docs/assurance is registered, and every entry exists', () => {
    const files = walkMd(HELP_ROOT).sort()
    expect(HELP_ENTRIES.map(e => e.file).sort()).toEqual(files)
    expect(new Set(HELP_ENTRIES.map(e => e.slug)).size).toBe(HELP_ENTRIES.length)
    for (const e of HELP_ENTRIES) expect(e.slug).toMatch(/^[a-z0-9-]+$/)
  })
  it('lookup is exact: paths, traversal, case variants and prototype keys are not found', () => {
    for (const bad of ['README.md', '../README', '..%2fREADME', 'user-guide.md', 'work-instructions/01-report-an-incident', 'User-Guide',
      'user-guide/', ' user-guide', '__proto__', 'constructor', 'toString', '', 'x'.repeat(200), null, undefined, 42, ['user-guide']]) {
      expect(getHelpEntry(bad), String(bad)).toBeNull()
    }
    expect(getHelpEntry('user-guide')?.file).toBe('user-guide.md')
  })
  it('the loader never derives a path from the request: it reads only registry file literals inside docs/assurance', () => {
    const src = stripComments(read('lib/assurance/help/content.ts'))
    expect(src).toMatch(/path\.resolve\(HELP_ROOT, entry\.file\)/)
    expect(src).toMatch(/full\.startsWith\(HELP_ROOT \+ path\.sep\)/)
    expect(src.match(/readFileSync\(/g)).toHaveLength(1)
    expect(src).not.toMatch(/readFileSync\([^)]*slug/)
    expect(loadHelpDoc('../../package.json')).toBeNull()
    expect(loadHelpDoc('../README')).toBeNull()
  })
})

describe('link resolution: only registered docs, same-page anchors and https', () => {
  it('rejects unsafe schemes and forms', () => {
    for (const href of [
      'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'javascript&colon;alert(1)',
      'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'vbscript:msgbox(1)', 'http://example.com',
      'mailto:a@b.c', 'ftp://x', '//evil.example/x', '/admin', '\\\\evil\\share', '../../package.json', '../../../etc/passwd.md',
      'unknown.md', 'user-guide.md#Bad Anchor', 'user-guide.md#a#b', '#<script>', 'x'.repeat(600),
    ]) {
      expect(resolveHelpHref(href, 'user-guide.md'), href).toBeNull()
    }
  })
  it('resolves registered documents (relative to the source file), anchors, the work-instruction list and https', () => {
    expect(resolveHelpHref('admin-guide.md', 'README.md')).toEqual({ kind: 'internal', href: '/assurance/help/admin-guide' })
    expect(resolveHelpHref('work-instructions/10-manage-inspection-and-audit-templates.md', 'admin-guide.md'))
      .toEqual({ kind: 'internal', href: '/assurance/help/manage-templates' })
    expect(resolveHelpHref('05-raise-and-manage-a-finding.md', 'work-instructions/03-run-an-inspection.md'))
      .toEqual({ kind: 'internal', href: '/assurance/help/raise-and-manage-a-finding' })
    expect(resolveHelpHref('../user-guide.md#incidents', 'work-instructions/01-report-an-incident.md'))
      .toEqual({ kind: 'internal', href: '/assurance/help/user-guide#incidents' })
    expect(resolveHelpHref('work-instructions/', 'README.md')).toEqual({ kind: 'internal', href: '/assurance/help#work-instructions' })
    expect(resolveHelpHref('#status', 'user-guide.md')).toEqual({ kind: 'internal', href: '#status' })
    expect(resolveHelpHref('https://example.com/a', 'user-guide.md')).toEqual({ kind: 'external', href: 'https://example.com/a' })
  })
})

describe('limited Markdown: escaping, unsafe links, malformed input', () => {
  it('raw HTML is never interpreted — it stays literal text', () => {
    const d = parse('Hello <script>alert(1)</script> <img src=x onerror=alert(1)> <b>bold</b>')
    expect(d.blocks).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'Hello <script>alert(1)</script> <img src=x onerror=alert(1)> <b>bold</b>' }] }])
  })
  it('an unsafe link keeps only its text; a safe link resolves', () => {
    const d = parse('[click](javascript:alert(1)) and [data](data:text/html,x) and [guide](admin-guide.md)')
    const nodes = allInlines(d.blocks)
    const links = nodes.filter(n => n.type === 'link')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ href: { kind: 'internal', href: '/assurance/help/admin-guide' } })
    expect(inlineText((d.blocks[0] as { children: HelpInline[] }).children)).toBe('click and data and guide')
  })
  it('unsupported syntax degrades to text: images, single-star emphasis, reference links, autolinks', () => {
    const d = parse('![alt](https://x/y.png) *em* _u_ [ref][1] <https://x.y>')
    const t = allInlines(d.blocks)
    expect(t.some(n => n.type === 'link')).toBe(true) // "[alt](https…)" after "!" is a plain https link at most
    expect(inlineText((d.blocks[0] as { children: HelpInline[] }).children)).toContain('*em* _u_ [ref][1] <https://x.y>')
  })
  it('malformed Markdown never throws and never loses text', () => {
    const cases = [
      '**unclosed bold', '`unclosed code', '[unclosed link', '[text](unclosed', '```\nunclosed fence\n<script>',
      '| a | b |\n|---|---|\n| only one cell', '> > > > > > > > > > deep', '-\n-\n1.', '#', '####### seven hashes',
      '1. a\n   - b\n      - c\n         - d\n            - e\n               - f\n                  - g\n                     - h',
      '\u0000\u0001 control', '[a]([b](c))', '**a [b](user-guide.md) c**',
    ]
    for (const md of cases) {
      const d = parse(md)
      expect(Array.isArray(d.blocks), md).toBe(true)
    }
    const code = parse('```\n<script>x</script>\n')
    expect(code.blocks[0]).toEqual({ type: 'code', text: '<script>x</script>\n' })
    const bold = parse('**unclosed bold')
    expect(inlineText((bold.blocks[0] as { children: HelpInline[] }).children)).toBe('**unclosed bold')
  })
  it('oversized input is bounded', () => {
    const d = parse('a '.repeat(500_000))
    expect(inlineText((d.blocks[0] as { children: HelpInline[] }).children).length).toBeLessThanOrEqual(400_000)
  })
  it('structure: title, unique heading ids, list start numbers, nested lists, tables', () => {
    const d = parse('# Title\n\n## Status\n\n### Status\n\n11. step\n    more\n12. next\n   - nested\n\n| A | B |\n|---|---|\n| **x** | `y` |')
    expect(d.title).toBe('Title')
    expect(d.headings.map(h => h.id)).toEqual(['status', 'status-2'])
    const list = d.blocks.find(b => b.type === 'list') as Extract<HelpBlock, { type: 'list' }>
    expect(list).toMatchObject({ ordered: true, start: 11 })
    expect(list.items).toHaveLength(2)
    expect(list.items[1].some(b => b.type === 'list')).toBe(true)
    const table = d.blocks.find(b => b.type === 'table') as Extract<HelpBlock, { type: 'table' }>
    expect(table.rows[0][0][0]).toMatchObject({ type: 'strong' })
    expect(table.rows[0][1][0]).toEqual({ type: 'code', text: 'y' })
  })
})

describe('the real docs/assurance content', () => {
  const docs = loadAllHelpDocs()
  it('every registered document loads and has a title', () => {
    expect(docs).toHaveLength(HELP_ENTRIES.length)
    for (const d of docs) expect(d.doc.title, d.entry.slug).toBeTruthy()
  })
  it('every link written in the docs resolves (none silently degraded to text)', () => {
    for (const d of docs) {
      const src = fs.readFileSync(path.join(HELP_ROOT, d.entry.file), 'utf8')
      const written = (src.match(/\]\([^)]+\)/g) ?? []).length
      const resolved = allInlines(d.doc.blocks).filter(n => n.type === 'link').length
      expect(resolved, d.entry.file).toBe(written)
    }
  })
  it('no document contains raw HTML or secrets-looking content', () => {
    for (const d of docs) {
      const src = fs.readFileSync(path.join(HELP_ROOT, d.entry.file), 'utf8')
      expect(src, d.entry.file).not.toMatch(/<\/?[a-z][^>]*>/i)
      expect(src, d.entry.file).not.toMatch(/postgres(ql)?:\/\/|DATABASE_URL=|SESSION_SECRET=|npg_[A-Za-z0-9]{6,}|sk-[A-Za-z0-9]{10,}/)
    }
  })
  it('every contextual Help topic points at an existing document and heading', () => {
    const bySlug = new Map(docs.map(d => [d.entry.slug, d]))
    for (const [topic, t] of Object.entries(HELP_TOPICS)) {
      const d = bySlug.get(t.slug)
      expect(d, topic).toBeTruthy()
      if (t.anchor) expect(d!.doc.headings.map(h => h.id), `${topic} → #${t.anchor}`).toContain(t.anchor)
    }
  })
  it('search finds real sections with anchors, requires every term, and is bounded', () => {
    const r = searchAssuranceHelp('independent verification')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every(x => x.slug && x.snippet.length <= 202)).toBe(true)
    expect(r.some(x => x.slug === 'perform-verification')).toBe(true)
    expect(searchAssuranceHelp('zzqxnotaword')).toEqual([])
    expect(searchAssuranceHelp('')).toEqual([])
    expect(searchAssuranceHelp('a')).toEqual([]) // single letters are ignored
    expect(searchAssuranceHelp('.*(a+)+$ [ ( \\')).toEqual([]) // no regex is built from input
    const cancel = searchAssuranceHelp('cancel inspection reason')
    expect(cancel[0]?.slug).toBeTruthy()
    expect(helpQueryTerms('x'.repeat(500))[0].length).toBeLessThanOrEqual(MAX_QUERY_LENGTH)
    expect(helpQueryTerms('a b c d e f g h i j k l m n o p'.replace(/ /g, 'x '))).toHaveLength(8)
  })
  it('sections are cut at level-2/3 headings and carry the anchor', () => {
    const d = loadHelpDoc('user-guide')!
    const sections = buildHelpSections('user-guide', d.doc)
    expect(sections.find(s => s.anchor === 'status-and-lifecycle')?.heading).toBe('Status and lifecycle')
    expect(searchHelp(sections, 'closure summary').some(s => s.anchor === 'status-and-lifecycle')).toBe(true)
  })
})

describe('wiring', () => {
  it('both Help routes exist and re-check Assurance access', () => {
    for (const f of ['app/assurance/help/page.tsx', 'app/assurance/help/[slug]/page.tsx']) {
      const src = stripComments(read(f))
      expect(src, f).toMatch(/await resolvePageViewer\(\)/)
      expect(src, f).toMatch(/if \(!viewer\) return denied;/)
    }
    expect(stripComments(read('app/assurance/help/[slug]/page.tsx'))).toMatch(/const loaded = loadHelpDoc\(slug\);\s*if \(!loaded\) notFound\(\);/)
  })
  it('nothing in Assurance renders raw HTML', () => {
    const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`])
    for (const f of [...walk('app/assurance'), ...walk('lib/assurance')].filter(f => /\.tsx?$/.test(f))) {
      expect(read(f), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=/)
    }
  })
  it('every Assurance page (except Help itself) has a contextual Help link', () => {
    const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`])
    const pages = walk('app/assurance').filter(f => f.endsWith('/page.tsx') && !f.includes('/help/'))
    expect(pages.length).toBeGreaterThanOrEqual(24)
    for (const f of pages) {
      const m = read(f).match(/<PageHeader help="([a-z-]+)"/)
      expect(m, f).toBeTruthy()
      expect(Object.keys(HELP_TOPICS), f).toContain(m![1])
    }
  })
  it('the sidebar keeps its nine sections and adds Help only as a footer entry', () => {
    const src = read('app/assurance/_components/AssuranceSidebar.tsx')
    expect([...src.matchAll(/href: '(\/assurance[^']*)'/g)].map(m => m[1])).toHaveLength(9)
    expect(src).toMatch(/footer=\{[\s\S]*href="\/assurance\/help"/)
  })
  it('rendered procedures keep their list markers (the app reset removes them)', () => {
    const css = read('app/assurance/_components/assurance.module.css')
    expect(css).toMatch(/\.helpDoc ol \{\s*list-style: decimal;/)
    expect(css).toMatch(/\.helpDoc ul \{\s*list-style: disc;/)
  })
  it('file tracing ships exactly docs/assurance Markdown, scoped to the two Help routes', () => {
    const src = read('next.config.ts') // not comment-stripped: the glob contains '/**/'
    const block = src.slice(src.indexOf('outputFileTracingIncludes'), src.indexOf('}', src.indexOf('outputFileTracingIncludes')) + 1)
    expect(block).toContain(`'/assurance/help': ['./docs/assurance/**/*.md']`)
    expect(block).toContain(`'/assurance/help/\\\\[slug\\\\]': ['./docs/assurance/**/*.md']`)
    expect(block.match(/'\.\/[^']+'/g)).toEqual(["'./docs/assurance/**/*.md'", "'./docs/assurance/**/*.md'"])
    expect(helpHref('user-guide', 'incidents')).toBe('/assurance/help/user-guide#incidents')
  })
})
