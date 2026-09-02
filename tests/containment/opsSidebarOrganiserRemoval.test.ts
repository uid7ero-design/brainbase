import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.4E — Organiser was promoted to a first-class BrainBase
// workspace (its own TopNav capability item + OrganiserShell/OrganiserRail
// — see organiserShellBoundary.test.ts and clientNavOwnership.test.ts's
// "TopNav — Organiser nav item..." block). components/ops/Sidebar.tsx must
// no longer know about Organiser at all — not merely hide it conditionally
// (the D.4.4D experiment on the now-superseded
// fix/organiser-sidebar-capability-visibility branch did that, and is
// explicitly not reproduced here). This file proves the removal is total
// AND that every other Sidebar item (Command Centre and the rest of Core,
// all of Operational, all of Admin) is byte-for-byte unaffected.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const sidebarSource = read('components/ops/Sidebar.tsx')
const sidebarCode = stripComments(sidebarSource)

describe('components/ops/Sidebar.tsx contains no trace of Organiser', () => {
  it('no "/organiser" href anywhere in the file', () => {
    expect(sidebarCode).not.toContain('/organiser')
  })

  it('no "Organiser" label/string anywhere in the file', () => {
    expect(sidebarCode).not.toContain('Organiser')
  })

  it('no organiser capabilityKey / capability-filter machinery exists — Sidebar remained a plain, unconditional static nav; no per-item capability gating was introduced for this removal (matches origin/main baseline, not the superseded D.4.4D experiment)', () => {
    expect(sidebarCode).not.toMatch(/capabilityKey/)
    expect(sidebarCode).not.toMatch(/enabledCapabilities/)
  })

  it('the now-unused Organiser icon glyph (I.organiser) was removed from the icon map, not left as dead code', () => {
    expect(sidebarCode).not.toMatch(/\borganiser:\s*<svg/)
  })
})

describe('Sidebar\'s remaining items are exactly the pre-D.4.4E set, unaffected by the removal', () => {
  it('Core section: Command Centre, Day Job, AI Briefings, Reports, Uploads, Alerts — all present, Command Centre now immediately followed by Day Job', () => {
    for (const label of ['Command Centre', 'Day Job', 'AI Briefings', 'Reports', 'Uploads', 'Alerts']) {
      expect(sidebarCode).toMatch(new RegExp(`label: '${label}'`))
    }
    expect(sidebarCode).toMatch(
      /\{ icon: I\.command,\s*label: 'Command Centre',\s*href: '\/command',\s*exact: true \},\s*\n\s*\{ icon: I\.dayjob,\s*label: 'Day Job'/
    )
  })

  it('Operational section: Waste, Bin Maintenance, Illegal Dumping, Parks, Compliance, Assets, Infrastructure — all present, unmodified', () => {
    for (const label of ['Waste', 'Bin Maintenance', 'Illegal Dumping', 'Parks', 'Compliance', 'Assets', 'Infrastructure']) {
      expect(sidebarCode).toMatch(new RegExp(`label: '${label}'`))
    }
  })

  it('Admin section: Organisations, Users, Settings — all present, unmodified', () => {
    for (const label of ['Organisations', 'Users', 'Settings']) {
      expect(sidebarCode).toMatch(new RegExp(`label: '${label}'`))
    }
  })

  it('exactly 3 sections remain (Core, Operational, Admin) with the expected item counts (6 Core + 7 Operational + 3 Admin = 16 total nav items, one fewer than before this phase)', () => {
    const sectionLabels = sidebarCode.match(/label: '(Core|Operational|Admin)',/g) ?? []
    expect(sectionLabels).toHaveLength(3)
    const itemHrefs = sidebarCode.match(/href: '[^']+'/g) ?? []
    expect(itemHrefs).toHaveLength(16)
  })

  it('the render loop, NavItem component, collapse/theme-toggle footer, and SidebarProps are structurally unchanged — this was a data removal, not a redesign', () => {
    expect(sidebarCode).toMatch(/interface SidebarProps \{\s*\n\s*collapsed: boolean;\s*\n\s*onToggle: \(\) => void;\s*\n\s*pathname: string;\s*\n\s*alertCount\?: number;\s*\n\s*\}/)
    expect(sidebarCode).toMatch(/export default function Sidebar\(\{ collapsed, onToggle, pathname, alertCount = 0 \}: SidebarProps\)/)
    expect(sidebarCode).toMatch(/section\.items\.map\(item => \(/)
  })
})
