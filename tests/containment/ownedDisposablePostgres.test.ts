import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  OWNER_LABEL,
  MARKER_TABLE,
  claimRunSchema,
  dropOwnedSchema,
  schemaFor,
  startOwnedPostgres,
  stopOwnedContainer,
  type Exec,
  type OwnedRun,
  type QueryClient,
} from '../helpers/ownedDisposablePostgres'

// Ownership guard for the founder-overview real-Postgres test. No Docker or
// database is used here: a fake query client and a fake `docker` exec record
// every statement, so these tests prove that destructive SQL and container
// removal are refused unless this run's ownership is proven.

const TOKEN = 'a'.repeat(24)
const OTHER = 'b'.repeat(24)

function runFor(token = TOKEN, over: Partial<OwnedRun> = {}): OwnedRun {
  return {
    token,
    containerId: 'c0ffee0123456789',
    containerName: `bb-founder-overview-${token}`,
    schema: schemaFor(token),
    connectionString: `postgresql://u${token}:${token}@127.0.0.1:55001/d${token}`,
    ...over,
  }
}

function fakeClient(marker: string[] | 'missing'): QueryClient & { statements: string[] } {
  const statements: string[] = []
  return {
    statements,
    query: vi.fn(async (text: string) => {
      statements.push(text)
      if (text.startsWith('SELECT token FROM')) {
        if (marker === 'missing') throw new Error('relation does not exist')
        return { rows: marker.map(token => ({ token })) }
      }
      return { rows: [] }
    }),
  }
}

function fakeExec(label: string, inspect?: string): Exec & { calls: string[][] } {
  const calls: string[][] = []
  const exec = ((file: string, args: string[]) => {
    calls.push([file, ...args])
    if (args[0] === 'inspect' && args[2].includes('{{.Id}}')) return inspect ?? `c0ffee0123456789abcdef /bb-founder-overview-${TOKEN} ${label}`
    if (args[0] === 'inspect') return label
    return ''
  }) as Exec & { calls: string[][] }
  exec.calls = calls
  return exec
}

const drops = (c: { statements: string[] }) => c.statements.filter(s => /\b(DROP|TRUNCATE|DELETE)\b/i.test(s))

describe('destructive SQL requires proven ownership', () => {
  it('correct label + marker: drops exactly this run’s schema and nothing else', async () => {
    const client = fakeClient([TOKEN])
    await dropOwnedSchema(client, runFor(), fakeExec(TOKEN))
    expect(drops(client)).toEqual([`DROP SCHEMA founder_overview_${TOKEN} CASCADE`])
  })

  it('missing ownership marker: refused, no destructive statement', async () => {
    const client = fakeClient('missing')
    await expect(dropOwnedSchema(client, runFor(), fakeExec(TOKEN))).rejects.toThrow('ownership marker missing')
    expect(drops(client)).toEqual([])
  })

  it.each([
    ['another run’s token', [OTHER]],
    ['no marker row', []],
    ['two marker rows', [TOKEN, TOKEN]],
  ])('marker with %s: refused, no destructive statement', async (_label, rows) => {
    const client = fakeClient(rows as string[])
    await expect(dropOwnedSchema(client, runFor(), fakeExec(TOKEN))).rejects.toThrow('ownership marker does not match')
    expect(drops(client)).toEqual([])
  })

  it('container label belongs to another run (or is absent): refused before the database is touched', async () => {
    for (const label of [OTHER, '', '<no value>']) {
      const client = fakeClient([TOKEN])
      await expect(dropOwnedSchema(client, runFor(), fakeExec(label))).rejects.toThrow('container label does not match')
      expect(client.statements).toEqual([])
    }
  })

  it('a matching database name / loopback URL alone is not enough', async () => {
    // Right-looking URL, but the schema is not the token-derived one.
    const client = fakeClient([TOKEN])
    await expect(dropOwnedSchema(client, runFor(TOKEN, { schema: 'public' }), fakeExec(TOKEN))).rejects.toThrow('schema does not match')
    expect(client.statements).toEqual([])
  })

  it('a non-loopback connection is refused', async () => {
    const client = fakeClient([TOKEN])
    await expect(dropOwnedSchema(client, runFor(TOKEN, { connectionString: `postgresql://u:p@db.example.com:5432/d${TOKEN}` }), fakeExec(TOKEN))).rejects.toThrow('not a loopback')
    expect(client.statements).toEqual([])
  })

  it('a malformed token cannot be used to build a schema name', async () => {
    expect(() => schemaFor('x; DROP SCHEMA public')).toThrow('invalid run token')
    const client = fakeClient([TOKEN])
    await expect(dropOwnedSchema(client, runFor(TOKEN, { token: 'public' }), fakeExec('public'))).rejects.toThrow()
    expect(client.statements).toEqual([])
  })

  it('claiming refuses a pre-existing schema (no IF NOT EXISTS) and writes the token marker', async () => {
    const client = fakeClient([TOKEN])
    await claimRunSchema(client, runFor())
    expect(client.statements[0]).toBe(`CREATE SCHEMA founder_overview_${TOKEN}`)
    expect(client.statements.join('\n')).not.toMatch(/IF NOT EXISTS|DROP/)
    expect(client.statements[1]).toContain(`founder_overview_${TOKEN}.${MARKER_TABLE}`)
  })
})

