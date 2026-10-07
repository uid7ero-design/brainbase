import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  canonicalEssioCreateTarget,
  canonicalJson,
  composeEssioWorkNotes,
  ESSIO_LIMITS,
  essioCreateRequestFingerprint,
  essioPayloadFingerprint,
  validateEssioHandoffV1,
  type EssioHandoffV1,
} from '@/lib/essioIntegration/handoffPayload';

// Essio integration B2 — pure/static coverage. Real-Postgres behaviour of the
// routes is proven by scripts/tests/verify-essio-integration-b2.sh.

const ROOT = path.resolve(__dirname, '../..');
// Normalise line endings: Windows checkouts (core.autocrlf=true) are CRLF.
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function doc(): EssioHandoffV1 {
  return {
    schema: 'essio.recommendation-handoff',
    version: 1,
    idempotency_key: '6f1c2a4e-3b7d-4d1e-9a52-2f0c8e7b1a90',
    source: {
      product: 'essio',
      organisation: { id: '31114a55-8ff1-4b05-b6fc-5efa33d93dcd', name: 'HLNA Labs' },
      site: { id: 'e28fda45-e31d-4b92-9dd0-796d90770039', name: 'HLNA Labs', origin: 'https://hlnalabs.com.au' },
      deep_link: 'https://essio.example/sites/e28fda45-e31d-4b92-9dd0-796d90770039/recommendations/9b1c7e2d-0a4f-4c8e-8d3b-6e2f1a7c5d40',
    },
    recommendation: {
      id: '9b1c7e2d-0a4f-4c8e-8d3b-6e2f1a7c5d40',
      key: 'IMPROVE_SEARCH_CTR:3f9a',
      type: 'IMPROVE_SEARCH_CTR',
      type_label: 'Improve search CTR',
      status: 'accepted',
      previous_instance: null,
      created_at: '2026-10-03T07:46:28.000Z',
      updated_at: '2026-10-03T07:46:28.000Z',
    },
    content: {
      title: 'Improve the search result for /pricing',
      summary: '/pricing had 1,840 impressions and 22 clicks in 28 days at average position 4.6.',
      reason: 'CTR is below half of the expected CTR for its position band.',
      suggested_action: 'Review the page title and meta description against the queries it appears for.',
      expected_check: 'CTR for this page over the next 28 days.',
      wording_source: 'deterministic',
    },
    target: { url: 'https://hlnalabs.com.au/pricing', path: '/pricing', query: null },
    assessment: { essio_priority_band: 'high', essio_priority_score: 72.5, essio_confidence: 0.72, note: 'Essio assessment.' },
    provenance: {
      calculation_version: 1,
      evidence_hash: 'a41c',
      data_through: '2026-09-29',
      crawl_run_id: null,
      evidence: [
        { type: 'search_metric_summary', id: 'sms-1', relationship: 'triggered_by', summary: 'x', metrics: { clicks: 22 }, period: { from: '2026-09-02', to: '2026-09-29' } },
      ],
    },
  };
}

const issuesOf = (value: unknown) => {
  const r = validateEssioHandoffV1(value);
  return r.ok ? [] : r.issues;
};

