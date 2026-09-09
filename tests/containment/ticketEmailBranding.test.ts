import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 3D — ticket-email PRESENTATION branding only. Covers:
//   - emailLayout()'s new optional organisation-presentation hook and
//     its byte-identical behaviour for every existing caller when
//     omitted (§17's own explicit requirement)
//   - buildTicketEmail()'s own consumption of TicketEmailBranding
//     (unconfigured/configured, accent scope, HTML escaping, privacy)
//   - the resend route's branding resolution (source-level + one
//     SQL-mocked integration test)
//   - delivery-identity invariants (FROM/EMAIL_FROM unchanged, no
//     Reply-To, no per-org domain)
//
// Static source-text assertions use the same stripComments() idiom as
// every other containment test in this repo (this project has no
// jsdom/React Testing Library harness).

const root = path.resolve(__dirname, '../..')
function read(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

process.env.NEXT_PUBLIC_APP_URL = 'https://www.thebrainbase.com.au'

const { buildTicketEmail } = await import('@/lib/events/ticketEmail')
const { emailLayout, verificationEmail, passwordResetEmail, webServiceLeadEmail } = await import('@/lib/email')

const BASE_DATA = {
  eventName: 'Spring Gala',
  purchaserName: 'Jane Doe',
  attendees: [{ name: 'Jane Doe', ticketToken: 'a'.repeat(64) }],
}

describe('emailLayout() — byte-identical output when no presentation object is supplied', () => {
  it('a bare emailLayout(body) call is identical whether or not the org-presentation call site exists elsewhere in the file', () => {
    const a = emailLayout('<p>hello</p>')
    const b = emailLayout('<p>hello</p>', null)
    const c = emailLayout('<p>hello</p>', undefined)
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it('every existing shared-layout caller (verification/password-reset/lead) still renders the exact original header markup', () => {
    const v = verificationEmail('Jane', 'tok123')
    const p = passwordResetEmail('Jane', 'tok123')
    const l = webServiceLeadEmail({
      id: 'lead-1', fullName: 'Jane Doe', businessName: 'Acme', email: 'jane@example.com', phone: '0400000000',
      serviceInterest: ['website_design'], budgetRange: 'under_2500', projectDesc: 'A new site',
    })
    for (const { html } of [v, p, l]) {
      expect(html).toContain('BRAINB<span style="color:#A78BFA">Λ</span>SE\n          </span>\n        </td></tr>')
      expect(html).toContain('background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#aaa">\n          © ')
    }
  })

  it('an org presentation object with every field null/absent produces the exact same output as no object at all', () => {
    const withNulls = emailLayout('<p>hello</p>', { name: null, logoUrl: null, website: null, footerText: null })
    const withNothing = emailLayout('<p>hello</p>')
    expect(withNulls).toBe(withNothing)
  })
})

describe('emailLayout() — configured organisation presentation', () => {
  it('renders the organisation name below the BrainBase wordmark, never replacing it', () => {
    const html = emailLayout('<p>hello</p>', { name: 'Acme School', logoUrl: null, website: null, footerText: null })
    expect(html).toContain('BRAINB<span style="color:#A78BFA">Λ</span>SE')
    expect(html).toContain('Acme School')
    const wordmarkIndex = html.indexOf('BRAINB<span')
    const nameIndex = html.indexOf('Acme School')
    expect(nameIndex).toBeGreaterThan(wordmarkIndex)
  })

  it('renders the logo as a small bounded <img> when configured, omits it entirely when absent', () => {
    const withLogo = emailLayout('<p>hello</p>', { name: 'Acme', logoUrl: 'https://acme.test/logo.png', website: null, footerText: null })
    expect(withLogo).toContain('<img src="https://acme.test/logo.png"')
    expect(withLogo).toContain('height:16px')
    expect(withLogo).toContain('width:auto')

    const withoutLogo = emailLayout('<p>hello</p>', { name: 'Acme', logoUrl: null, website: null, footerText: null })
    expect(withoutLogo).not.toContain('<img')
  })

  it('renders the website as a subtle link only when configured', () => {
    const withWebsite = emailLayout('<p>hello</p>', { name: 'Acme', logoUrl: null, website: 'https://acme.test', footerText: null })
    expect(withWebsite).toContain('href="https://acme.test"')
    const withoutWebsite = emailLayout('<p>hello</p>', { name: 'Acme', logoUrl: null, website: null, footerText: null })
    expect(withoutWebsite).not.toContain('href="https://acme.test"')
  })

  it('renders emailFooter text above the existing platform footer/copyright, which always remains', () => {
    const html = emailLayout('<p>hello</p>', { name: null, logoUrl: null, website: null, footerText: 'Thanks for supporting our school!' })
    expect(html).toContain('Thanks for supporting our school!')
    expect(html).toContain(`© ${new Date().getFullYear()} Brainbase · Adelaide SA Australia`)
    const footerTextIndex = html.indexOf('Thanks for supporting our school!')
    const copyrightIndex = html.indexOf('© ')
    expect(footerTextIndex).toBeLessThan(copyrightIndex)
  })

  it('does not accept or read accentColor — the CTA/divider accent is body content, not part of this shared shell', () => {
    const code = stripComments(read('lib/email.ts'))
    const layoutStart = code.indexOf('export function emailLayout')
    const layoutBody = code.slice(layoutStart)
    expect(layoutBody).not.toMatch(/accentColor/)
  })
})

describe('emailLayout() — HTML escaping of organisation-provided text', () => {
  it('escapes a malicious organisation name', () => {
    const html = emailLayout('<p>hello</p>', { name: `<script>alert(1)</script>`, logoUrl: null, website: null, footerText: null })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes a malicious emailFooter — no raw HTML injection', () => {
    const html = emailLayout('<p>hello</p>', { name: null, logoUrl: null, website: null, footerText: `<img src=x onerror=alert(1)>` })
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('escapes quote characters in a name so they cannot break out of an HTML attribute context', () => {
    const html = emailLayout('<p>hello</p>', { name: `Acme" onmouseover="alert(1)`, logoUrl: null, website: null, footerText: null })
    expect(html).not.toContain(`Acme" onmouseover="alert(1)`)
    expect(html).toContain('&quot;')
  })
})

describe('escHtml() — widened to also escape quotes (safe, additive)', () => {
  it('still escapes &, <, > exactly as before', async () => {
    const { escHtml } = await import('@/lib/email')
    expect(escHtml('<b>A & B</b>')).toBe('&lt;b&gt;A &amp; B&lt;/b&gt;')
  })

  it('now also escapes single and double quotes', async () => {
    const { escHtml } = await import('@/lib/email')
    expect(escHtml(`"quoted" and 'single'`)).toBe('&quot;quoted&quot; and &#39;single&#39;')
  })
})

describe('buildTicketEmail() — unconfigured organisation (branding absent or all-null)', () => {
  it('with branding entirely omitted, the ticket email is unchanged: BrainBase header, default purple CTA, no org name/logo/website/footer', () => {
    const email = buildTicketEmail(BASE_DATA)
    expect(email.html).toContain('BRAINB<span style="color:#A78BFA">Λ</span>SE')
    expect(email.html).toContain('background:#7C3AED')
    expect(email.html).not.toContain('<img')
  })

  it('with branding explicitly present but every field null, output is identical to branding omitted entirely', () => {
    const withNullBranding = buildTicketEmail({
      ...BASE_DATA,
      branding: { name: null, logoUrl: null, accentColor: null, website: null, emailFooter: null },
    })
    const withoutBranding = buildTicketEmail(BASE_DATA)
    expect(withNullBranding.html).toBe(withoutBranding.html)
  })

  it('does NOT fall back to a raw DB organisation name when branding.name is null — the identity row is omitted entirely, not filled with a fallback (deliberately more conservative than /t or /b)', () => {
    const email = buildTicketEmail({
      ...BASE_DATA,
      branding: { name: null, logoUrl: null, accentColor: null, website: null, emailFooter: null },
    })
    // No identity <div> block should appear in the header region at all.
    const headerEnd = email.html.indexOf('</td></tr>')
    const header = email.html.slice(0, headerEnd)
    expect(header).not.toMatch(/margin-top:8px/)
  })
})

describe('buildTicketEmail() — configured organisation branding', () => {
  const CONFIGURED_BRANDING = {
    name: 'Acme School', logoUrl: 'https://acme.test/logo.png', accentColor: '#0ea5e9',
    website: 'https://acme.test', emailFooter: 'Go Acme Eagles!',
  }

  it('organisation name renders', () => {
    const email = buildTicketEmail({ ...BASE_DATA, branding: CONFIGURED_BRANDING })
    expect(email.html).toContain('Acme School')
  })

  it('logo renders when configured', () => {
    const email = buildTicketEmail({ ...BASE_DATA, branding: CONFIGURED_BRANDING })
    expect(email.html).toContain('https://acme.test/logo.png')
  })

  it('website renders as a link', () => {
    const email = buildTicketEmail({ ...BASE_DATA, branding: CONFIGURED_BRANDING })
    expect(email.html).toContain('href="https://acme.test"')
  })

  it('emailFooter renders, escaped', () => {
    const email = buildTicketEmail({ ...BASE_DATA, branding: CONFIGURED_BRANDING })
    expect(email.html).toContain('Go Acme Eagles!')
  })

  it('BrainBase attribution remains present alongside configured branding', () => {
    const email = buildTicketEmail({ ...BASE_DATA, branding: CONFIGURED_BRANDING })
    expect(email.html).toContain('BRAINB<span style="color:#A78BFA">Λ</span>SE')
    expect(email.html).toContain(`© ${new Date().getFullYear()} Brainbase · Adelaide SA Australia`)
  })

  it('accent affects the CTA button background and the divider only', () => {
    const email = buildTicketEmail({ ...BASE_DATA, branding: CONFIGURED_BRANDING })
    expect(email.html).toContain('background:#0ea5e9')
    expect(email.html).not.toContain('background:#7C3AED')
    expect(email.html).toContain('border-top:1px solid #0ea5e9')
  })

  it('accent never appears near the checked-in-style/status vocabulary or as a body-text colour — this email has none of that, confirming the accent substitution is scoped to exactly the CTA/divider call sites', () => {
    const occurrences = (email_occurrences_of_accent(buildTicketEmail({ ...BASE_DATA, branding: CONFIGURED_BRANDING }).html))
    expect(occurrences).toBe(2) // ticketBtn background (appears once per rendered button reference) + divider
  })

  function email_occurrences_of_accent(html: string): number {
    return (html.match(/#0ea5e9/g) ?? []).length
  }

  it('ticket links and booking-wallet CTA targets are completely unaffected by branding', () => {
    const configured = buildTicketEmail({
      eventName: 'Spring Gala', purchaserName: 'Jane Doe',
      attendees: [
        { name: 'Jane Doe', ticketToken: 'a'.repeat(64) },
        { name: 'Bob Smith', ticketToken: 'b'.repeat(64) },
      ],
      bookingToken: 'c'.repeat(64),
      branding: CONFIGURED_BRANDING,
    })
    expect(configured.html).toContain(`https://www.thebrainbase.com.au/t/${'a'.repeat(64)}`)
    expect(configured.html).toContain(`https://www.thebrainbase.com.au/t/${'b'.repeat(64)}`)
    expect(configured.html).toContain(`https://www.thebrainbase.com.au/b/${'c'.repeat(64)}/tickets`)
  })
})

describe('buildTicketEmail() — HTML escaping of organisation-provided branding fields', () => {
  it('escapes a malicious configured organisation name and emailFooter', () => {
    const email = buildTicketEmail({
      ...BASE_DATA,
      branding: {
        name: `<>&"'`, logoUrl: null, accentColor: null, website: null,
        emailFooter: `<script>alert(1)</script>`,
      },
    })
    expect(email.html).not.toContain('<script>alert(1)</script>')
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(email.html).not.toMatch(/<>&"'/)
  })
})

describe('buildTicketEmail() — privacy: no raw/private branding fields ever leak', () => {
  it('no organisationId, raw settings key, or private business-contact field vocabulary ever appears', () => {
    const email = buildTicketEmail({
      ...BASE_DATA,
      branding: {
        name: 'Acme', logoUrl: 'https://acme.test/logo.png', accentColor: '#123456',
        website: 'https://acme.test', emailFooter: 'footer text',
      },
    })
    const lower = email.html.toLowerCase()
    for (const word of ['organisationid', 'organisation_id', 'settings', 'businessprofile', 'abn']) {
      expect(lower).not.toContain(word)
    }
  })
})

describe('TicketEmailBranding — source-level containment', () => {
  const brandingSrc = read('lib/organisations/branding.ts')

  it('TicketEmailBranding is a narrow 5-field shape, not raw OrganisationBranding and not raw settings', () => {
    const typeStart = brandingSrc.indexOf('export interface TicketEmailBranding {')
    const typeEnd = brandingSrc.indexOf('\n}', typeStart)
    const typeBlock = brandingSrc.slice(typeStart, typeEnd)
    expect(typeBlock).toMatch(/name: string \| null/)
    expect(typeBlock).toMatch(/logoUrl: string \| null/)
    expect(typeBlock).toMatch(/accentColor: string \| null/)
    expect(typeBlock).toMatch(/website: string \| null/)
    expect(typeBlock).toMatch(/emailFooter: string \| null/)
    expect(typeBlock).not.toMatch(/email: string|phone: string|address: string|abn: string/)
  })

  it('does NOT include emailSenderName — a sender display-name override was explicitly deferred, so the email view-model exposes only fields actually consumed today', () => {
    const typeStart = brandingSrc.indexOf('export interface TicketEmailBranding {')
    const typeEnd = brandingSrc.indexOf('\n}', typeStart)
    const typeBlock = brandingSrc.slice(typeStart, typeEnd)
    expect(typeBlock).not.toMatch(/emailSenderName/)
  })

  it('emailSenderName remains on the full OrganisationBranding type (persisted schema/settings UI unaffected) — only the narrow email view-model excludes it', () => {
    const fullTypeStart = brandingSrc.indexOf('export interface OrganisationBranding {')
    const fullTypeEnd = brandingSrc.indexOf('\n}', fullTypeStart)
    const fullTypeBlock = brandingSrc.slice(fullTypeStart, fullTypeEnd)
    expect(fullTypeBlock).toMatch(/emailSenderName: string \| null/)
  })

  it('normaliseTicketEmailBranding never does its own raw JSON parsing — it delegates to normaliseOrganisationBranding, the same shared coercion every other resolver uses', () => {
    const fnStart = brandingSrc.indexOf('export function normaliseTicketEmailBranding')
    const fnEnd = brandingSrc.indexOf('\n}', fnStart)
    const fnBody = brandingSrc.slice(fnStart, fnEnd)
    expect(fnBody).toContain('normaliseOrganisationBranding(rawSettings, organisationName)')
    expect(fnBody).not.toMatch(/JSON\.parse/)
  })
})

describe('ticketEmail.ts — no raw settings parsing, TicketEmailBranding only', () => {
  const code = stripComments(read('lib/events/ticketEmail.ts'))

  it('imports TicketEmailBranding as a type only, never constructs branding from raw settings itself', () => {
    expect(code).toContain("import type { TicketEmailBranding } from '@/lib/organisations/branding'")
    expect(code).not.toMatch(/JSON\.parse|\.settings\b/)
  })

  it('never imports lib/db — buildTicketEmail/sendTicketEmail remain pure/network-only, no direct DB access added by this phase', () => {
    expect(code).not.toMatch(/from ['"]@\/lib\/db['"]/)
  })
})

describe('lib/email.ts — delivery identity unchanged', () => {
  const code = stripComments(read('lib/email.ts'))

  it('FROM construction is byte-identical: still reads only EMAIL_FROM, same fallback literal', () => {
    expect(code).toContain("const FROM = process.env.EMAIL_FROM ?? 'Brainbase <noreply@brainbase.app>';")
  })

  it('the Resend API call body is unchanged: still `from: FROM`, no per-organisation from address, no reply_to field', () => {
    const sendEmailStart = code.indexOf('export async function sendEmail')
    const sendEmailEnd = code.indexOf('\nexport const BASE_URL', sendEmailStart)
    const sendEmailBody = code.slice(sendEmailStart, sendEmailEnd)
    expect(sendEmailBody).toContain('from: FROM,')
    expect(sendEmailBody).not.toMatch(/reply_to|replyTo|Reply-To/i)
    expect(sendEmailBody).not.toMatch(/branding|organisation/i)
  })

  it('no Reply-To scaffolding exists anywhere in lib/email.ts', () => {
    expect(code).not.toMatch(/reply_to|replyTo|Reply-To/i)
  })
})

describe('Resend route — organisation branding resolved from the already-trusted session organisation, no new recipient/token input', () => {
  const routeCode = stripComments(read('app/api/events/[id]/orders/[orderId]/resend-ticket-email/route.ts'))

  it('joins organisations on the SAME already-authorized session.organisationId — no client-supplied organisationId', () => {
    expect(routeCode).toMatch(/JOIN organisations o ON o\.id = eo\.organisation_id/)
    expect(routeCode).toContain('eo.organisation_id = ${session.organisationId}')
  })

  it('calls normaliseTicketEmailBranding with the org row this SAME query already selected — no second query added', () => {
    expect(routeCode).toContain('normaliseTicketEmailBranding(order.organisation_settings, order.organisation_name)')
    const selectStart = routeCode.indexOf('const orderRows = await sql`')
    const selectEnd = routeCode.indexOf('`;', selectStart)
    const selectBlock = routeCode.slice(selectStart, selectEnd)
    expect(selectBlock).toMatch(/o\.name AS organisation_name, o\.settings AS organisation_settings/)
  })

  it('manager auth, cooldown, eligibility, and audit-action machinery are all untouched by this phase', () => {
    expect(routeCode).toContain("authorizeEventsRequest('manager')")
    expect(routeCode).toContain('COOLDOWN_SECONDS = 60')
    expect(routeCode).toContain("const RESEND_ACTION = 'event_order.ticket_email_resent';")
    expect(routeCode).toContain('isOrderEligibleForTicketEmail(order)')
  })

  it('no new recipient input — purchaser_email is still read only from the DB row, never request body/query params', () => {
    expect(routeCode).toContain('const recipient = order.purchaser_email as string;')
    expect(routeCode).not.toMatch(/req\.json\(\)|searchParams/)
  })
})
