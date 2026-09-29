import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Account profiles — durable avatar + About me. Covers what
// tests/containment/accountSelfScopedAuthoritativeSession.test.ts does
// not: schema/Prisma-model truthfulness, the migration's own
// additivity, canonical-route wiring, UI containment for the "About
// me" relabel, and the /api/me projection that supplies the
// authenticated chrome (TopNav) its avatar.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const PROFILE_COLUMNS = [
  'first_name', 'last_name', 'display_name', 'avatar_url', 'bio',
  'job_title', 'department', 'phone', 'timezone', 'preferences', 'last_seen_at',
]

// ─── Schema / migration ──────────────────────────────────────────────

describe('Migration additivity — app/api/admin/migrate/route.ts step 16', () => {
  const migrateSrc = stripComments(read('app/api/admin/migrate/route.ts'))

  it('every required profile column is added additively (IF NOT EXISTS), never a destructive/blocking DDL form', () => {
    for (const col of PROFILE_COLUMNS) {
      const re = new RegExp(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}\\b`)
      expect(migrateSrc, `missing additive ALTER for ${col}`).toMatch(re)
    }
  })

  it('never drops or alters an existing column\'s type in this step (additive/backwards-compatible only)', () => {
    // stripComments() has already removed the "16. User profile fields"
    // comment marker itself — anchor on the first real statement of the
    // block instead.
    const step16Start = migrateSrc.indexOf('ADD COLUMN IF NOT EXISTS first_name')
    expect(step16Start).toBeGreaterThan(-1)
    const step16Block = migrateSrc.slice(step16Start, step16Start + 1200)
    expect(step16Block).not.toMatch(/DROP COLUMN/i)
    expect(step16Block).not.toMatch(/ALTER COLUMN/i)
    expect(step16Block).not.toMatch(/NOT NULL/i) // no new NOT NULL constraint — existing rows must remain valid
  })
})

describe('Prisma schema.prisma — User model truthfully mirrors the migrated shape', () => {
  const schemaSrc = read('prisma/schema.prisma')
  const userModelStart = schemaSrc.indexOf('model User {')
  const userModelEnd = schemaSrc.indexOf('\n}', userModelStart)
  const userModel = schemaSrc.slice(userModelStart, userModelEnd)

  it('declares every profile column the migration adds', () => {
    for (const col of PROFILE_COLUMNS) {
      expect(userModel, `User model missing ${col}`).toMatch(new RegExp(`\\b${col}\\s+(String|Json|DateTime)\\??`))
    }
  })

  it('every profile field is optional (nullable) — no existing user row is invalidated', () => {
    // Every profile column except preferences/timezone (which carry a
    // DB-level DEFAULT, matching the migration's own DEFAULT clauses)
    // must be declared with a `?` — a bare non-optional scalar would
    // make Prisma treat it as required, which no pre-migration row has.
    for (const col of ['first_name', 'last_name', 'display_name', 'avatar_url', 'bio', 'job_title', 'department', 'phone', 'last_seen_at']) {
      const re = new RegExp(`\\b${col}\\s+(String|DateTime)\\?`)
      expect(userModel, `${col} should be nullable/optional in the Prisma model`).toMatch(re)
    }
  })

  it('the original `name` column is untouched — still required, still a plain String', () => {
    expect(userModel).toMatch(/\bname\s+String\s/)
    expect(userModel).not.toMatch(/\bname\s+String\?/)
  })

  it('no role/status/organisation/auth field was touched by this change', () => {
    expect(userModel).toMatch(/\brole\s+UserRole\s+@default\(VIEWER\)/)
    expect(userModel).toMatch(/\bstatus\s+UserStatus\s+@default\(ACTIVE\)/)
    expect(userModel).toMatch(/\borganisation_id\s+String\s/)
  })
})

// ─── Canonical route ─────────────────────────────────────────────────

describe('Canonical profile route — /account/profile, per PR #297\'s nav architecture', () => {
  it('the nav model\'s "My profile" link points at /account/profile', () => {
    const navSrc = read('components/nav/navModel.ts')
    expect(navSrc).toMatch(/id:\s*'profile'.*href:\s*'\/account\/profile'/)
  })

  it('/account/profile GET route selects every profile column, including avatar_url', () => {
    const src = read('app/account/profile/page.tsx')
    for (const col of ['first_name', 'last_name', 'display_name', 'avatar_url', 'bio', 'job_title', 'department', 'phone', 'timezone', 'preferences']) {
      expect(src).toContain(col)
    }
  })

  it('the legacy /profile page still exists (password + secure-mode settings, not duplicated on /account/profile) and is not linked from the nav model', () => {
    // navModel.test.ts's own containment guard already bans '/profile'
    // from appearing in the nav model at all — this just documents WHY
    // that file is still present rather than deleted: it owns password
    // change + Secure Mode, neither of which /account/profile
    // implements, so removing it would be an unrelated feature
    // regression this phase is explicitly not scoped to make.
    expect(fs.existsSync(path.join(process.cwd(), 'app/profile/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(process.cwd(), 'app/profile/ProfileClient.tsx'))).toBe(true)
    const legacySrc = read('app/profile/ProfileClient.tsx')
    // The legacy page's own editable surface is Display Name (the plain
    // `users.name` column, via updateProfile()), password, and Secure
    // Mode — never first_name/last_name/display_name/bio/avatar, which
    // would be genuine duplicate editable-profile logic.
    expect(legacySrc).not.toMatch(/name="bio"|name="avatar_url"|name="job_title"/)
  })
})

// ─── UI — About me relabel + avatar affordances ────────────────────

describe('ProfileClient — About me UI', () => {
  const src = stripComments(read('app/account/profile/ProfileClient.tsx'))

  it('the edit-mode field is labelled "About me", not "Bio"', () => {
    expect(src).toMatch(/label="About me"/)
    expect(src).not.toMatch(/label="Bio"/)
  })

  it('the underlying field/DB key remains `bio` (relabel only, no field rename)', () => {
    expect(src).toMatch(/name="bio"/)
    expect(src).toMatch(/form\.bio/)
  })

  it('enforces the same max length client-side (maxLength attribute) that the server validates', () => {
    expect(src).toMatch(/maxLength=\{ABOUT_ME_MAX_LENGTH\}/)
  })

  it('shows a live character count', () => {
    expect(src).toMatch(/value\.length\s*\/\s*ABOUT_ME_MAX_LENGTH|\{value\.length\}\s*\/\s*\{ABOUT_ME_MAX_LENGTH\}/)
  })

  it('About me is shown in view mode only when populated (sensible empty state — no empty box rendered)', () => {
    expect(src).toMatch(/\{form\.bio\s*&&/)
  })
})

describe('ProfileClient — avatar upload affordances', () => {
  const src = stripComments(read('app/account/profile/ProfileClient.tsx'))

  it('accepts only the shared allow-list constant — no hardcoded GIF/SVG in the file input', () => {
    expect(src).toMatch(/accept=\{AVATAR_ACCEPT_ATTR\}/)
    expect(src).not.toMatch(/accept="image\/jpeg,image\/png,image\/webp,image\/gif"/)
  })

  it('communicates accepted formats and the max size to the user', () => {
    expect(src).toMatch(/JPEG, PNG or WebP/)
    expect(src).toMatch(/MAX_AVATAR_MB/)
  })

  it('the change-photo control has an accessible name and is keyboard-reachable (a real <button>, not a bare clickable <div>)', () => {
    expect(src).toMatch(/aria-label="Change profile photo"/)
    expect(src).toMatch(/<button\s+type="button"\s+className="pf-avatar"/)
  })

  it('falls back to initials when no avatar is set', () => {
    expect(src).toMatch(/const initials\s*=/)
    expect(src).toMatch(/:\s*avatarUploading\s*\?\s*'…'\s*:\s*initials/)
  })

  it('exposes upload errors accessibly via the shared FormError component', () => {
    expect(src).toMatch(/avatarError\s*&&[\s\S]*?<FormError>\{avatarError\}<\/FormError>/)
  })

  it('a successful upload updates local state immediately — no requirement to also click Save', () => {
    const uploadFnStart = src.indexOf('async function uploadAvatar')
    const uploadFnEnd = src.indexOf('\n  }', uploadFnStart)
    const uploadFn = src.slice(uploadFnStart, uploadFnEnd)
    expect(uploadFn).toMatch(/setForm\(f => \(\{ \.\.\.f, avatar_url: data\.avatarUrl! \}\)\)/)
    expect(uploadFn).not.toMatch(/\bsave\(\)/)
  })

  it('the generic Save Changes submit never sends avatar_url — it is already persisted by the upload endpoint', () => {
    const saveFnStart = src.indexOf('async function save(')
    const saveFnEnd = src.indexOf('\n  }', saveFnStart)
    const saveFn = src.slice(saveFnStart, saveFnEnd)
    expect(saveFn).not.toMatch(/avatar_url/)
  })
})

// ─── Projection — /api/me supplies the authenticated chrome its avatar ─

const getSessionMock = vi.fn()
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>()
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))
function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }

const { GET: getMe } = await import('@/app/api/me/route')

describe('GET /api/me — avatar projection', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    sqlMock.mockClear()
    responseQueue = []
    callCount = 0
  })

  it('returns the saved avatar_url (and the rest of the profile row) under `profile`, the same shape TopNav reads', async () => {
    getSessionMock.mockResolvedValue({ userId: 'user1', organisationId: 'org-a', role: 'manager', name: 'User One' })
    queue(
      [{ id: 'user1', organisation_id: 'org-a', role: 'manager' }], // requireSession lookup
      [{ id: 'user1', username: 'u1', name: 'User One', avatar_url: 'https://abc.public.blob.vercel-storage.com/users/user1/avatar/x.png', bio: 'Hi there' }], // profile + org read (first row consumed)
      [], // last_seen_at update
      [], // enabledModules
      [], // enabledCapabilities
    )
    const res = await getMe()
    expect(res.status).toBe(200)
    const body = await res.json() as { profile: { avatar_url?: string } | null }
    expect(body.profile?.avatar_url).toBe('https://abc.public.blob.vercel-storage.com/users/user1/avatar/x.png')
  })

  it('never returns a 401 caller\'s avatar — unauthenticated returns null profile', async () => {
    getSessionMock.mockResolvedValue(null)
    const res = await getMe()
    expect(res.status).toBe(401)
  })
})