describe('Essio v1 handoff validation', () => {
  it('accepts the documented example', () => {
    expect(validateEssioHandoffV1(doc())).toEqual({ ok: true, value: doc() });
  });

  it('accepts previous_instance and nullable fields', () => {
    const d = doc();
    d.recommendation.previous_instance = { recommendation_id: '9b1c7e2d-0a4f-4c8e-8d3b-6e2f1a7c5d41', work_item_id: null };
    d.source.deep_link = null;
    d.content.expected_check = null;
    d.target = { url: null, path: null, query: 'pricing plans' };
    d.assessment.essio_priority_score = null;
    d.provenance.evidence = [];
    expect(issuesOf(d)).toEqual([]);
  });

  it('rejects anything outside the allow-list (AI wording, provider data, raw rows)', () => {
    expect(issuesOf({ ...doc(), presentation: {} })).toContain('handoff.presentation: is not allowed');
    expect(issuesOf({ ...doc(), content: { ...doc().content, ai_summary: 'x' } })).toContain('handoff.content.ai_summary: is not allowed');
    expect(issuesOf({ ...doc(), content: { ...doc().content, wording_source: 'ai_assisted' } })[0]).toMatch(/wording_source/);
    expect(issuesOf({ ...doc(), provenance: { ...doc().provenance, gsc_rows: [] } })).toContain('handoff.provenance.gsc_rows: is not allowed');
    expect(issuesOf({ ...doc(), source: { ...doc().source, model: 'claude' } })).toContain('handoff.source.model: is not allowed');
  });

  it('enforces integration text limits', () => {
    const over = (n: number) => 'x'.repeat(n + 1);
    const d = doc();
    expect(issuesOf({ ...d, content: { ...d.content, title: over(ESSIO_LIMITS.title) } })).toContain('handoff.content.title: must be at most 300 characters');
    expect(issuesOf({ ...d, content: { ...d.content, reason: over(ESSIO_LIMITS.longText) } })[0]).toMatch(/content.reason/);
    expect(issuesOf({ ...d, target: { ...d.target, query: over(ESSIO_LIMITS.query) } })[0]).toMatch(/target.query/);
    expect(issuesOf({ ...d, source: { ...d.source, deep_link: `https://e.x/${over(ESSIO_LIMITS.url)}` } })[0]).toMatch(/deep_link/);
    expect(issuesOf({ ...d, recommendation: { ...d.recommendation, key: over(ESSIO_LIMITS.key) } })[0]).toMatch(/recommendation.key/);
    const many = Array.from({ length: ESSIO_LIMITS.evidenceItems + 1 }, () => d.provenance.evidence[0]);
    expect(issuesOf({ ...d, provenance: { ...d.provenance, evidence: many } })[0]).toMatch(/at most 50 items/);
    expect(issuesOf({ ...d, content: { ...d.content, title: '   ' } })).toContain('handoff.content.title: must not be empty');
  });

  it('validates shapes, urls, ids and timestamps', () => {
    const d = doc();
    expect(issuesOf({ ...d, version: 2 })[0]).toMatch(/version/);
    expect(issuesOf({ ...d, idempotency_key: 'abc' })[0]).toMatch(/idempotency_key: must be a UUID/);
    expect(issuesOf({ ...d, source: { ...d.source, deep_link: 'javascript:alert(1)' } })[0]).toMatch(/http\(s\) URL/);
    expect(issuesOf({ ...d, recommendation: { ...d.recommendation, created_at: 'yesterday' } })[0]).toMatch(/ISO-8601/);
    expect(issuesOf({ ...d, assessment: { ...d.assessment, essio_confidence: 'high' } })[0]).toMatch(/finite number/);
    expect(issuesOf('nope')).toEqual(['handoff: must be an object']);
    const missing: Record<string, unknown> = { ...d };
    delete missing.content;
    expect(issuesOf(missing)).toContain('handoff.content: is required');
  });

  it('never echoes submitted values in issues', () => {
    const secretish = 'SENSITIVE-VALUE-1234';
    const d = doc();
    const issues = issuesOf({ ...d, content: { ...d.content, title: secretish.repeat(40) }, [secretish]: 1 });
    expect(issues.join('\n')).not.toContain('SENSITIVE-VALUE-1234SENSITIVE');
  });
});

describe('payload fingerprint', () => {
  it('matches Essio’s sha256(stableStringify(payload)) and ignores key order', () => {
    const d = doc();
    const expected = createHash('sha256').update(canonicalJson(d)).digest('hex');
    expect(essioPayloadFingerprint(d)).toBe(expected);
    expect(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }] })).toBe('{"a":[{"c":"x","d":null}],"b":1}');
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
          : v;
    const reversed = reverseKeys(d) as EssioHandoffV1;
    expect(Object.keys(reversed)[0]).toBe('provenance');
    expect(essioPayloadFingerprint(reversed)).toBe(expected);
    expect(essioPayloadFingerprint({ ...d, content: { ...d.content, title: 'Other' } })).not.toBe(expected);
  });
});

