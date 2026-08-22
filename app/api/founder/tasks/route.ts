import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import sql from '@/lib/db';
import { resolveBrainbaseOrgId, resolveFounderBoard } from '@/lib/founder/tasksBoard';

// ── Founder OS Phase D — real, persisted tasks ──────────────────────────
//
// super_admin only, matching every other founder-* route. Organiser
// (organiser_boards/organiser_items) remains the sole authoritative
// persistence layer — this route does not own a second task database, it
// reads/writes the exact same tables the canonical Organiser UI (/organiser)
// uses, scoped to BrainBase's own board (resolved server-side, impersonation-
// proof — see lib/founder/tasksBoard.ts). No new schema, no new table.

const STATUS_OPTIONS = ['Not Started', 'Working on it', 'Stuck', 'Done'] as const;
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical'] as const;

export type FounderTaskItem = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  owner: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaskGroups = {
  overdue: FounderTaskItem[];
  today: FounderTaskItem[];
  upcoming: FounderTaskItem[];
  noDueDate: FounderTaskItem[];
  completed: FounderTaskItem[];
};

// UTC-anchored "today", matching the exact same rationale already
// established in app/api/founder/attention-queue/route.ts — using
// local-midnight here would skew overdue/today/upcoming bucketing by ±1
// day depending on the server's timezone offset relative to UTC.
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function toDateOnlyString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapRow(row: Record<string, unknown>): FounderTaskItem {
  return {
    id: row.id as string,
    title: row.name as string,
    status: row.status as string,
    priority: (row.priority as string) || null,
    owner: (row.owner as string) || null,
    dueDate: toDateOnlyString(row.due_date),
    notes: (row.notes as string) || null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

// Deterministic grouping: exactly one bucket per task. Completed (status
// = 'Done') always wins regardless of due date — a done task is not also
// "overdue". Otherwise: no due date -> noDueDate; date < today -> overdue;
// date = today -> today; date > today -> upcoming. Within
// overdue/today/upcoming, sorted by due date ascending (most urgent
// first) then priority descending as a tiebreaker; noDueDate/completed
// sorted by priority descending then most-recently-updated first.
const PRIORITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
function priorityRank(p: string | null): number {
  return p ? (PRIORITY_RANK[p] ?? 4) : 5;
}

function groupTasks(rows: Record<string, unknown>[]): TaskGroups {
  const today = utcToday();
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [], noDueDate: [], completed: [] };

  for (const row of rows) {
    const task = mapRow(row);
    if (task.status === 'Done') {
      groups.completed.push(task);
      continue;
    }
    if (!task.dueDate) {
      groups.noDueDate.push(task);
      continue;
    }
    const due = new Date(`${task.dueDate}T00:00:00Z`);
    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (days < 0) groups.overdue.push(task);
    else if (days === 0) groups.today.push(task);
    else groups.upcoming.push(task);
  }

  const byDateThenPriority = (a: FounderTaskItem, b: FounderTaskItem) => {
    const ad = a.dueDate ?? '';
    const bd = b.dueDate ?? '';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return priorityRank(a.priority) - priorityRank(b.priority);
  };
  const byPriorityThenRecency = (a: FounderTaskItem, b: FounderTaskItem) => {
    const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (rankDiff !== 0) return rankDiff;
    return b.updatedAt.localeCompare(a.updatedAt);
  };

  groups.overdue.sort(byDateThenPriority);
  groups.today.sort(byDateThenPriority);
  groups.upcoming.sort(byDateThenPriority);
  groups.noDueDate.sort(byPriorityThenRecency);
  groups.completed.sort(byPriorityThenRecency);

  return groups;
}

async function requireFounderSession() {
  const session = await getAuthSession();
  if (session.role !== 'super_admin') throw new Error('Forbidden');
  return session;
}

export async function GET() {
  try {
    await requireFounderSession();
  } catch (err) {
    const status = (err as Error).message === 'Forbidden' ? 403 : 401;
    return NextResponse.json({ error: (err as Error).message || 'Unauthorized' }, { status });
  }

  try {
    const orgId = await resolveBrainbaseOrgId();
    if (!orgId) {
      return NextResponse.json({ error: 'BrainBase organisation not found' }, { status: 500 });
    }
    const board = await resolveFounderBoard(orgId);
    if (!board) {
      return NextResponse.json({
        board: null,
        groups: { overdue: [], today: [], upcoming: [], noDueDate: [], completed: [] },
      });
    }

    const rows = await sql`
      SELECT id, name, status, priority, owner, due_date::text AS due_date, notes, created_at, updated_at
      FROM organiser_items
      WHERE board_id = ${board.id} AND organisation_id = ${orgId} AND parent_item_id IS NULL
      ORDER BY position ASC, created_at ASC
    `;

    return NextResponse.json({ board, groups: groupTasks(rows) });
  } catch (err) {
    console.error('[GET /api/founder/tasks]', err);
    return NextResponse.json(
      { error: 'Internal server error', board: null, groups: { overdue: [], today: [], upcoming: [], noDueDate: [], completed: [] } },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireFounderSession();
  } catch (err) {
    const status = (err as Error).message === 'Forbidden' ? 403 : 401;
    return NextResponse.json({ error: (err as Error).message || 'Unauthorized' }, { status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const priority = typeof body.priority === 'string' && (PRIORITY_OPTIONS as readonly string[]).includes(body.priority) ? body.priority : null;
  const owner = typeof body.owner === 'string' && body.owner.trim() ? body.owner.trim().slice(0, 200) : null;
  const dueDate = typeof body.due_date === 'string' && body.due_date ? body.due_date : null;
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 5000) : null;

  try {
    const orgId = await resolveBrainbaseOrgId();
    if (!orgId) {
      return NextResponse.json({ error: 'BrainBase organisation not found' }, { status: 500 });
    }
    const board = await resolveFounderBoard(orgId);
    if (!board) {
      return NextResponse.json({ error: 'No Founder Tasks board exists yet — create one first' }, { status: 409 });
    }

    const posRows = await sql`
      SELECT COALESCE(MAX(position), -1) + 1 AS next FROM organiser_items
      WHERE board_id = ${board.id} AND parent_item_id IS NULL
    `;
    const position = posRows[0].next as number;

    const rows = await sql`
      INSERT INTO organiser_items (
        board_id, organisation_id, group_id, parent_item_id, name, status,
        priority, owner, due_date, notes, position
      ) VALUES (
        ${board.id}, ${orgId}, NULL, NULL, ${title}, ${STATUS_OPTIONS[0]},
        ${priority}, ${owner}, ${dueDate}, ${notes}, ${position}
      )
      RETURNING id, name, status, priority, owner, due_date::text AS due_date, notes, created_at, updated_at
    `;

    return NextResponse.json({ task: mapRow(rows[0]) }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/founder/tasks]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
