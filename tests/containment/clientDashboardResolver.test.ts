import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { dashboardVariantForSlug } from '@/lib/dashboard/clientDashboard'

describe('dashboardVariantForSlug — pure resolver logic', () => {
  it('1. LD Tennis org receives the ld-tennis variant regardless of role', () => {
    expect(dashboardVariantForSlug('ld-tennis', 'manager')).toBe('ld-tennis')
    expect(dashboardVariantForSlug('ld-tennis', 'viewer')).toBe('ld-tennis')
    expect(dashboardVariantForSlug('ld-tennis', null)).toBe('ld-tennis')
  })

  it('2. Brainbase org + super_admin receives brainbase-hq (Founder OS)', () => {
    expect(dashboardVariantForSlug('brainbase', 'super_admin')).toBe('brainbase-hq')
  })

  it('7. Brainbase org WITHOUT super_admin does not receive Founder OS — falls through to BrainBase, same boundary its own APIs already enforce', () => {
    expect(dashboardVariantForSlug('brainbase', 'admin')).toBeNull()
    expect(dashboardVariantForSlug('brainbase', 'manager')).toBeNull()
    expect(dashboardVariantForSlug('brainbase', 'viewer')).toBeNull()
    expect(dashboardVariantForSlug('brainbase', null)).toBeNull()
    expect(dashboardVariantForSlug('brainbase', undefined)).toBeNull()
  })

  it('3. a third organisation (city-of-onkaparinga) does not accidentally receive the LD Tennis or Brainbase HQ dashboard, at any role', () => {
    expect(dashboardVariantForSlug('city-of-onkaparinga', 'super_admin')).toBeNull()
    expect(dashboardVariantForSlug('city-of-onkaparinga', 'manager')).toBeNull()
  })

  it('4. an unrecognised/future slug falls through safely to null (BrainBase fallback), not an error', () => {
    expect(dashboardVariantForSlug('some-future-client', 'super_admin')).toBeNull()
  })

  it('5. null/undefined/blank slug all resolve to null, never throw', () => {
    expect(dashboardVariantForSlug(null, 'super_admin')).toBeNull()
    expect(dashboardVariantForSlug(undefined, 'super_admin')).toBeNull()
    expect(dashboardVariantForSlug('', 'super_admin')).toBeNull()
  })
})

describe('lib/dashboard/clientDashboard.ts — no user-ID hardcoding', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../lib/dashboard/clientDashboard.ts'), 'utf-8')

  it('resolves purely by organisation slug (+ role for the owner org) — no user id, email, or username appears anywhere in this file', () => {
    expect(source).not.toMatch(/luke/i)
    expect(source).not.toMatch(/james/i)
    expect(source).not.toMatch(/userId\s*===/)
    expect(source).not.toMatch(/\.email\s*===/)
  })

  it('never accepts a client-supplied organisation identifier — the only DB lookup is by the server-resolved organisationId', () => {
    expect(source).toContain('WHERE id = ${organisationId}')
  })

  it('Brainbase HQ requires super_admin specifically, matching the boundary Founder OS\'s own APIs already enforce independently', () => {
    expect(source).toContain("role === 'super_admin' ? 'brainbase-hq' : null")
  })
})
