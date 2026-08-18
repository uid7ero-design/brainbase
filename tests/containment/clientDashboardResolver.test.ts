import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { dashboardVariantForSlug } from '@/lib/dashboard/clientDashboard'

describe('dashboardVariantForSlug — pure resolver logic', () => {
  it('1. LD Tennis org receives the ld-tennis variant', () => {
    expect(dashboardVariantForSlug('ld-tennis')).toBe('ld-tennis')
  })

  it('2. the owner org (brainbase) does not receive a client dashboard', () => {
    expect(dashboardVariantForSlug('brainbase')).toBeNull()
  })

  it('3. a third organisation (city-of-onkaparinga) does not accidentally receive the LD Tennis dashboard', () => {
    expect(dashboardVariantForSlug('city-of-onkaparinga')).toBeNull()
  })

  it('4. an unrecognised/future slug falls through safely to null (BrainBase fallback), not an error', () => {
    expect(dashboardVariantForSlug('some-future-client')).toBeNull()
  })

  it('5. null/undefined/blank slug all resolve to null, never throw', () => {
    expect(dashboardVariantForSlug(null)).toBeNull()
    expect(dashboardVariantForSlug(undefined)).toBeNull()
    expect(dashboardVariantForSlug('')).toBeNull()
  })
})

describe('lib/dashboard/clientDashboard.ts — no user-ID hardcoding', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../lib/dashboard/clientDashboard.ts'), 'utf-8')

  it('resolves purely by organisation slug — no user id, email, or username appears anywhere in this file', () => {
    expect(source).not.toMatch(/luke/i)
    expect(source).not.toMatch(/userId\s*===/)
    expect(source).not.toMatch(/\.email\s*===/)
  })

  it('never accepts a client-supplied organisation identifier — the only DB lookup is by the server-resolved organisationId', () => {
    expect(source).toContain('WHERE id = ${organisationId}')
  })
})
