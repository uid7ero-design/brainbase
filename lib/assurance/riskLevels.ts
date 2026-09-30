import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import {
  AssuranceConfirmationRequiredError, AssuranceConflictError, AssuranceForbiddenError,
  AssuranceNotFoundError, AssuranceValidationError,
} from './errors';
import { isUuid, optionalBoolean, requiredText } from './input';
import {
  RISK_DESCRIPTION_MAX, RISK_NAME_MAX, RISK_RANK_MAX, SERIOUS_ACTIVE_LEVEL_COUNT, SERIOUS_CHANGE_CONFIRMATION,
  normaliseRiskCode, riskCodeProblem, type SeriousChangeDetails, type SeriousLevel,
} from './riskLevelRules';

// BrainBase Assurance — Settings → Risk levels (organisation-scoped
// configuration on the existing A0.1C table; no schema change).
//
//   * Never deleted. Levels are FK targets of incidents, investigations,
//     findings and cases; retiring one means is_active = false, which only
//     removes it from selectors for NEW records (lookups.listRiskLevels).
//   * Code is immutable after creation (a stable identifier).
//   * "Serious" is defined ONCE, by seriousRankFloorSql() below: the
//     dashboard uses it over the live table, and every configuration change
//     uses it over the current and the proposed level set to compute what
//     the change would do. A change that alters the serious set needs the
//     caller to acknowledge the exact resulting set.
//   * Every mutation: administer permission → current-org scope → input
//     validation → sql.transaction([per-org advisory lock, one guarded
//     statement]). The guarded statement re-reads the current state after
//     the lock (stale revision, target state, serious-set acknowledgement),
//     writes the change, and writes its audit row — both or neither.

// ── The one definition of "serious" ──────────────────────────────────────

/**
 * The lowest rank among the SERIOUS_ACTIVE_LEVEL_COUNT highest-ranked ACTIVE
 * levels of `levels` (a subquery exposing `rank` and `is_active`), or NULL
 * when there is no active level. A level is serious when active and
 * rank >= this floor (ranks are unique per organisation, so that is exactly
 * the top two). Used verbatim by the dashboard.
 */
export function seriousRankFloorSql(levels: ReturnType<typeof sql>) {
  return sql`(
    SELECT min(serious_top.rank) FROM (
      SELECT serious_src.rank FROM (${levels}) serious_src
      WHERE serious_src.is_active = true
      ORDER BY serious_src.rank DESC
      LIMIT ${SERIOUS_ACTIVE_LEVEL_COUNT}
    ) serious_top
  )`;
}

/** The organisation's live levels, as consumed by seriousRankFloorSql(). */
export function organisationLevelsSql(organisationId: string) {
  return sql`SELECT id::text AS id, code, name, rank, is_active FROM assurance_risk_levels WHERE organisation_id = ${organisationId}`;
}

/** Serious levels of `levels` as [{code, name}] in rank order (display). */
function seriousJsonSql(levels: ReturnType<typeof sql>) {
  return sql`(
    SELECT coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) ORDER BY s.rank DESC), '[]'::jsonb)
    FROM (${levels}) s WHERE s.is_active = true AND s.rank >= ${seriousRankFloorSql(levels)}
  )`;
}

/**
 * Serious level codes of `levels`, sorted by code in byte order (COLLATE "C",
 * matching the JS default sort used for the acknowledgement) — for set
 * comparison and acknowledgement.
 */
function seriousCodesSql(levels: ReturnType<typeof sql>) {
  return sql`(
    SELECT coalesce(array_agg(s.code ORDER BY s.code COLLATE "C"), '{}'::text[])
    FROM (${levels}) s WHERE s.is_active = true AND s.rank >= ${seriousRankFloorSql(levels)}
  )`;
}

type ProposedChange =
  | { kind: 'create'; code: string; name: string; rank: number; active: boolean }
  | { kind: 'modify'; id: string; name: string; rank: number; active: boolean };

