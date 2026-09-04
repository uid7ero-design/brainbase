import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.5F — UI wiring for the new comment.created `detail` (excerpt)
// line in both the board Activity feed and the Item Activity tab. Static
// source-text containment only (see AGENTS.md/CLAUDE.md and every other
// containment test file's own note) — event-type/formatting behavior
// itself is covered with real function calls in
// tests/containment/organiserActivityExpandedFormat.test.ts.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const pageCode = stripComments(read('app/organiser/page.tsx'))

describe('BoardActivity and ItemActivity both render desc.detail (comment excerpts)', () => {
  it('exactly two render sites for desc.detail — one per component, matching the two activity surfaces', () => {
    const matches = pageCode.match(/\{desc\.detail && \(/g) ?? []
    expect(matches).toHaveLength(2)
  })

  it('the detail line is quoted and rendered above the diffs block, never dumped as raw JSON', () => {
    const idx = pageCode.indexOf('{desc.detail && (')
    expect(idx).toBeGreaterThan(-1)
    const block = pageCode.slice(idx, idx + 200)
    // A template-literal expression container (not raw JSX text) so the
    // quote marks around it never trip react/no-unescaped-entities.
    expect(block).toMatch(/\{`"\$\{desc\.detail\}"`\}/)
  })
})

describe('BoardActivity click-through remains item-only after D.4.5F', () => {
  it('comment/file events (entity_type comment/file) are never offered click-through — only entity_type === "item"', () => {
    const start = pageCode.indexOf('function BoardActivity(')
    const end = pageCode.indexOf('\n// ── ITEM DETAIL DRAWER', start)
    const block = pageCode.slice(start, end)
    expect(block).toMatch(/ev\.entity_type === "item" \? liveItemsById\[ev\.entity_id\] : undefined/)
  })
})

describe('describeBoardActivityEvent/describeActivityEvent imports unchanged in shape', () => {
  it('page.tsx imports both formatter entry points from the shared module, no duplicated inline event-type switch for board/group/comment/file', () => {
    expect(pageCode).toMatch(/import \{ describeActivityEvent, describeBoardActivityEvent, type ActivityEventLike \} from ["']@\/lib\/organiser\/activityFormat["']/)
    expect(pageCode).not.toMatch(/event_type === ['"]board\./)
    expect(pageCode).not.toMatch(/event_type === ['"]group\./)
  })
})
