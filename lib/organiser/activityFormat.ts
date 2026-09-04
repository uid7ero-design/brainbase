// Phase D.4.5D — pure, framework-free formatting helpers for rendering
// organiser_activity rows as human-readable Item Activity tab entries.
// No React, no DOM, no fetch — safe to unit-test directly and safe to
// import from any future surface (Item Activity tab today, a possible
// board-level activity feed later) without dragging UI concerns along.
//
// NEVER THROWS: every function here degrades to a safe, generic rendering
// for unexpected input (an unrecognised event_type, a null/empty
// before/after, a non-string actor name) rather than raising — the caller
// (a React component rendering a list of historical events, some of which
// may predate a later change to this file) must never hard-crash on one
// malformed or future-shaped row.

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  status: 'Status',
  priority: 'Priority',
  owner: 'Owner',
  due_date: 'Due date',
  group_id: 'Group',
  parent_item_id: 'Parent item',
  notes: 'Notes',
  custom_values: 'Custom fields',
};

/** Maps a known before/after diff key to its user-friendly label; an
 *  unrecognised key gets a safe title-cased fallback (e.g. "widget_count"
 *  -> "Widget Count") rather than being hidden or shown raw. */
export function formatFieldLabel(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  return key
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Renders one before/after value safely for display. null/undefined ->
 *  "None" (distinguishing "no value" from the visually-identical-otherwise
 *  empty string, which renders as "(empty)"). Booleans render as Yes/No,
 *  not "true"/"false". Arrays and plain objects (e.g. one changed
 *  custom_values entry that is itself structured) render as a concise,
 *  single-line summary — never raw JSON dumped into the primary UI. */
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'string') return value.length === 0 ? '(empty)' : value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty)';
    return value.map(v => formatFieldValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '(empty)';
    return entries.map(([k, v]) => `${k}: ${formatFieldValue(v)}`).join(', ');
  }
  return String(value);
}

/** Resolves a group_id snapshot to its current display name. Deliberately
 *  a plain lookup against a caller-supplied map (built from the current
 *  board's own already tenant-scoped groups list) — never an independent
 *  fetch/query of its own, so this module can never introduce a
 *  cross-tenant lookup. A group_id absent from the map (renamed board,
 *  since-deleted group) falls back to "Another group" rather than exposing
 *  the raw id or fabricating a name. */
function resolveGroupLabel(groupId: unknown, groupNamesById: Record<string, string>): string {
  if (groupId === null || groupId === undefined) return 'No group';
  if (typeof groupId !== 'string') return 'Another group';
  return groupNamesById[groupId] ?? 'Another group';
}

export interface ActivityDiffRow {
  label: string;
  /** null means "no prior value to contrast" — the UI renders this row as
   *  a single value (used for item.created's optional initial-state rows),
   *  not a before/after arrow. */
  before: string | null;
  after: string;
}

export interface ActivityDescription {
  /** e.g. "Admin created this item" — always non-empty, always safe to
   *  render directly. */
  summary: string;
  /** Zero or more field-level diffs to render under the summary. */
  diffs: ActivityDiffRow[];
}

export interface ActivityEventLike {
  event_type: string;
  actor: { name: string };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Builds one diff row per changed key present in before/after (their
 *  union, so a key added only on one side still renders). 'group_id' is
 *  special-cased to a resolved group name via resolveGroupLabel rather
 *  than the generic formatFieldValue path. 'custom_values' is special-
 *  cased to expand its own nested changed keys as individual rows (each
 *  custom column gets its own labelled row) instead of one row containing
 *  a raw nested object — this is the "concise readable summary" the
 *  Custom fields diff needs. Every other key falls through to
 *  formatFieldLabel/formatFieldValue's generic, always-safe handling. */
function buildDiffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  groupNamesById: Record<string, string>,
): ActivityDiffRow[] {
  const beforeObj = before ?? {};
  const afterObj = after ?? {};
  const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
  const rows: ActivityDiffRow[] = [];

  for (const key of keys) {
    if (key === 'custom_values') {
      const beforeCustom = (beforeObj.custom_values && typeof beforeObj.custom_values === 'object'
        ? beforeObj.custom_values
        : {}) as Record<string, unknown>;
      const afterCustom = (afterObj.custom_values && typeof afterObj.custom_values === 'object'
        ? afterObj.custom_values
        : {}) as Record<string, unknown>;
      const customKeys = Array.from(new Set([...Object.keys(beforeCustom), ...Object.keys(afterCustom)]));
      for (const ck of customKeys) {
        rows.push({
          label: formatFieldLabel(ck),
          before: formatFieldValue(beforeCustom[ck]),
          after: formatFieldValue(afterCustom[ck]),
        });
      }
      continue;
    }
    if (key === 'group_id') {
      rows.push({
        label: 'Group',
        before: resolveGroupLabel(beforeObj.group_id, groupNamesById),
        after: resolveGroupLabel(afterObj.group_id, groupNamesById),
      });
      continue;
    }
    rows.push({
      label: formatFieldLabel(key),
      before: formatFieldValue(beforeObj[key]),
      after: formatFieldValue(afterObj[key]),
    });
  }
  return rows;
}

/** The single entry point the Item Activity tab renders through. Handles
 *  the four known event types (item.created/updated/moved/deleted)
 *  explicitly, plus a generic, still-useful fallback for anything else —
 *  an unrecognised event_type NEVER throws and never renders blank; it
 *  falls through to the same generic diff renderer with a plain
 *  "<actor> — <event_type>" summary. */
export function describeActivityEvent(
  event: ActivityEventLike,
  groupNamesById: Record<string, string> = {},
): ActivityDescription {
  const actorLabel = event.actor?.name || 'Someone';

  if (event.event_type === 'item.created') {
    const after = event.after ?? {};
    const diffs: ActivityDiffRow[] = [];
    if ('status' in after) {
      diffs.push({ label: 'Status', before: null, after: formatFieldValue(after.status) });
    }
    if ('group_id' in after) {
      diffs.push({ label: 'Group', before: null, after: resolveGroupLabel(after.group_id, groupNamesById) });
    }
    return { summary: `${actorLabel} created this item`, diffs };
  }

  if (event.event_type === 'item.moved') {
    return { summary: `${actorLabel} moved this item`, diffs: buildDiffRows(event.before, event.after, groupNamesById) };
  }

  if (event.event_type === 'item.updated') {
    return { summary: `${actorLabel} updated this item`, diffs: buildDiffRows(event.before, event.after, groupNamesById) };
  }

  if (event.event_type === 'item.deleted') {
    return { summary: `${actorLabel} deleted this item`, diffs: [] };
  }

  return {
    summary: `${actorLabel} — ${event.event_type || 'activity'}`,
    diffs: buildDiffRows(event.before, event.after, groupNamesById),
  };
}
