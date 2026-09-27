import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D4 regression guard — CRM, People, Commercial and Data Hub.
//
// Scoped to every .tsx under the four module directories. It blocks the
// legacy treatments D4 removed — dark-only neutrals and slabs, white-alpha
// text, the retired violet palette (including the --purple-N variables used
// for buttons and links), glass/blur, gradients/glow, forced-dark controls,
// outline suppression, oversized radii and the per-page duplicate button /
// table style helpers — while leaving documented DOMAIN encodings alone
// (pipeline stages, classifications, delivery/payment states, attachment
// categories, user-chosen colours). A map is exempt only when it carries
// the marker comment "Domain category encoding (kept)" on the line above
// its declaration (see the D4 audit note).

const ROOTS = ['app/crm', 'app/people', 'app/commercial', 'app/data-hub']

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap(e => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return walk(rel)
    return e.name.endsWith('.tsx') ? [rel] : []
  })
}
const FILES = ROOTS.flatMap(walk)

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Removes documented domain-encoding maps (declaration after the marker, up to its closing brace). */
function withoutDomainMaps(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Domain category encoding (kept)')) {
      // skip the marker, then the declaration until braces balance
      let j = i + 1
      let depth = 0
      let started = false
      for (; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{' || ch === '[') { depth++; started = true }
          if (ch === '}' || ch === ']') depth--
        }
        if (started && depth <= 0) break
      }
      i = j
      continue
    }
    out.push(lines[i])
  }
  return out.join('\n')
}

const WHITE_ALPHA = /rgba?\(\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,\s*2[2-5]\d\s*,/
const OLD_VIOLET = /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|8a4dff|a5b4fc|818CF8|6366F1)\b|rgba?\(\s*(124\s*,\s*58\s*,\s*237|139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|138\s*,\s*77\s*,\s*255|99\s*,\s*102\s*,\s*241)\b|var\(--purple-\d/i
const DARK_ONLY = /#(1f2937|1a1d24|111827|0f1117|161b22|1a0505|7f1d1d|0b0c12)\b|['"]#(161|147)['"]|['"]#fff(fff)?['"]/i
const GLASS = /backdrop-?[fF]ilter|(?<![.\w])blur\(/
const GRADIENT = /(linear|radial|conic)-?[gG]radient/
const GLOW = /drop-shadow|text-?[sS]hadow|(box-shadow|boxShadow)\s*:\s*[`'"]?\s*0 0 \d+px/
const OUTLINE_SUPPRESSION = /outline\s*:\s*['"]?\s*(none|0)\b/
const FORCED_DARK = /colorScheme:\s*['"]dark['"]/
const BIG_RADIUS = /borderRadius:\s*(1[0-9]|[2-9]\d)\b/
const DUPLICATE_HELPERS = /\bfunction (btn|actionBtn)\(|const (addBtn|outlineBtn|dangerBtn|primaryButton|secondaryButton|smallButton)\s*:|const (th|td)\s*:\s*React\.CSSProperties/

describe('D4 business modules — no legacy visual treatments', () => {
  it('covers the four module directories', () => {
    expect(FILES.length).toBeGreaterThan(60)
  })

  // Lines another test pins verbatim (hrAdministratorsUi: the error cell's
  // literal colour). Exempted by exact content, not by file.
  const PINNED_LINES = [
    "{!loading && error && <tr><td colSpan={3} style={{ ...empty, color: '#f87171' }}>{error}</td></tr>}",
  ]

  for (const file of FILES) {
    it(`${file}`, () => {
      const code = stripComments(withoutDomainMaps(read(file)))
        .split('\n').filter(l => !PINNED_LINES.some(p => l.includes(p))).join('\n')
      expect(code, 'white-alpha neutral').not.toMatch(WHITE_ALPHA)
      expect(code, 'retired violet / --purple-N').not.toMatch(OLD_VIOLET)
      expect(code, 'dark-only slab / literal white').not.toMatch(DARK_ONLY)
      expect(code, 'glass').not.toMatch(GLASS)
      expect(code, 'gradient').not.toMatch(GRADIENT)
      expect(code, 'glow').not.toMatch(GLOW)
      expect(code, 'outline suppression').not.toMatch(OUTLINE_SUPPRESSION)
      expect(code, 'forced dark control').not.toMatch(FORCED_DARK)
      expect(code, 'oversized radius').not.toMatch(BIG_RADIUS)
      expect(code, 'duplicate button/table helper').not.toMatch(DUPLICATE_HELPERS)
    })
  }
})

describe('D4 shared table container fix', () => {
  it('TableContainer is the containing block for absolutely positioned descendants (visually hidden header text cannot widen the page)', () => {
    const css = read('components/ui/app/Table.module.css')
    const rule = css.slice(css.indexOf('.container {'), css.indexOf('}', css.indexOf('.container {')))
    expect(rule).toContain('position: relative;')
    expect(rule).toContain('overflow-x: auto;')
  })
})
