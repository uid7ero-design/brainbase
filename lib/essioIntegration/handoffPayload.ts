import { createHash } from 'crypto';

// Essio integration B2 — the frozen Essio v1 handoff document
// ("essio.recommendation-handoff", version 1), as Essio stores and sends it.
// Design: docs/integrations/essio.md.
//
// Validation is strict and allow-list based: every key is known, unknown keys
// are rejected (so AI wording, provider/model data, raw crawl or Search
// Console rows can never ride along), and every text field has an
// integration-specific length cap enforced before anything touches the
// database. Validation issues name the offending path and rule only — never
// the submitted value.

export const ESSIO_HANDOFF_SCHEMA = 'essio.recommendation-handoff';
export const ESSIO_HANDOFF_VERSION = 1;
/** Hard cap on the raw request body (bytes), checked before parsing. */
export const ESSIO_MAX_BODY_BYTES = 65_536;

export const ESSIO_LIMITS = Object.freeze({
  title: 300,
  longText: 4_000,
  expectedCheck: 2_000,
  shortText: 200,
  key: 300,
  id: 128,
  code: 100,
  url: 2_048,
  query: 500,
  note: 500,
  evidenceItems: 50,
  evidenceSummary: 1_000,
  metricsPerItem: 8,
  date: 40,
});

export interface EssioHandoffV1 {
  schema: typeof ESSIO_HANDOFF_SCHEMA;
  version: typeof ESSIO_HANDOFF_VERSION;
  idempotency_key: string;
  source: {
    product: 'essio';
    organisation: { id: string; name: string };
    site: { id: string; name: string; origin: string };
    deep_link: string | null;
  };
  recommendation: {
    id: string;
    key: string;
    type: string;
    type_label: string;
    status: string;
    previous_instance: { recommendation_id: string; work_item_id: string | null } | null;
    created_at: string;
    updated_at: string;
  };
  content: {
    title: string;
    summary: string;
    reason: string;
    suggested_action: string;
    expected_check: string | null;
    wording_source: 'deterministic';
  };
  target: { url: string | null; path: string | null; query: string | null };
  assessment: {
    essio_priority_band: string;
    essio_priority_score: number | null;
    essio_confidence: number | null;
    note: string;
  };
  provenance: {
    calculation_version: number;
    evidence_hash: string;
    data_through: string | null;
    crawl_run_id: string | null;
    evidence: Array<{
      type: string;
      id: string;
      relationship: string;
      summary: string | null;
      metrics: Record<string, number> | null;
      period: { from: string; to: string } | null;
    }>;
  };
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

type Obj = Record<string, unknown>;

class Checker {
  readonly issues: string[] = [];

  fail(path: string, rule: string): void {
    if (this.issues.length < 50) this.issues.push(`${path}: ${rule}`);
  }

  object(value: unknown, path: string, keys: readonly string[]): Obj | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.fail(path, 'must be an object');
      return null;
    }
    const obj = value as Obj;
    for (const key of Object.keys(obj)) if (!keys.includes(key)) this.fail(`${path}.${key}`, 'is not allowed');
    for (const key of keys) if (!(key in obj)) this.fail(`${path}.${key}`, 'is required');
    return obj;
  }

  text(value: unknown, path: string, max: number, opts: { nullable?: boolean; allowEmpty?: boolean } = {}): void {
    if (value === null && opts.nullable) return;
    if (typeof value !== 'string') return this.fail(path, opts.nullable ? 'must be a string or null' : 'must be a string');
    if (!opts.allowEmpty && value.trim().length === 0) return this.fail(path, 'must not be empty');
    if (value.length > max) this.fail(path, `must be at most ${max} characters`);
  }

  literal(value: unknown, path: string, expected: string | number): void {
    if (value !== expected) this.fail(path, `must be ${JSON.stringify(expected)}`);
  }

  uuid(value: unknown, path: string): void {
    if (typeof value !== 'string' || !UUID_RE.test(value)) this.fail(path, 'must be a UUID');
  }

  url(value: unknown, path: string, nullable: boolean): void {
    if (value === null && nullable) return;
    if (typeof value !== 'string' || value.length > ESSIO_LIMITS.url) return this.fail(path, 'must be a URL');
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') this.fail(path, 'must be an http(s) URL');
      if (/\s/.test(value)) this.fail(path, 'must be a URL');
    } catch {
      this.fail(path, 'must be a URL');
    }
  }

  iso(value: unknown, path: string): void {
    if (typeof value !== 'string' || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
      this.fail(path, 'must be an ISO-8601 timestamp');
    }
  }

  num(value: unknown, path: string, nullable: boolean): void {
    if (value === null && nullable) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(path, 'must be a finite number');
  }
}