/** The organisation's levels as they would be after `change`. */
function proposedLevelsSql(organisationId: string, change: ProposedChange) {
  if (change.kind === 'create') {
    return sql`
      SELECT id::text AS id, code, name, rank, is_active FROM assurance_risk_levels WHERE organisation_id = ${organisationId}
      UNION ALL
      SELECT 'proposed', ${change.code}::text, ${change.name}::text, ${change.rank}::int, ${change.active}::boolean
    `;
  }
  return sql`
    SELECT id::text AS id, code,
           CASE WHEN id = ${change.id}::uuid THEN ${change.name}::text ELSE name END AS name,
           CASE WHEN id = ${change.id}::uuid THEN ${change.rank}::int ELSE rank END AS rank,
           CASE WHEN id = ${change.id}::uuid THEN ${change.active}::boolean ELSE is_active END AS is_active
    FROM assurance_risk_levels WHERE organisation_id = ${organisationId}
  `;
}

// Stable text form of updated_at (microsecond precision) used as the
// optimistic-concurrency revision; no extra column is needed.
const REVISION = sql`to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

function lockStatement(organisationId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended('assurance-risk-levels:' || ${organisationId}, 0)) AS locked`;
}

// ── Reads ────────────────────────────────────────────────────────────────

export type RiskLevelAdminRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rank: number;
  is_active: boolean;
  requires_verification: boolean;
  serious: boolean;
  revision: string;
  created_at: string;
  updated_at: string;
  /** Records referencing this level; null when the viewer may not see every record (restricted). */
  usage_count: number | null;
};

/** Every level of the viewer's organisation, active and inactive, rank DESC. */
export async function listRiskLevelsForAdmin(viewer: AssuranceViewer): Promise<RiskLevelAdminRow[]> {
  const org = viewer.organisationId;
  const floor = seriousRankFloorSql(organisationLevelsSql(org));
  const withUsage = viewer.canViewAllRestricted;
  return (await sql`
    SELECT r.id, r.code, r.name, r.description, r.rank, r.is_active, r.requires_verification,
           coalesce(r.is_active AND r.rank >= ${floor}, false) AS serious,
           ${REVISION} AS revision, r.created_at, r.updated_at,
           CASE WHEN ${withUsage}::boolean THEN (
             (SELECT count(*) FROM assurance_incidents x WHERE x.organisation_id = r.organisation_id AND x.risk_level_id = r.id)
           + (SELECT count(*) FROM assurance_investigations x WHERE x.organisation_id = r.organisation_id AND x.risk_level_id = r.id)
           + (SELECT count(*) FROM assurance_findings x WHERE x.organisation_id = r.organisation_id AND x.risk_level_id = r.id)
           )::int ELSE NULL END AS usage_count
    FROM assurance_risk_levels r
    WHERE r.organisation_id = ${org}
    ORDER BY r.rank DESC
  `) as RiskLevelAdminRow[];
}

export type RiskLevelHistoryRow = { id: string; action: string; created_at: string; user_name: string | null; code: string | null };

/** Recent configuration history for the organisation's risk levels (newest first). */
export async function listRiskLevelHistory(viewer: AssuranceViewer, limit = 30): Promise<RiskLevelHistoryRow[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  return (await sql`
    SELECT l.id, l.action, l.created_at, u.name AS user_name, coalesce(l.after_state->>'code', l.before_state->>'code') AS code
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.user_id AND u.organisation_id = l.organisation_id
    WHERE l.organisation_id = ${viewer.organisationId} AND l.resource_type = 'assurance_risk_level'
    ORDER BY l.created_at DESC
    LIMIT ${capped}
  `) as RiskLevelHistoryRow[];
}

// ── Input ────────────────────────────────────────────────────────────────

function requireAdminister(viewer: AssuranceViewer) {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage risk levels.');
}

function parseRank(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n)) throw new AssuranceValidationError('Rank must be a whole number.');
  if (n < 0) throw new AssuranceValidationError('Rank cannot be negative.');
  if (n > RISK_RANK_MAX) throw new AssuranceValidationError(`Rank must be ${RISK_RANK_MAX} or less.`);
  return n;
}

function parseDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AssuranceValidationError('Description must be text.');
  const t = value.trim();
  if (t === '') return null;
  if (t.length > RISK_DESCRIPTION_MAX) throw new AssuranceValidationError(`Description must be ${RISK_DESCRIPTION_MAX} characters or fewer.`);
  return t;
}

function parseAcknowledgement(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 10 || !value.every(v => typeof v === 'string' && v.length <= 60)) {
    throw new AssuranceValidationError('Invalid confirmation.');
  }
  return [...(value as string[])].sort();
}

function requiredRevision(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) {
    throw new AssuranceValidationError('This form is out of date. Refresh the page and try again.');
  }
  return value;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── Serious-set impact (pre-check; re-evaluated inside the write) ─────────

async function seriousImpact(organisationId: string, change: ProposedChange) {
  const current = organisationLevelsSql(organisationId);
  const proposed = proposedLevelsSql(organisationId, change);
  const [row] = (await sql`
    SELECT ${seriousJsonSql(current)} AS before, ${seriousJsonSql(proposed)} AS after,
           ${seriousCodesSql(current)} AS before_codes, ${seriousCodesSql(proposed)} AS after_codes
  `) as { before: SeriousLevel[]; after: SeriousLevel[]; before_codes: string[]; after_codes: string[] }[];
  return row;
}

/** Throws a confirmation request unless the serious set is unchanged or its exact outcome was acknowledged. */
async function requireSeriousAcknowledgement(organisationId: string, change: ProposedChange, ack: string[] | null) {
  const impact = await seriousImpact(organisationId, change);
  const before = [...impact.before_codes].sort();
  const after = [...impact.after_codes].sort();
  if (sameSet(before, after)) return;
  if (ack && sameSet(ack, after)) return;
  const details: SeriousChangeDetails = { code: SERIOUS_CHANGE_CONFIRMATION, before: impact.before, after: impact.after, acknowledge: after };
  throw new AssuranceConfirmationRequiredError(
    'Changing this will change which risk levels are treated as serious on the Assurance dashboard.',
    details,
  );
}

function mapUniqueViolation(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e?.code === '23505') {
    const which = `${e.constraint ?? ''} ${e.message ?? ''}`;
    if (which.includes('org_code_key')) throw new AssuranceConflictError('Another risk level already uses that code.');
    if (which.includes('org_rank_key')) throw new AssuranceConflictError('Another risk level already uses that rank. Ranks must be unique, including inactive levels.');
    throw new AssuranceConflictError('That risk level conflicts with an existing one. Refresh and try again.');
  }
  throw err;
}