describe('container cleanup removes only this run’s container', () => {
  it('id, name and label match: removes exactly that container', async () => {
    const exec = fakeExec(TOKEN)
    await stopOwnedContainer(runFor(), exec)
    const rm = exec.calls.filter(c => c[1] === 'rm')
    expect(rm).toEqual([['docker', 'rm', '-f', 'c0ffee0123456789abcdef']])
  })

  it.each([
    ['label of another run', `c0ffee0123456789abcdef /bb-founder-overview-${TOKEN} ${OTHER}`],
    ['another container name', `c0ffee0123456789abcdef /postgres ${TOKEN}`],
    ['another container id', `deadbeef00000000 /bb-founder-overview-${TOKEN} ${TOKEN}`],
  ])('%s: refused, nothing removed', async (_l, inspect) => {
    const exec = fakeExec(TOKEN, inspect)
    await expect(stopOwnedContainer(runFor(), exec)).rejects.toThrow('not owned by this run')
    expect(exec.calls.some(c => c[1] === 'rm')).toBe(false)
  })
})

describe('no fallback to application or Production connection strings', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('the connection string comes only from the self-started, labelled loopback container', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@prod.example.com:5432/neondb'
    process.env.FOUNDER_OVERVIEW_TEST_DATABASE_URL = 'postgresql://x:y@127.0.0.1:5432/founderoverviewtest'
    const calls: string[][] = []
    const exec: Exec = (file, args) => {
      calls.push([file, ...args])
      if (args[0] === 'run') return 'newcontainerid123'
      if (args[0] === 'port') return '127.0.0.1:55123'
      return ''
    }
    const run = await startOwnedPostgres(exec)
    expect(run.connectionString).toBe(`postgresql://u${run.token}:${run.token}@127.0.0.1:55123/d${run.token}`)
    expect(run.connectionString).not.toContain('prod.example.com')
    const dockerRun = calls.find(c => c[1] === 'run')!
    expect(dockerRun).toContain(`${OWNER_LABEL}=${run.token}`)
    expect(dockerRun).toContain('127.0.0.1::5432')
    expect(dockerRun).toContain('--rm')
  })

  it('refuses (and removes its own container) if Docker did not bind to loopback', async () => {
    const calls: string[][] = []
    let token = ''
    const exec: Exec = (file, args) => {
      calls.push([file, ...args])
      if (args[0] === 'run') { token = args[args.indexOf('--label') + 1].split('=')[1]; return 'cid0000000000001' }
      if (args[0] === 'port') return '0.0.0.0:55123'
      if (args[0] === 'inspect') return `cid0000000000001 /bb-founder-overview-${token} ${token}`
      return ''
    }
    await expect(startOwnedPostgres(exec)).rejects.toThrow('not bound to loopback')
    expect(calls.filter(c => c[1] === 'rm')).toEqual([['docker', 'rm', '-f', 'cid0000000000001']])
  })

  it('neither the helper nor the real-Postgres test reads a connection string from the environment', () => {
    const helper = fs.readFileSync(path.resolve(__dirname, '../helpers/ownedDisposablePostgres.ts'), 'utf-8')
    const suite = fs.readFileSync(path.resolve(__dirname, 'founderClientOverviewRealPostgres.test.ts'), 'utf-8')
    expect(helper).not.toContain('process.env')
    expect([...suite.matchAll(/process\.env\.(\w+)/g)].map(m => m[1])).toEqual(['FOUNDER_OVERVIEW_REAL_PG'])
    expect(suite).not.toMatch(/DATABASE_URL|POSTGRES_URL|NEON/)
    // Every destructive statement in the suite is preceded by an ownership check.
    expect(suite).not.toMatch(/DROP TABLE/)
    expect(suite).toMatch(/assertRunOwnership\(state\.pool!, run!\)\s*\n\s*await state\.pool!\.query\(`TRUNCATE/)
    expect(suite).toContain('await owned.dropOwnedSchema(state.pool, run)')
  })
})