/** Validates a parsed JSON value as an Essio v1 handoff document. */
export function validateEssioHandoffV1(value: unknown): ValidationResult<EssioHandoffV1> {
  const c = new Checker();
  const L = ESSIO_LIMITS;
  const root = c.object(value, 'handoff', [
    'schema', 'version', 'idempotency_key', 'source', 'recommendation', 'content', 'target', 'assessment', 'provenance',
  ]);
  if (!root) return { ok: false, issues: c.issues };

  c.literal(root.schema, 'handoff.schema', ESSIO_HANDOFF_SCHEMA);
  c.literal(root.version, 'handoff.version', ESSIO_HANDOFF_VERSION);
  c.uuid(root.idempotency_key, 'handoff.idempotency_key');

  const source = c.object(root.source, 'handoff.source', ['product', 'organisation', 'site', 'deep_link']);
  if (source) {
    c.literal(source.product, 'handoff.source.product', 'essio');
    const org = c.object(source.organisation, 'handoff.source.organisation', ['id', 'name']);
    if (org) {
      c.text(org.id, 'handoff.source.organisation.id', L.id);
      c.text(org.name, 'handoff.source.organisation.name', L.shortText);
    }
    const site = c.object(source.site, 'handoff.source.site', ['id', 'name', 'origin']);
    if (site) {
      c.uuid(site.id, 'handoff.source.site.id');
      c.text(site.name, 'handoff.source.site.name', L.shortText);
      c.url(site.origin, 'handoff.source.site.origin', false);
    }
    c.url(source.deep_link, 'handoff.source.deep_link', true);
  }

  const rec = c.object(root.recommendation, 'handoff.recommendation', [
    'id', 'key', 'type', 'type_label', 'status', 'previous_instance', 'created_at', 'updated_at',
  ]);
  if (rec) {
    c.uuid(rec.id, 'handoff.recommendation.id');
    c.text(rec.key, 'handoff.recommendation.key', L.key);
    c.text(rec.type, 'handoff.recommendation.type', L.code);
    c.text(rec.type_label, 'handoff.recommendation.type_label', L.shortText);
    c.text(rec.status, 'handoff.recommendation.status', L.code);
    if (rec.previous_instance !== null) {
      const prev = c.object(rec.previous_instance, 'handoff.recommendation.previous_instance', ['recommendation_id', 'work_item_id']);
      if (prev) {
        c.uuid(prev.recommendation_id, 'handoff.recommendation.previous_instance.recommendation_id');
        c.text(prev.work_item_id, 'handoff.recommendation.previous_instance.work_item_id', L.id, { nullable: true });
      }
    }
    c.iso(rec.created_at, 'handoff.recommendation.created_at');
    c.iso(rec.updated_at, 'handoff.recommendation.updated_at');
  }

  const content = c.object(root.content, 'handoff.content', [
    'title', 'summary', 'reason', 'suggested_action', 'expected_check', 'wording_source',
  ]);
  if (content) {
    c.text(content.title, 'handoff.content.title', L.title);
    c.text(content.summary, 'handoff.content.summary', L.longText);
    c.text(content.reason, 'handoff.content.reason', L.longText);
    c.text(content.suggested_action, 'handoff.content.suggested_action', L.longText);
    c.text(content.expected_check, 'handoff.content.expected_check', L.expectedCheck, { nullable: true });
    c.literal(content.wording_source, 'handoff.content.wording_source', 'deterministic');
  }

  const target = c.object(root.target, 'handoff.target', ['url', 'path', 'query']);
  if (target) {
    c.url(target.url, 'handoff.target.url', true);
    c.text(target.path, 'handoff.target.path', L.url, { nullable: true });
    c.text(target.query, 'handoff.target.query', L.query, { nullable: true });
  }

  const assessment = c.object(root.assessment, 'handoff.assessment', [
    'essio_priority_band', 'essio_priority_score', 'essio_confidence', 'note',
  ]);
  if (assessment) {
    c.text(assessment.essio_priority_band, 'handoff.assessment.essio_priority_band', L.code);
    c.num(assessment.essio_priority_score, 'handoff.assessment.essio_priority_score', true);
    c.num(assessment.essio_confidence, 'handoff.assessment.essio_confidence', true);
    c.text(assessment.note, 'handoff.assessment.note', L.note);
  }

  const prov = c.object(root.provenance, 'handoff.provenance', [
    'calculation_version', 'evidence_hash', 'data_through', 'crawl_run_id', 'evidence',
  ]);
  if (prov) {
    if (!Number.isInteger(prov.calculation_version)) c.fail('handoff.provenance.calculation_version', 'must be an integer');
    c.text(prov.evidence_hash, 'handoff.provenance.evidence_hash', L.id);
    c.text(prov.data_through, 'handoff.provenance.data_through', L.date, { nullable: true });
    c.text(prov.crawl_run_id, 'handoff.provenance.crawl_run_id', L.id, { nullable: true });
    if (!Array.isArray(prov.evidence)) {
      c.fail('handoff.provenance.evidence', 'must be an array');
    } else if (prov.evidence.length > L.evidenceItems) {
      c.fail('handoff.provenance.evidence', `must have at most ${L.evidenceItems} items`);
    } else {
      prov.evidence.forEach((item, i) => {
        const p = `handoff.provenance.evidence[${i}]`;
        const e = c.object(item, p, ['type', 'id', 'relationship', 'summary', 'metrics', 'period']);
        if (!e) return;
        c.text(e.type, `${p}.type`, L.code);
        c.text(e.id, `${p}.id`, L.shortText);
        c.text(e.relationship, `${p}.relationship`, L.code);
        c.text(e.summary, `${p}.summary`, L.evidenceSummary, { nullable: true });
        if (e.metrics !== null) {
          if (!e.metrics || typeof e.metrics !== 'object' || Array.isArray(e.metrics)) {
            c.fail(`${p}.metrics`, 'must be an object or null');
          } else {
            const entries = Object.entries(e.metrics as Obj);
            if (entries.length > L.metricsPerItem) c.fail(`${p}.metrics`, `must have at most ${L.metricsPerItem} entries`);
            for (const [k, v] of entries) {
              if (k.length > L.code) c.fail(`${p}.metrics`, 'has an over-long key');
              c.num(v, `${p}.metrics.${k.slice(0, L.code)}`, false);
            }
          }
        }
        if (e.period !== null) {
          const period = c.object(e.period, `${p}.period`, ['from', 'to']);
          if (period) {
            c.text(period.from, `${p}.period.from`, L.date);
            c.text(period.to, `${p}.period.to`, L.date);
          }
        }
      });
    }
  }

  return c.issues.length === 0 ? { ok: true, value: value as EssioHandoffV1 } : { ok: false, issues: c.issues };
}