describe('create-request fingerprint', () => {
  const BOARD = '11111111-1111-4111-8111-111111111111';
  const GROUP = '22222222-2222-4222-8222-222222222222';

  it('is sha256 of exactly { target: { board_id, group_id }, handoff } and differs from the handoff fingerprint', () => {
    const d = doc();
    const target = canonicalEssioCreateTarget({ boardId: BOARD, groupId: GROUP });
    expect(target).toEqual({ board_id: BOARD, group_id: GROUP });
    const expected = createHash('sha256').update(canonicalJson({ target: { board_id: BOARD, group_id: GROUP }, handoff: d })).digest('hex');
    expect(essioCreateRequestFingerprint(target, d)).toBe(expected);
    expect(essioCreateRequestFingerprint(target, d)).not.toBe(essioPayloadFingerprint(d));
  });

  it('changes with the board, the group or the handoff; not with key order, case or an absent group', () => {
    const d = doc();
    const fp = (boardId: string, groupId: string | null, h = d) =>
      essioCreateRequestFingerprint(canonicalEssioCreateTarget({ boardId, groupId }), h);
    const base = fp(BOARD, null);
    expect(fp(BOARD.toUpperCase(), null)).toBe(base);
    expect(fp(BOARD, GROUP)).not.toBe(base);
    expect(fp(GROUP, null)).not.toBe(base);
    expect(fp(BOARD, null, { ...d, content: { ...d.content, title: 'Other' } })).not.toBe(base);
    const reversed = JSON.parse(JSON.stringify(d), (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    ) as EssioHandoffV1;
    expect(fp(BOARD, null, reversed)).toBe(base);
  });
});

describe('Organiser notes', () => {
  it('carries the deterministic content and labels the Essio assessment as source context', () => {
    const notes = composeEssioWorkNotes(doc());
    expect(notes).toContain(doc().content.summary);
    expect(notes).toContain(`Why: ${doc().content.reason}`);
    expect(notes).toContain(`Suggested action: ${doc().content.suggested_action}`);
    expect(notes).toContain(`How to check: ${doc().content.expected_check}`);
    expect(notes).toContain('high priority band, score 72.5, confidence 0.72');
    expect(notes).toContain('not a Brainbase priority');
    expect(notes).toContain(`Open in Essio: ${doc().source.deep_link}`);
    expect(composeEssioWorkNotes(doc())).toBe(notes);
  });
});

describe('static guarantees', () => {
  const work = read('app/api/integrations/essio/v1/work/route.ts');
  const targets = read('app/api/integrations/essio/v1/targets/route.ts');
  const create = read('lib/essioIntegration/createWork.ts');

  it('machine routes authenticate with the right scope and never read an organisation from the session', () => {
    expect(work).toContain("authenticateEssioRequest(req, 'work:create')");
    expect(targets).toContain("authenticateEssioRequest(req, 'targets:read')");
    for (const src of [work, targets]) {
      expect(src).not.toMatch(/requireSession|requireRole|getSession|getAuthSession|cookies\(/);
    }
  });

  it('admin routes require a database-validated super_admin', () => {
    for (const file of ['app/api/admin/integration-credentials/route.ts', 'app/api/admin/integration-credentials/[credentialId]/route.ts']) {
      const src = read(file);
      const handlers = src.match(/export async function (GET|POST|PATCH)/g) ?? [];
      const gates = src.match(/await requireRole\('super_admin'\)/g) ?? [];
      expect(handlers.length).toBeGreaterThan(0);
      expect(gates.length, file).toBe(handlers.length);
    }
  });

  it('create-work never imports Brainbase-owned fields from Essio', () => {
    const insert = create.slice(create.indexOf('INSERT INTO organiser_items'), create.indexOf('RETURNING id, board_id'));
    expect(insert).toContain('(id, board_id, organisation_id, group_id, name, notes, position)');
    expect(insert).not.toMatch(/priority|owner|due_date|assignee|status/);
  });

  it('only the Essio v1 routes use the Essio integration modules', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const users = walk(path.join(ROOT, 'app'))
      .filter((f) => /@\/lib\/essioIntegration\//.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .sort();
    expect(users).toEqual(['app/api/integrations/essio/v1/targets/route.ts', 'app/api/integrations/essio/v1/work/route.ts']);
  });

  it('no status-read, timeline-append or webhook route exists yet', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/api/integrations/essio/v1/work/[id]'))).toBe(false);
    expect(fs.readdirSync(path.join(ROOT, 'app/api/integrations/essio/v1')).sort()).toEqual(['targets', 'work']);
  });

  it('nothing in the B2 code logs', () => {
    for (const file of ['lib/essioIntegration/createWork.ts', 'lib/essioIntegration/targets.ts', 'lib/essioIntegration/http.ts', 'lib/essioIntegration/handoffPayload.ts', 'lib/integrationCredentials/adminHttp.ts']) {
      expect(read(file), file).not.toMatch(/console\./);
    }
  });
});
