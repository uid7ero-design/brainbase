import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme'
import {
  TICKET_BG, TICKET_TEXT_MUTED, TICKET_TEXT_SECONDARY, TICKET_TEXT_PRIMARY, TICKET_VIOLET_SOFT,
} from '@/components/events/TicketCard'

// Deferred-issues pass (N3): muted text on the customer-facing public event
// page (/e) and the always-dark ticket (/t, /b wallet) measured 2.9:1 and
// 3.5:1 in the authenticated Preview. The fix keeps every brand treatment
// (dark ticket, institutional burgundy/gold/serif theme, default palette)
// and only raises the opacity of the SAME muted tint until normal text
// clears WCAG AA 4.5:1 on every surface it is drawn on.

type RGBA = [number, number, number, number]

function parse(c: string): RGBA {
  const hex = c.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA
  const m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/)
  if (!m) throw new Error(`unparseable colour ${c}`)
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
}
const over = (top: RGBA, base: RGBA): RGBA =>
  [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3])).concat(1) as RGBA
const lum = ([r, g, b]: RGBA) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(fg: string, surface: RGBA): number {
  const a = lum(over(parse(fg), surface)), b = lum(surface)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
/** Opaque surface for a (possibly translucent) layer painted over the page bg. */
const surface = (layer: string, pageBg: string): RGBA => over(parse(layer), parse(pageBg))

describe('public event page muted text is readable (WCAG AA 4.5:1)', () => {
  for (const [label, slug] of [['default theme', 'any-unbranded-organisation'], ['institutional (School Test Organisation) theme', 'school-test-organisation']] as const) {
    it(`${label}: textMuted clears 4.5:1 on bg, cardBg and sectionBg`, () => {
      const t = resolvePublicEventTheme(slug).tokens
      for (const layer of [t.bg, t.cardBg, t.sectionBg]) {
        expect(contrast(t.textMuted, surface(layer, t.bg)), `${label} ${layer}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${label}: muted stays visibly lighter than secondary (hierarchy preserved)`, () => {
      const t = resolvePublicEventTheme(slug).tokens
      const bg = parse(t.bg)
      expect(contrast(t.textSecondary, bg)).toBeGreaterThan(contrast(t.textMuted, bg))
    })
  }

  it('the institutional brand identity is untouched (only the muted opacity moved)', () => {
    const t = resolvePublicEventTheme('school-test-organisation').tokens
    expect(t.bg).toBe('#FAF9F6')
    expect(t.bandBg).toBe('#4B001F')
    expect(t.bandAccent).toBe('#C9A227')
    expect(t.accent).toBe('#8A6D1D')
    expect(t.headingFontFamily).toBe('Georgia, "Times New Roman", Times, serif')
    expect(t.textMuted).toBe('rgba(26,26,26,.62)')
  })
})

describe('ticket muted text is readable on the always-dark ticket', () => {
  const ticketSource = fs.readFileSync(path.resolve(__dirname, '../../components/events/TicketCard.tsx'), 'utf8')

  it('TICKET_TEXT_MUTED clears 4.5:1 on the ticket background and its card surface', () => {
    for (const layer of [TICKET_BG, 'rgba(255,255,255,.02)', 'rgba(255,255,255,.04)']) {
      expect(contrast(TICKET_TEXT_MUTED, surface(layer, TICKET_BG)), layer).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the deliberate dark ticket identity and the text hierarchy', () => {
    expect(TICKET_BG).toBe('#07080B')
    expect(TICKET_TEXT_PRIMARY).toBe('#F5F7FA')
    expect(TICKET_VIOLET_SOFT).toBe('#A78BFA')
    const bg = parse(TICKET_BG)
    expect(contrast(TICKET_TEXT_SECONDARY, bg)).toBeGreaterThan(contrast(TICKET_TEXT_MUTED, bg))
  })

  it('ticket field labels use the shared muted constant, never a lower-opacity literal', () => {
    expect(ticketSource).not.toMatch(/rgba\(226,\s*232,\s*240,\s*\.(?:[0-4]\d?)\)/)
    expect(ticketSource).toContain("textTransform: 'uppercase', color: TICKET_TEXT_MUTED }}>{label}</div>")
  })
})