async function assertRankFree(organisationId: string, rank: number, exceptId: string | null) {
  const clash = (await sql`
    SELECT name, is_active FROM assurance_risk_levels
    WHERE organisation_id = ${organisationId} AND rank = ${rank} AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
  `) as { name: string; is_active: boolean }[];
  if (clash[0]) {
    throw new AssuranceConflictError(`Rank ${rank} is already used by "${clash[0].name}"${clash[0].is_active ? '' : ' (inactive)'}. Ranks must be unique, including inactive levels.`);
  }
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function createRiskLevel(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; code: string }> {
  requireAdminister(viewer);
  const code = normaliseRiskCode(raw.code);
  const codeProblem = riskCodeProblem(code);
  if (codeProblem) throw new AssuranceValidationError(codeProblem);
  const input = {
    code,
    name: requiredText(raw.name, 'Name', RISK_NAME_MAX),
    description: parseDescription(raw.description),
    rank: parseRank(raw.rank),
    requiresVerification: optionalBoolean(raw.requiresVerification, false),
    active: optionalBoolean(raw.active, true),
  };
  const ack = parseAcknowledgement(raw.acknowledgeSerious);
  const org = viewer.organisationId;

  const dup = (await sql`SELECT 1 FROM assurance_risk_levels WHERE organisation_id = ${org} AND code = ${input.code}`) as unknown[];
  if (dup.length > 0) throw new AssuranceConflictError(`A risk level with code ${input.code} already exists.`);
  await assertRankFree(org, input.rank, null);

  const change: ProposedChange = { kind: 'create', code: input.code, name: input.name, rank: input.rank, active: input.active };
  await requireSeriousAcknowledgement(org, change, ack);

  const current = organisationLevelsSql(org);
  const proposed = proposedLevelsSql(org, change);
  let rows: { id: string; code: string }[];
  try {
    const results = await sql.transaction([
      lockStatement(org),
      sql`
        WITH guard AS (
          SELECT ${seriousCodesSql(current)} AS before_codes, ${seriousCodesSql(proposed)} AS after_codes,
                 ${seriousJsonSql(current)} AS before_serious, ${seriousJsonSql(proposed)} AS after_serious
        ), ins AS (
          INSERT INTO assurance_risk_levels (organisation_id, code, name, description, rank, is_active, requires_verification, created_by)
          SELECT ${org}, ${input.code}, ${input.name}, ${input.description}, ${input.rank}, ${input.active}, ${input.requiresVerification}, ${viewer.userId}
          FROM guard g
          WHERE g.before_codes = g.after_codes OR g.after_codes = ${ack ?? []}::text[]
          RETURNING id, code, name, description, rank, is_active, requires_verification
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, 'assurance_risk_level.created', 'assurance_risk_level', ins.id::text,
                 jsonb_build_object('serious', g.before_serious),
                 jsonb_build_object('id', ins.id, 'code', ins.code, 'name', ins.name, 'description', ins.description, 'rank', ins.rank,
                                    'is_active', ins.is_active, 'requires_verification', ins.requires_verification, 'serious', g.after_serious)
          FROM ins, guard g
        )
        SELECT id, code FROM ins
      `,
    ]);
    rows = results[1] as { id: string; code: string }[];
  } catch (err) {
    mapUniqueViolation(err);
  }
  if (!rows[0]) throw new AssuranceConflictError('Risk levels changed while you were saving. Refresh and try again.');
  return rows[0];
}

type LevelState = {
  id: string; code: string; name: string; description: string | null; rank: number;
  is_active: boolean; requires_verification: boolean; revision: string;
};

async function getLevelState(organisationId: string, id: string): Promise<LevelState> {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Risk level');
  const [row] = (await sql`
    SELECT id, code, name, description, rank, is_active, requires_verification, ${REVISION} AS revision
    FROM assurance_risk_levels WHERE organisation_id = ${organisationId} AND id = ${id}::uuid
  `) as LevelState[];
  if (!row) throw new AssuranceNotFoundError('Risk level');
  return row;
}

type Next = { name: string; description: string | null; rank: number; requiresVerification: boolean; active: boolean };

/** One guarded, audited change to an existing level (update / deactivate / reactivate). */
async function applyLevelChange(
  viewer: AssuranceViewer, current: LevelState, next: Next, expectedRevision: string, ack: string[] | null,
  verb: 'updated' | 'deactivated' | 'reactivated',
): Promise<{ id: string }> {
  const org = viewer.organisationId;
  const change: ProposedChange = { kind: 'modify', id: current.id, name: next.name, rank: next.rank, active: next.active };
  await requireSeriousAcknowledgement(org, change, ack);

  const cur = organisationLevelsSql(org);
  const proposed = proposedLevelsSql(org, change);
  let rows: { id: string }[];
  try {
    const results = await sql.transaction([
      lockStatement(org),
      sql`
        WITH target AS (
          SELECT id, code, name, description, rank, is_active, requires_verification
          FROM assurance_risk_levels
          WHERE organisation_id = ${org} AND id = ${current.id}::uuid AND ${REVISION} = ${expectedRevision}
          FOR UPDATE
        ), guard AS (
          SELECT ${seriousCodesSql(cur)} AS before_codes, ${seriousCodesSql(proposed)} AS after_codes,
                 ${seriousJsonSql(cur)} AS before_serious, ${seriousJsonSql(proposed)} AS after_serious
        ), upd AS (
          UPDATE assurance_risk_levels r
          SET name = ${next.name}, description = ${next.description}, rank = ${next.rank},
              requires_verification = ${next.requiresVerification}, is_active = ${next.active}, updated_at = now()
          FROM target t, guard g
          WHERE r.organisation_id = ${org} AND r.id = t.id
            AND (g.before_codes = g.after_codes OR g.after_codes = ${ack ?? []}::text[])
          RETURNING r.id, r.code, r.name, r.description, r.rank, r.is_active, r.requires_verification
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${org}, ${viewer.userId}, ${`assurance_risk_level.${verb}`}, 'assurance_risk_level', upd.id::text,
                 jsonb_build_object('code', t.code, 'name', t.name, 'description', t.description, 'rank', t.rank,
                                    'is_active', t.is_active, 'requires_verification', t.requires_verification, 'serious', g.before_serious),
                 jsonb_build_object('code', upd.code, 'name', upd.name, 'description', upd.description, 'rank', upd.rank,
                                    'is_active', upd.is_active, 'requires_verification', upd.requires_verification, 'serious', g.after_serious,
                                    'serious_changed', g.before_codes <> g.after_codes)
          FROM upd, target t, guard g
        )
        SELECT id FROM upd
      `,
    ]);
    rows = results[1] as { id: string }[];
  } catch (err) {
    mapUniqueViolation(err);
  }
  if (!rows[0]) {
    throw new AssuranceConflictError('This risk level was changed by someone else while you were saving. Refresh and try again.');
  }
  return rows[0];
}

export async function updateRiskLevel(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ id: string }> {
  requireAdminister(viewer);
  const current = await getLevelState(viewer.organisationId, id);
  if (raw.code !== undefined && raw.code !== null && normaliseRiskCode(raw.code) !== current.code) {
    throw new AssuranceValidationError('A risk level code cannot be changed after it is created.');
  }
  const expectedRevision = requiredRevision(raw.expectedRevision);
  if (expectedRevision !== current.revision) {
    throw new AssuranceConflictError('This risk level was changed by someone else. Refresh and try again.');
  }
  const next: Next = {
    name: raw.name === undefined ? current.name : requiredText(raw.name, 'Name', RISK_NAME_MAX),
    description: raw.description === undefined ? current.description : parseDescription(raw.description),
    rank: raw.rank === undefined ? current.rank : parseRank(raw.rank),
    requiresVerification: raw.requiresVerification === undefined ? current.requires_verification : optionalBoolean(raw.requiresVerification, current.requires_verification),
    active: current.is_active,
  };
  if (next.name === current.name && next.description === current.description && next.rank === current.rank
    && next.requiresVerification === current.requires_verification) {
    throw new AssuranceValidationError('Nothing to save: no changes were made.');
  }
  if (next.rank !== current.rank) await assertRankFree(viewer.organisationId, next.rank, current.id);
  return applyLevelChange(viewer, current, next, expectedRevision, parseAcknowledgement(raw.acknowledgeSerious), 'updated');
}

async function setRiskLevelActive(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>, active: boolean): Promise<{ id: string }> {
  requireAdminister(viewer);
  const current = await getLevelState(viewer.organisationId, id);
  const expectedRevision = requiredRevision(raw.expectedRevision);
  if (expectedRevision !== current.revision) {
    throw new AssuranceConflictError('This risk level was changed by someone else. Refresh and try again.');
  }
  if (current.is_active === active) {
    throw new AssuranceConflictError(active ? 'This risk level is already active.' : 'This risk level is already inactive.');
  }
  // Reactivation re-validates the stored code against today's rules.
  if (active) {
    const problem = riskCodeProblem(current.code);
    if (problem) throw new AssuranceConflictError(`This risk level cannot be reactivated: ${problem}`);
  }
  const next: Next = {
    name: current.name, description: current.description, rank: current.rank,
    requiresVerification: current.requires_verification, active,
  };
  return applyLevelChange(viewer, current, next, expectedRevision, parseAcknowledgement(raw.acknowledgeSerious), active ? 'reactivated' : 'deactivated');
}

/** Retires a level: it stays on every existing record, and is no longer offered for new ones. */
export async function deactivateRiskLevel(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ id: string }> {
  return setRiskLevelActive(viewer, id, raw, false);
}

export async function reactivateRiskLevel(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ id: string }> {
  return setRiskLevelActive(viewer, id, raw, true);
}
