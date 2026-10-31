import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { Pool } from 'pg'
import { types as neonTypes } from '@neondatabase/serverless'

// Eve organiser allow-list against a REAL Postgres: the jsonb write in
// setOrganisationEveEnabled (merge into settings.events, siblings kept, NULL /
// non-object values handled, boolean only) and resolvePublicEvent reading the
// result. Same disposable-container harness as the other *RealPostgres tests.

const CONTAINER = `eve-allowlist-vitest-${process.pid}`
const HOST_PORT = 63500 + (process.pid % 400)

function dockerAvailable(): boolean {
  try { execSync('docker version', { stdio: 'ignore' }); return true } catch { return false }
}
const HAS_DOCKER = dockerAvailable()

const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }))
vi.mock('@/lib/db', () => {
  function sql(strings: TemplateStringsArray, ...values: unknown[]) {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return db.pool.query(text, values as unknown[]).then(r => r.rows)
  }
  return { default: sql }
})
vi.mock('@/lib/capabilities/requireCapability', () => ({ checkCapability: vi.fn(async () => ({ allowed: true })) }))

describe.runIf(HAS_DOCKER)('real Postgres — Eve organiser allow-list setting', () => {
  let mod: typeof import('@/lib/organisations/eveEnablement')
  let resolvePublicEvent: typeof import('@/lib/events/publicResolve').resolvePublicEvent
  let login: typeof import('@/lib/ticketing/login')
  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await db.pool.query(text, values)).rows as T[]
  const settingsOf = async (id: string) => (await q<{ settings: unknown }>('SELECT settings FROM organisations WHERE id = $1', [id]))[0].settings

  beforeAll(async () => {
    execSync(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb -p ${HOST_PORT}:5432 postgres:17-alpine`, { stdio: 'ignore' })
    let ready = false
    for (let i = 0; i < 30; i++) {
      const r = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'])
      if (r.status === 0) { ready = true; break }
      await new Promise(r2 => setTimeout(r2, 1000))
    }
    if (!ready) throw new Error('postgres container did not become ready within 30s')
    db.pool = new Pool({
      host: 'localhost', port: HOST_PORT, user: 'postgres', password: 'test', database: 'testdb', max: 4,
      types: neonTypes as unknown as import('pg').CustomTypesConfig,
    })
    for (let i = 0; i < 30; i++) {
      try { await db.pool.query('SELECT 1'); break } catch { await new Promise(r => setTimeout(r, 500)) }
    }
    await db.pool.query(`
      CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'ACTIVE', settings JSONB DEFAULT '{}', updated_at TIMESTAMPTZ);
      CREATE TABLE modules (key TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE organisation_modules (organisation_id TEXT NOT NULL, module_key TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE events (id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT, venue TEXT, artwork_url TEXT,
        starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, timezone TEXT NOT NULL, status TEXT NOT NULL, eve_questions_enabled BOOLEAN NOT NULL DEFAULT false);
      INSERT INTO organisations (id, name, slug, settings) VALUES
        ('org-plain', 'Plain', 'plain', '{}'),
        ('org-null', 'Null', 'null-settings', NULL),
        ('org-rich', 'Rich', 'rich', '{"branding":{"name":"Rich Co","publicEmail":"hi@rich.example"},"commercial":{"businessProfile":{"tradingName":"Rich"}},"events":{"other":"kept"}}'),
        ('org-odd', 'Odd', 'odd', '{"events":"not-an-object"}'),
        ('org-ld', 'LD Tennis', 'ld-tennis', '{}');
      INSERT INTO events (id, organisation_id, name, slug, starts_at, ends_at, timezone, status) VALUES
        ('ev-grad', 'org-ld', 'Year 12 Graduation', 'grad', '2030-11-18T09:00:00Z', '2030-11-18T13:00:00Z', 'Australia/Adelaide', 'PUBLISHED');
    `)
    mod = await import('@/lib/organisations/eveEnablement')
    ;({ resolvePublicEvent } = await import('@/lib/events/publicResolve'))
    login = await import('@/lib/ticketing/login')
  }, 90_000)

  afterAll(async () => {
    await db.pool?.end().catch(() => {})
    try { execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' }) } catch { /* already gone */ }
  })

  it('an organisation with no setting reads as disabled', async () => {
    expect(await mod.getOrganisationEveEnabled('org-plain')).toBe(false)
    expect(await mod.getOrganisationEveEnabled('org-null')).toBe(false)
    expect(await mod.getOrganisationEveEnabled('missing')).toBeNull()
  })

  it('enabling creates settings.events from {} and from NULL settings', async () => {
    expect(await mod.setOrganisationEveEnabled('org-plain', true)).toEqual({ before: false, after: true })
    expect(await settingsOf('org-plain')).toEqual({ events: { eveEnabled: true } })
    expect(await mod.setOrganisationEveEnabled('org-null', true)).toEqual({ before: false, after: true })
    expect(await settingsOf('org-null')).toEqual({ events: { eveEnabled: true } })
  })

  it('every sibling key — inside settings.events and every other namespace — is preserved, and the value is a JSON boolean', async () => {
    await mod.setOrganisationEveEnabled('org-rich', true)
    expect(await settingsOf('org-rich')).toEqual({
      branding: { name: 'Rich Co', publicEmail: 'hi@rich.example' },
      commercial: { businessProfile: { tradingName: 'Rich' } },
      events: { other: 'kept', eveEnabled: true },
    })
    const [{ t }] = await q<{ t: string }>(`SELECT jsonb_typeof(settings #> '{events,eveEnabled}') AS t FROM organisations WHERE id = 'org-rich'`)
    expect(t).toBe('boolean')
    expect(await mod.setOrganisationEveEnabled('org-rich', false)).toEqual({ before: true, after: false })
    expect((await settingsOf('org-rich') as { events: unknown }).events).toEqual({ other: 'kept', eveEnabled: false })
  })

  it('a non-object settings.events is replaced by a well-formed object rather than merged into', async () => {
    await mod.setOrganisationEveEnabled('org-odd', true)
    expect(await settingsOf('org-odd')).toEqual({ events: { eveEnabled: true } })
  })

  it('only the target organisation changes; a missing organisation is a no-op returning null', async () => {
    expect(await mod.setOrganisationEveEnabled('missing', true)).toBeNull()
    expect(await settingsOf('org-ld')).toEqual({})
  })

  it('resolvePublicEvent: LD Tennis-style org (Events + PUBLISHED) resolves with eveEnabled false until explicitly enabled', async () => {
    const before = await resolvePublicEvent('ld-tennis', 'grad')
    expect(before.ok && before.eveEnabled).toBe(false)
    expect(before.ok).toBe(true)
    await mod.setOrganisationEveEnabled('org-ld', true)
    const after = await resolvePublicEvent('ld-tennis', 'grad')
    expect(after.ok && after.eveEnabled).toBe(true)
  })

  it('Eve organiser portal: the super_admin organisation list and the eligibility check use the same JSON-boolean rule', async () => {
    await q(`INSERT INTO modules (key) VALUES ('events')`)
    await q(`INSERT INTO organisations (id, name, slug, settings) VALUES
      ('org-p-on', 'Portal On', 'p-on', '{"events":{"eveEnabled":true}}'),
      ('org-p-str', 'Portal String', 'p-str', '{"events":{"eveEnabled":"true"}}'),
      ('org-p-off', 'Portal Off', 'p-off', '{"events":{"eveEnabled":false}}'),
      ('org-p-none', 'Portal None', 'p-none', NULL)`)
    await q(`INSERT INTO organisation_modules (organisation_id, module_key)
      SELECT id, 'events' FROM organisations WHERE id LIKE 'org-p-%'`)
    const listed = (await login.listEligibleOrganisations()).map(o => o.id).filter(id => id.startsWith('org-p-'))
    expect(listed).toEqual(['org-p-on'])
    expect(await login.organisationEligibility('org-p-on')).toBe('ok')
    for (const id of ['org-p-str', 'org-p-off', 'org-p-none']) expect(await login.organisationEligibility(id), id).toBe('not_enabled')
    await mod.setOrganisationEveEnabled('org-p-off', true)
    expect((await login.listEligibleOrganisations()).map(o => o.id)).toContain('org-p-off')
  })
})