/**
 * Canonical JSON identical to Essio's stableStringify (object keys sorted,
 * arrays in order, primitives JSON-encoded), so the fingerprint Brainbase
 * stores equals the one Essio recorded for the same frozen payload.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Obj)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Essio handoff fingerprint: sha256 hex of the canonical frozen handoff
 * document — identity/provenance of the Essio payload (equal to the
 * fingerprint Essio records). No delivery metadata is included.
 */
export function essioPayloadFingerprint(payload: EssioHandoffV1): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

/** The Brainbase creation target, in canonical form (group absent ≡ null). */
export interface EssioCreateTarget {
  board_id: string;
  group_id: string | null;
}

export function canonicalEssioCreateTarget(target: { boardId: string; groupId: string | null }): EssioCreateTarget {
  return { board_id: target.boardId.toLowerCase(), group_id: target.groupId ? target.groupId.toLowerCase() : null };
}

/**
 * Brainbase create-request fingerprint: sha256 hex of the canonical
 * { target, handoff } — the complete, immutable Brainbase creation
 * instruction. Replay vs conflict is decided on this, so one idempotency key
 * can never redirect the same handoff to another board or group. Only the
 * request's own intent is included: no credential, organisation (it is never
 * request authority) or Brainbase-owned operational field.
 */
export function essioCreateRequestFingerprint(target: EssioCreateTarget, handoff: EssioHandoffV1): string {
  return createHash('sha256').update(canonicalJson({ target, handoff }), 'utf8').digest('hex');
}

function formatNumber(n: number | null, digits: number): string | null {
  return n === null ? null : Number(n.toFixed(digits)).toString();
}

/**
 * The Organiser item's notes: Essio's deterministic content, with the Essio
 * assessment clearly labelled as source context (not Brainbase priority).
 * Plain text, deterministic for a given payload.
 */
export function composeEssioWorkNotes(payload: EssioHandoffV1): string {
  const { content, assessment, target, provenance, source } = payload;
  const lines: string[] = [content.summary.trim(), '', `Why: ${content.reason.trim()}`, '', `Suggested action: ${content.suggested_action.trim()}`];
  if (content.expected_check) lines.push('', `How to check: ${content.expected_check.trim()}`);
  lines.push('', '— From Essio (source context) —');
  const score = formatNumber(assessment.essio_priority_score, 1);
  const confidence = formatNumber(assessment.essio_confidence, 2);
  const parts = [`${assessment.essio_priority_band} priority band`];
  if (score !== null) parts.push(`score ${score}`);
  if (confidence !== null) parts.push(`confidence ${confidence}`);
  lines.push(`Essio assessment: ${parts.join(', ')}. This is Essio's evidence-based assessment, not a Brainbase priority.`);
  if (target.url) lines.push(`Target: ${target.url}${target.query ? ` (query: "${target.query}")` : ''}`);
  else if (target.query) lines.push(`Target query: "${target.query}"`);
  if (provenance.data_through) lines.push(`Evidence through: ${provenance.data_through}`);
  lines.push(`Site: ${source.site.name} (${source.site.origin})`);
  if (source.deep_link) lines.push(`Open in Essio: ${source.deep_link}`);
  return lines.join('\n');
}
