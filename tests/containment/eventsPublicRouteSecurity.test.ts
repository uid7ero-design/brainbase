import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 2 — proves the single most safety-critical
// design decision in this phase: the public Events page lives at
// '/e/[organisationSlug]/[eventSlug]', NOT under '/events', specifically
// because middleware.ts's PUBLIC array is matched by exact-path OR
// prefix (`pathname === p || pathname.startsWith(p + '/')`) — adding
// '/events' itself to that array would also make the Phase 1 staff
// management pages ('/events', '/events/[id]') public. This is proven
// two ways: (1) behaviorally, by calling the real middleware() function
// against real pathnames with no session cookie, and (2) via a static,
// block-scoped read of the PUBLIC array itself — so a regression is
// caught whether it comes from a middleware.ts logic change or from
// someone quietly adding '/events' back to the array.

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

// Block-scoped extraction of the `const PUBLIC = [...]` array literal —
// avoids a whole-file false positive (e.g. a comment elsewhere in the
// file mentioning '/events').
function extractPublicArray(): string {
  const src = stripComments(read('middleware.ts'))
  const start = src.indexOf('const PUBLIC = [')
  const end = src.indexOf('];', start)
  return src.slice(start, end)
}

describe('middleware.ts — PUBLIC array static protection', () => {
  it("'/e' is present in the PUBLIC array", () => {
    expect(extractPublicArray()).toMatch(/'\/e'/)
  })

  it("'/events' is NOT present in the PUBLIC array (would expose staff management pages via prefix matching)", () => {
    const block = extractPublicArray()
    // Matches a bare '/events' entry but not '/events/something-else' —
    // there is no such longer entry in this repo, so a simple literal
    // check is sufficient and won't false-positive on '/e' itself.
    expect(block).not.toMatch(/'\/events'/)
  })
})

// Behavioral proof: drive the actual middleware() function.
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return {
    ...actual,
    decrypt: vi.fn().mockResolvedValue(null), // no valid session, for every test in this file
  }
})

const { middleware } = await import('@/middleware')

function makeReq(pathname: string) {
  const url = `http://localhost${pathname}`
  return {
    nextUrl: { pathname, clone: () => new URL(url) },
    headers: new Headers(),
    cookies: { get: () => undefined },
    url,
  } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('middleware.ts — behavioral proof (no session cookie, real middleware() call)', () => {
  it("'/e/ld-tennis/graduation' is public — passes through without a redirect", async () => {
    const res = await middleware(makeReq('/e/ld-tennis/graduation'))
    // NextResponse.next() has no 'location' header; a redirect does.
    expect(res.headers.get('location')).toBeNull()
  })

  it("'/e' itself is public — passes through without a redirect", async () => {
    const res = await middleware(makeReq('/e'))
    expect(res.headers.get('location')).toBeNull()
  })

  // Mutation I proof target: staff management pages must remain
  // protected. If '/events' were ever added to PUBLIC (directly, or via
  // a careless '/e' -> '/events' rename), these two would start passing
  // through instead of redirecting, and this test would fail.
  it("'/events' (staff management list) redirects to /login with no session — remains protected", async () => {
    const res = await middleware(makeReq('/events'))
    expect(res.headers.get('location')).toMatch(/\/login/)
  })

  it("'/events/event-1' (staff management detail) redirects to /login with no session — remains protected", async () => {
    const res = await middleware(makeReq('/events/event-1'))
    expect(res.headers.get('location')).toMatch(/\/login/)
  })
})
