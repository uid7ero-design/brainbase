import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Eve organiser allow-list — the admin control (GET/PUT /api/organisations/eve
// and /settings/eve). admin+ only, tenant-isolated (organisation from the
// session, never the request), JSON-boolean input only, audited on change.

type Session = { userId: string; organisationId: string; role: string }
let session: Session | null = null
const store = new Map<string, unknown>()
const audit = vi.fn()
const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = strings.join('?')
  if (q.includes('UPDATE organisations')) {
    // values: [organisationId (prev), enabled, organisationId (where)]
    const id = values[0] as string
    if (!store.has(id)) return []
    const before = store.get(id) as Record<string, unknown> | null
    const events = before && typeof before.events === 'object' && before.events ? before.events as Record<string, unknown> : {}
    const after = { ...(before ?? {}), events: { ...events, eveEnabled: values[1] } }
    store.set(id, after)
    return [{ before_settings: before, after_settings: after }]
  }
  if (q.includes('SELECT settings FROM organisations WHERE id')) {
    const id = values[0] as string
    return store.has(id) ? [{ settings: store.get(id) }] : []
  }
  return []
})

vi.mock('@/lib/db', () => ({ default: (...a: Parameters<typeof db>) => db(...a) }))
vi.mock('@/lib/capabilities/requireCapability', async orig => ({ ...(await orig<object>()), checkCapability: async () => ({ allowed: true }) }))
vi.mock('@/lib/events/auditLog', () => ({ logOrganisationEveEnabledChanged: (...a: unknown[]) => audit(...a) }))
vi.mock('@/lib/org', async () => {
  const { roleGte } = await import('@/lib/session')
  return {
    roleGte,
    requireSession: async () => { if (!session) throw new Error('Unauthorized'); return session },
    unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    forbidden: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
  }
})

const route = await import('@/app/api/organisations/eve/route')
const put = (body: unknown) => new Request('http://bb.test/api/organisations/eve', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as never
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

beforeEach(() => {
  session = null
  store.clear()
  store.set('org-a', { branding: { name: 'A' } })
  store.set('org-b', { events: { eveEnabled: true, other: 'kept' } })
  audit.mockReset()
  db.mockClear()
})

describe('permissions', () => {
  it('unauthenticated: 401 on GET and PUT, nothing written', async () => {
    expect((await route.GET()).status).toBe(401)
    expect((await route.PUT(put({ eveEnabled: true }))).status).toBe(401)
    expect(store.get('org-a')).toEqual({ branding: { name: 'A' } })
  })

  it.each(['viewer', 'manager', 'analyst'])('%s: 403 on GET and PUT, nothing written', async role => {
    session = { userId: 'u1', organisationId: 'org-a', role }
    expect((await route.GET()).status).toBe(403)
    expect((await route.PUT(put({ eveEnabled: true }))).status).toBe(403)
    expect(store.get('org-a')).toEqual({ branding: { name: 'A' } })
    expect(audit).not.toHaveBeenCalled()
  })

  it.each(['admin', 'super_admin'])('%s: may read and change it', async role => {
    session = { userId: 'u1', organisationId: 'org-a', role }
    expect(await (await route.GET()).json()).toEqual({ eveEnabled: false, eventsEntitled: true })
    const res = await route.PUT(put({ eveEnabled: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ eveEnabled: true, eventsEntitled: true })
  })
})

describe('default and input validation', () => {
  it('an organisation with no setting reads as OFF', async () => {
    session = { userId: 'u1', organisationId: 'org-a', role: 'admin' }
    expect((await (await route.GET()).json()).eveEnabled).toBe(false)
  })

  it.each([['"true"', 'true'], ['1', 1], ['null', null], ['missing', undefined], ['object', { on: true }]])('rejects %s with 400, nothing written', async (_l, value) => {
    session = { userId: 'u1', organisationId: 'org-a', role: 'admin' }
    const res = await route.PUT(put(value === undefined ? {} : { eveEnabled: value }))
    expect(res.status).toBe(400)
    expect(store.get('org-a')).toEqual({ branding: { name: 'A' } })
  })

  it('rejects a non-JSON body', async () => {
    session = { userId: 'u1', organisationId: 'org-a', role: 'admin' }
    expect((await route.PUT(put('not json'))).status).toBe(400)
  })
})

describe('tenant isolation', () => {
  it('writes only the session organisation, ignoring any organisation id in the body', async () => {
    session = { userId: 'u1', organisationId: 'org-a', role: 'admin' }
    await route.PUT(put({ eveEnabled: true, organisationId: 'org-b', organisation_id: 'org-b' }))
    expect(store.get('org-a')).toEqual({ branding: { name: 'A' }, events: { eveEnabled: true } })
    expect(store.get('org-b')).toEqual({ events: { eveEnabled: true, other: 'kept' } })
  })

  it('a super_admin impersonating org-b (session org resolved to org-b) changes org-b only', async () => {
    session = { userId: 'sa', organisationId: 'org-b', role: 'super_admin' }
    await route.PUT(put({ eveEnabled: false }))
    expect(store.get('org-b')).toEqual({ events: { eveEnabled: false, other: 'kept' } })
    expect(store.get('org-a')).toEqual({ branding: { name: 'A' } })
  })

  it('the route never reads an organisation id from the request', () => {
    const src = read('app/api/organisations/eve/route.ts')
    expect(src).not.toMatch(/body\.(organisationId|organisation_id|orgId)|searchParams/)
    expect(src).toContain('auth.session.organisationId')
  })
})

describe('audit', () => {
  it('records a change with the before/after boolean only', async () => {
    session = { userId: 'u1', organisationId: 'org-a', role: 'admin' }
    await route.PUT(put({ eveEnabled: true }))
    expect(audit).toHaveBeenCalledWith({ organisationId: 'org-a', userId: 'u1', before: false, after: true })
  })

  it('does not record a no-op save', async () => {
    session = { userId: 'u1', organisationId: 'org-b', role: 'admin' }
    await route.PUT(put({ eveEnabled: true }))
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('settings page', () => {
  it('is admin+ and explains what enabling does', () => {
    expect(read('app/settings/eve/page.tsx')).toContain("requireRole('admin')")
    const client = read('app/settings/eve/EveSettingsClient.tsx')
    expect(client).toContain('Enable this organisation on Eve')
    expect(client).toContain('eveevents.com.au')
    expect(client).toContain('Publishing an event never turns this on')
  })
})
