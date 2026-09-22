"use client";

import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import OrganiserShell from "@/components/organiser/OrganiserShell";
import OrganiserRail from "@/components/organiser/OrganiserRail";
import { useOpsTheme } from "@/components/ops/theme";
import { useAppStore } from "@/lib/state/useAppStore";
import { describeActivityEvent, describeBoardActivityEvent, type ActivityEventLike } from "@/lib/organiser/activityFormat";
import { enqueueCoalesced, type CoalescingQueueMap } from "@/lib/organiser/coalescingMutationQueue";
import { createNotesAutosaveTimer, type NotesAutosaveTimer } from "@/lib/organiser/notesAutosave";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

// ── TYPES ────────────────────────────────────────────────────────────────────

type OrganiserBoard = {
  id: string; name: string; color: string | null; icon: string | null;
  position: number; item_count?: number;
};

type OrganiserGroup = { id: string; name: string; color: string | null; position: number };

type ColumnOption = { label: string; color: string };
type ColumnType = "text" | "number" | "date" | "status" | "checkbox";
type OrganiserColumn = { id: string; name: string; type: ColumnType; options: ColumnOption[]; position: number };

type OrganiserItem = {
  id: string; group_id: string | null; parent_item_id: string | null;
  name: string; status: string; priority: string | null; owner: string | null;
  due_date: string | null; notes: string | null; fields: Record<string, string>;
  custom_values: Record<string, unknown>;
  // Phase D.4.6P — NEW, identity-bound assignee (migration step 47),
  // entirely separate from the legacy free-text `owner` field above —
  // never confused with it, never synchronized with it. A real users.id
  // (cuid, not UUID-shaped) or null when unassigned.
  assignee_user_id: string | null;
  position: number; created_at: string; updated_at: string;
};

// Phase D.4.6P — a real organisation member, for the assignee picker.
// Sourced from GET /api/organiser/members (ACTIVE users of this
// organisation only) — the same identity source Helena's own
// propose_organiser_assignee_change resolves assignee names against.
type OrganiserMember = { id: string; name: string };

// D.4.7B — mutation reliability + save-state foundation. A single,
// reusable model every scalar field mutation (status/priority/due date/
// assignee, and group rename) reports into, keyed by a caller-chosen
// string (convention: `item:<id>:<patchFieldKey>` or `group:<id>:name`)
// so unrelated fields/items never share or clobber each other's
// indicator. `message` is only ever a short, safe, user-facing string —
// never a raw server error, stack trace, or internal id (see
// updateItem's own catch handling for where that boundary is enforced).
type SaveState = "idle" | "saving" | "saved" | "error";
type SaveStatus = { state: SaveState; message?: string };

// Compact, silent-when-idle indicator for tight row/grid contexts (the
// table view's Status/Priority/due-date cells) — a small colored dot
// with the real message only in its title tooltip, so it never disturbs
// the existing dense grid layout.
function SaveDot({ status }: { status?: SaveStatus }) {
  if (!status || status.state === "idle") return null;
  const color = status.state === "saving" ? "#8B5CF6" : status.state === "saved" ? "#22C55E" : "#EF4444";
  return (
    <span
      title={status.state === "error" ? (status.message ?? "Couldn't save") : status.state === "saving" ? "Saving…" : "Saved"}
      style={{
        display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: color,
        marginLeft: 5, flexShrink: 0, animation: status.state === "saving" ? "bb-save-pulse 1s ease-in-out infinite" : undefined,
      }}
    />
  );
}

// Fuller text indicator for the drawer's own Field labels, where there's
// room for the actual word instead of just a dot.
function SaveStatusText({ status }: { status?: SaveStatus }) {
  if (!status || status.state === "idle") return null;
  if (status.state === "saving") return <span style={{ fontSize: 9.5, fontWeight: 600, color: "rgba(139,92,246,.85)", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>Saving…</span>;
  if (status.state === "saved") return <span style={{ fontSize: 9.5, fontWeight: 600, color: "#22C55E", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>Saved</span>;
  return <span style={{ fontSize: 9.5, fontWeight: 600, color: "#EF4444", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>{status.message ?? "Couldn't save"}</span>;
}

type OrganiserFile = { id: string; file_name: string; file_url: string; file_size: number | null; created_at: string };
type OrganiserUpdate = { id: string; author_name: string | null; body: string; created_at: string };
// Phase D.4.5D — mirrors GET /api/organiser/activity's OrganiserActivityEventDTO
// (lib/organiser/activityRead.ts) field-for-field. `extends ActivityEventLike`
// so this exact shape can be passed to describeActivityEvent without any
// reshaping at the call site.
type OrganiserActivityEvent = ActivityEventLike & { id: string; entity_type: string; entity_id: string; created_at: string };

type BoardData = { board: OrganiserBoard; groups: OrganiserGroup[]; items: OrganiserItem[]; columns: OrganiserColumn[] };
type SheetChoice = { name: string; rowCount: number; looksLikeData: boolean };

// ── STATUS / PRIORITY PALETTES ──────────────────────────────────────────────

const STATUS_OPTIONS = ["Not Started", "Working on it", "Stuck", "Done"];
// These status/priority palettes are module-level constants (evaluated once,
// not per-render), so they can't call useOpsTheme() — they use fixed neutral
// fallback colours rather than theme-tuned ones. Only the "no status set"/
// "no priority set" default grey, so the impact of not re-tuning it per theme
// is minimal.
const STATUS_COLORS: Record<string, string> = {
  "not started": "#8A8F98",
  "working on it": "#F59E0B",
  "stuck": "#EF4444",
  "done": "#22C55E",
};
function statusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? "#8A8F98";
}

const PRIORITY_OPTIONS = ["", "Low", "Medium", "High", "Critical"];
const PRIORITY_COLORS: Record<string, string> = {
  low: "#60A5FA",
  medium: "#818CF8",
  high: "#F59E0B",
  critical: "#EF4444",
};
function priorityColor(priority: string): string {
  return PRIORITY_COLORS[priority.toLowerCase()] ?? "#5B6270";
}

const SWATCH_COLORS = ["#8A8F98", "#60A5FA", "#818CF8", "#A78BFA", "#F59E0B", "#EF4444", "#22C55E", "#14B8A6", "#EC4899"];

// Static part of the "section label" style — colour is theme-dependent and
// merged in at each use site (`{ ...SECTION_LABEL, color: t.ink(.30) }`)
// since this constant is evaluated once at module load, not per-render.
const SECTION_LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 };

// Table grid: Name | Status | Priority | Due date | Owner | ...custom columns | + slot | delete slot
function gridTemplate(columns: OrganiserColumn[]): string {
  const custom = columns.map(() => "120px").join(" ");
  return `1fr 140px 110px 130px 130px ${custom ? custom + " " : ""}34px 28px`;
}

// ── SMALL UI PRIMITIVES ──────────────────────────────────────────────────────

function Pill({ label, color, onClick }: { label: string; color: string; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
        background: `${color}1E`, border: `1px solid ${color}40`, color,
        cursor: onClick ? "pointer" : "default", whiteSpace: "nowrap",
      }}
    >
      {label || "—"}
    </span>
  );
}

function pillSelectStyle(color: string): React.CSSProperties {
  return {
    appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
    padding: "3px 24px 3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
    background: `${color}1E`, border: `1px solid ${color}40`, color,
    cursor: "pointer", fontFamily: FONT, maxWidth: "100%",
  };
}

function PillSelect({
  value, options, colorFor, onChange, placeholder,
}: {
  value: string; options: string[]; colorFor: (v: string) => string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  const t = useOpsTheme();
  const color = value ? colorFor(value) : t.ink(.42);
  const allOptions = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={pillSelectStyle(color)}>
      {allOptions.map(o => (
        <option key={o || "(none)"} value={o} style={{ background: t.menuBg, color: t.ink(.90) }}>
          {o || placeholder || "—"}
        </option>
      ))}
    </select>
  );
}

// Like PillSelect, but options come from a column's own {label,color} list instead of a hardcoded palette.
function OptionsPillSelect({
  value, options, onChange, placeholder,
}: {
  value: string; options: ColumnOption[]; onChange: (v: string) => void; placeholder?: string;
}) {
  const t = useOpsTheme();
  const current = options.find(o => o.label === value);
  const color = current?.color ?? t.ink(.42);
  const allOptions = value && !options.some(o => o.label === value) ? [{ label: value, color: t.ink(.42) }, ...options] : options;
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={pillSelectStyle(color)}>
      <option value="" style={{ background: t.menuBg, color: t.ink(.90) }}>{placeholder || "—"}</option>
      {allOptions.map(o => (
        <option key={o.label} value={o.label} style={{ background: t.menuBg, color: t.ink(.90) }}>{o.label}</option>
      ))}
    </select>
  );
}

// D.4.6P-R3 (PR #214 UI blocker fix, second pass) — the Assignee field's
// previous fix (per-<option> inline style, matching PillSelect/
// OptionsPillSelect above) turned out NOT to be reliable in real Chrome:
// live Preview QA showed the native <select> popup still rendering with
// the browser's default white/light panel and OS-highlight color despite
// the same styling technique. Per-<option> background/color is
// apparently NOT consistently honored by Chromium's native list-box
// rendering on every platform, so this is a real platform limitation of
// the native control, not something more inline styling can fix.
//
// Replaces the native <select> with a fully custom-rendered, always-
// themed picker — the same accessible pattern already proven elsewhere
// in this codebase (see app/events/_components/ui.tsx's FilterDropdown:
// a plain <button> trigger with aria-haspopup="listbox"/aria-expanded,
// and an absolutely-positioned role="listbox" panel of role="option"
// <button>s). Re-implemented locally here (not imported cross-domain
// from app/events) so it can use Organiser's own useOpsTheme() tokens
// (t.ink()/t.menuBg) exactly like every other control in this drawer —
// FilterDropdown's own palette is hardcoded dark-only and would not
// respect Organiser's light theme. Every option/trigger element is a
// real, independently focusable/activatable native <button> — Tab moves
// between them, Enter/Space activates, and the browser's own visible
// focus ring is never suppressed, so keyboard accessibility comes from
// the platform rather than being reimplemented.
//
// This is presentation-only: value/onChange still carry exactly the
// same assignee_user_id semantics ("" => Unassigned => null, otherwise
// a member id) that item.tsx's onUpdate/PATCH route and Helena's own
// propose_organiser_assignee_change already use — no authority,
// validation, PATCH route, or activity-logging change of any kind.
function AssigneeDropdown({
  value, members, onChange,
}: {
  value: string;
  members: OrganiserMember[];
  onChange: (value: string) => void;
}) {
  const t = useOpsTheme();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(next: string) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const selectedLabel = value ? (members.find(m => m.id === value)?.name ?? "Unassigned") : "Unassigned";

  return (
    <div
      ref={wrapperRef}
      style={{ position: "relative", width: 168 }}
      onKeyDown={e => {
        if (e.key === "Escape") {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Assignee"
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%",
          background: open ? t.ink(.06) : t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6,
          padding: "5px 8px", fontSize: 12, color: t.ink(.90), fontFamily: FONT, cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedLabel}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ flexShrink: 0, opacity: .6, transform: open ? "rotate(180deg)" : undefined, transition: "transform .12s" }} aria-hidden="true">
          <path d="M1 2l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Assignee"
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, width: "100%",
            background: t.menuBg, border: `1px solid ${t.ink(.10)}`, borderRadius: 8,
            boxShadow: "0 12px 32px rgba(0,0,0,.45)", padding: 4, zIndex: 20,
            maxHeight: 220, overflowY: "auto",
          }}
        >
          {[{ id: "", name: "Unassigned" }, ...members].map(opt => {
            const isSelected = opt.id === value;
            return (
              <button
                key={opt.id || "__unassigned__"}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => select(opt.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "6px 9px",
                  background: "none", border: "none", borderRadius: 6, cursor: "pointer",
                  color: isSelected ? "#a5b4fc" : t.ink(.85), fontSize: 12, fontWeight: isSelected ? 600 : 400,
                  fontFamily: FONT,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = t.ink(.05); }}
                onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
              >
                {opt.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// D.4.7D — dirty-draft protection, generic to every InlineText call site
// (group name, item name in both the drawer and the table, custom text
// columns, board name). Before this phase, a plain `useEffect(() => {
// setDraft(value) }, [value])` overwrote `draft` on ANY authoritative
// change — including while the user had unsaved edits mid-keystroke —
// silently erasing typed text. This mirrors D.4.7C's Notes fix exactly,
// generalized: `seenValue` is the last authoritative value this instance
// has observed; a change is reconciled into `draft` only while the draft
// isn't dirty. `dirty` is local-only (never derived from saveStatus, since
// InlineText's callers don't all supply one — see CustomCell/board name
// above, which pass no `status` at all).
//
// Render-time comparison state (not a ref, not a plain effect) for the
// same lint reasons as D.4.7C's Notes reconciliation: this repo's
// react-hooks/refs rule disallows reading a ref during render, and
// react-hooks/set-state-in-effect disallows an effect whose only job is
// syncing local state to a changed prop — both are exactly what a
// naive fix would reach for.
function InlineText({
  value, placeholder, onSave, bold, status, renderTrigger,
}: {
  value: string; placeholder?: string; onSave: (v: string) => void; bold?: boolean;
  // D.4.7B — optional; call sites that care about visible save/error
  // state (item title in the drawer and in the table, group name) pass
  // their own `item:<id>:name` / `group:<id>:name` saveStatus entry so a
  // rename failure is visible right next to the text, not just a silent
  // no-op. Call sites with no natural save-state story (custom text
  // columns, the board title) simply omit it.
  status?: SaveStatus;
  // D.4.7D — optional override for the "not editing" display. Every
  // existing call site omits this and keeps today's exact behavior (the
  // text itself is the click-to-edit trigger). ItemRow's table-row name
  // cell is the one exception: a table item's name must open the drawer
  // on a plain click while STILL offering a way to rename inline (see
  // the row's own edit-icon trigger) — two different interactions on one
  // name, which the default single click-to-edit span can't express.
  // Routing that through a render prop reuses 100% of this component's
  // dirty-draft/commit/cancel logic rather than duplicating it in ItemRow.
  renderTrigger?: (args: { display: string; startEdit: () => void }) => React.ReactNode;
}) {
  const t = useOpsTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [seenValue, setSeenValue] = useState(value);

  if (seenValue !== value) {
    setSeenValue(value);
    // A dirty draft is preserved untouched here — this is the entire
    // point. A clean one (including "not currently editing at all")
    // adopts the new authoritative value immediately.
    if (!dirty) setDraft(value);
  }

  function commitEdit() {
    setEditing(false);
    setDirty(false);
    if (draft !== value) onSave(draft);
  }
  function cancelEdit() {
    // Reset draft to the LATEST authoritative `value` (this render's own
    // prop, not whatever it was when editing began) — satisfies "Escape
    // restores the newest value, not the value from edit start." Setting
    // dirty=false and draft=value together means even a stray blur this
    // triggers is a harmless no-op under commitEdit's own `draft !== value`
    // guard — no separate suppression flag needed.
    setDraft(value);
    setDirty(false);
    setEditing(false);
  }

  if (!editing) {
    const display = value || placeholder || "—";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", minWidth: 0 }}>
        {renderTrigger ? renderTrigger({ display, startEdit: () => setEditing(true) }) : (
          <span
            onClick={() => setEditing(true)}
            title="Click to edit"
            style={{
              cursor: "text", fontWeight: bold ? 600 : 400,
              color: value ? t.ink(.90) : t.ink(.28),
              fontSize: bold ? 13 : 12, lineHeight: 1.4,
            }}
          >
            {display}
          </span>
        )}
        <SaveStatusText status={status} />
      </span>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={e => { setDraft(e.target.value); setDirty(true); }}
      onBlur={commitEdit}
      onKeyDown={e => {
        if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
      }}
      style={{
        fontSize: bold ? 13 : 12, fontWeight: bold ? 600 : 400, fontFamily: FONT,
        background: t.ink(.06), border: "1px solid rgba(139,92,246,.45)",
        borderRadius: 6, padding: "2px 6px", color: t.ink(.94), outline: "none", width: "100%",
      }}
    />
  );
}

// ── CUSTOM COLUMN CELL ───────────────────────────────────────────────────────

function CustomCell({ column, value, onChange }: { column: OrganiserColumn; value: unknown; onChange: (v: unknown) => void }) {
  const t = useOpsTheme();
  if (column.type === "text") {
    return <InlineText value={value != null ? String(value) : ""} onSave={v => onChange(v)} />;
  }
  if (column.type === "number") {
    return (
      <input
        type="number"
        value={value != null ? String(value) : ""}
        onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ width: "100%", background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6, padding: "3px 6px", fontSize: 11, color: t.ink(.90), fontFamily: FONT }}
      />
    );
  }
  if (column.type === "date") {
    return (
      <input
        type="date"
        value={value != null ? String(value) : ""}
        onChange={e => onChange(e.target.value || null)}
        style={{ background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6, padding: "3px 6px", fontSize: 11, color: value ? t.ink(.90) : t.ink(.30), fontFamily: FONT, colorScheme: "dark" }}
      />
    );
  }
  if (column.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 14, height: 14, cursor: "pointer" }}
      />
    );
  }
  // status
  return (
    <OptionsPillSelect
      value={value != null ? String(value) : ""}
      options={column.options}
      onChange={v => onChange(v || null)}
    />
  );
}

// ── ADD-ITEM ROW ─────────────────────────────────────────────────────────────

// D.4.7B — duplicate-submit safe: a `submitting` flag guards Enter while
// a create request is in flight (repeated Enter, or the browser's own
// key-repeat while held down, cannot fire a second POST), the control
// returns to usable state after success (submitting cleared, input
// cleared), and a failed create restores the typed name so the user can
// retry without retyping — the input is only ever cleared on confirmed
// success. `onAdd` returning a boolean is the only contract change; the
// underlying create request itself is unchanged.
function AddItemRow({ onAdd, indent }: { onAdd: (name: string) => Promise<boolean>; indent?: boolean }) {
  const t = useOpsTheme();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    const ok = await onAdd(trimmed);
    setSubmitting(false);
    if (ok) {
      setValue("");
    } else {
      setError("Couldn't create item. Try again.");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", paddingLeft: indent ? 44 : 12 }}>
      <span style={{ color: "rgba(139,92,246,.6)", fontSize: 14, lineHeight: 1 }}>+</span>
      <input
        value={value}
        disabled={submitting}
        onChange={e => { setValue(e.target.value); if (error) setError(null); }}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder={indent ? "Add subitem…" : "Add item…"}
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          fontSize: 12, color: submitting ? t.ink(.45) : t.ink(.90), fontFamily: FONT,
        }}
      />
      {submitting && <span style={{ fontSize: 10.5, color: "rgba(139,92,246,.8)", flexShrink: 0 }}>Adding…</span>}
      {error && <span style={{ fontSize: 10.5, color: "#EF4444", flexShrink: 0 }}>{error}</span>}
    </div>
  );
}

// ── ADD-COLUMN BUTTON ────────────────────────────────────────────────────────

function AddColumnButton({ onAdd }: { onAdd: (name: string, type: ColumnType) => void }) {
  const t = useOpsTheme();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Add column" style={{ background: "transparent", border: `1px dashed ${t.ink(.18)}`, borderRadius: 6, color: t.ink(.35), cursor: "pointer", width: 22, height: 18, fontSize: 12, lineHeight: 1, fontFamily: FONT }}>
        +
      </button>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", top: 0, right: 0, zIndex: 15, background: t.menuBg, border: "1px solid rgba(139,92,246,.3)", borderRadius: 8, padding: 8, width: 170, display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Column name"
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) { onAdd(name.trim(), type); setName(""); setType("text"); setOpen(false); } }}
          style={{ fontSize: 11.5, fontFamily: FONT, background: t.ink(.05), border: `1px solid ${t.ink(.1)}`, borderRadius: 6, padding: "5px 7px", color: t.ink(.90), outline: "none" }}
        />
        <select value={type} onChange={e => setType(e.target.value as ColumnType)} style={{ fontSize: 11.5, fontFamily: FONT, background: t.ink(.05), border: `1px solid ${t.ink(.1)}`, borderRadius: 6, padding: "5px 7px", color: t.ink(.90) }}>
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="status">Status</option>
          <option value="checkbox">Checkbox</option>
        </select>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { if (name.trim()) { onAdd(name.trim(), type); } setName(""); setType("text"); setOpen(false); }} style={{ ...btnStyle(true, t), flex: 1, padding: "4px 8px" }}>Add</button>
          <button onClick={() => { setOpen(false); setName(""); }} style={{ ...btnStyle(false, t), padding: "4px 8px" }}>×</button>
        </div>
      </div>
    </div>
  );
}

// ── COLUMN HEADER CELL ───────────────────────────────────────────────────────

function ColumnHeaderCell({
  column, onRename, onDelete, onEditOptions,
}: {
  column: OrganiserColumn; onRename: (name: string) => void; onDelete: () => void; onEditOptions: () => void;
}) {
  const t = useOpsTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{column.name}</span>
      <button onClick={() => setMenuOpen(o => !o)} style={{ background: "transparent", border: "none", color: t.ink(.25), cursor: "pointer", fontSize: 11, padding: 0, flexShrink: 0 }}>
        ⋯
      </button>
      {menuOpen && (
        <div onMouseLeave={() => setMenuOpen(false)} style={{ position: "absolute", top: "100%", right: 0, zIndex: 15, background: t.menuBg, border: `1px solid ${t.ink(.1)}`, borderRadius: 8, padding: 4, minWidth: 130, boxShadow: "0 8px 24px rgba(0,0,0,.4)", textTransform: "none" }}>
          <button onClick={() => { const n = prompt("Rename column", column.name); if (n?.trim()) onRename(n.trim()); setMenuOpen(false); }} style={{ ...menuBtnStyle, color: t.ink(.8) }}>Rename</button>
          {column.type === "status" && (
            <button onClick={() => { onEditOptions(); setMenuOpen(false); }} style={{ ...menuBtnStyle, color: t.ink(.8) }}>Edit options</button>
          )}
          <button onClick={() => { onDelete(); setMenuOpen(false); }} style={{ ...menuBtnStyle, color: "#EF4444" }}>Delete column</button>
        </div>
      )}
    </div>
  );
}

// Static part only — colour is theme-dependent and merged in at each use site,
// since this constant is evaluated once at module load, not per-render.
const menuBtnStyle: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 500, background: "transparent", border: "none", cursor: "pointer", borderRadius: 5, fontFamily: FONT };

// ── COLUMN OPTIONS EDITOR ────────────────────────────────────────────────────

function ColumnOptionsEditor({ column, onSave, onClose }: { column: OrganiserColumn; onSave: (options: ColumnOption[]) => void; onClose: () => void }) {
  const t = useOpsTheme();
  const [opts, setOpts] = useState<ColumnOption[]>(column.options);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 210, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)" }} />
      <div style={{ position: "relative", width: 320, background: t.menuBg, border: `1px solid ${t.ink(.1)}`, borderRadius: 12, padding: 16, boxShadow: "0 20px 50px rgba(0,0,0,.5)", fontFamily: FONT }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.ink(.90), marginBottom: 12 }}>“{column.name}” options</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12, maxHeight: 280, overflowY: "auto" }}>
          {opts.map((o, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                value={o.label}
                onChange={e => setOpts(prev => prev.map((p, j) => j === i ? { ...p, label: e.target.value } : p))}
                style={{ flex: 1, fontSize: 11.5, fontFamily: FONT, background: t.ink(.05), border: `1px solid ${t.ink(.1)}`, borderRadius: 6, padding: "5px 8px", color: t.ink(.90), outline: "none" }}
              />
              <div style={{ display: "flex", gap: 3 }}>
                {SWATCH_COLORS.map(c => (
                  <button
                    key={c} onClick={() => setOpts(prev => prev.map((p, j) => j === i ? { ...p, color: c } : p))}
                    style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: o.color === c ? "2px solid #fff" : `1px solid ${t.ink(.2)}`, cursor: "pointer", padding: 0, flexShrink: 0 }}
                  />
                ))}
              </div>
              <button onClick={() => setOpts(prev => prev.filter((_, j) => j !== i))} style={{ background: "transparent", border: "none", color: "rgba(239,68,68,.7)", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>×</button>
            </div>
          ))}
        </div>
        <button onClick={() => setOpts(prev => [...prev, { label: "New option", color: SWATCH_COLORS[prev.length % SWATCH_COLORS.length] }])} style={{ ...btnStyle(false, t), marginBottom: 12 }}>
          + Add option
        </button>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnStyle(false, t)}>Cancel</button>
          <button onClick={() => { onSave(opts); onClose(); }} style={btnStyle(true, t)}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── ITEM ROW ─────────────────────────────────────────────────────────────────

function ItemRow({
  item, depth, columns, onUpdate, onDelete, onOpenDrawer, hasChildren, collapsed, onToggleCollapse, saveStatus,
}: {
  item: OrganiserItem; depth: number; columns: OrganiserColumn[];
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onOpenDrawer: (item: OrganiserItem) => void;
  hasChildren: boolean; collapsed: boolean; onToggleCollapse: () => void;
  // D.4.7B — keyed by `item:<id>:<field>`, same convention as ItemDrawer's
  // Field-level indicators; only this row's own item id's entries are
  // ever relevant, looked up per field below.
  saveStatus: Record<string, SaveStatus>;
}) {
  const t = useOpsTheme();
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: gridTemplate(columns),
        alignItems: "center", gap: 10,
        padding: "7px 12px", paddingLeft: 12 + depth * 28,
        borderTop: `1px solid ${t.ink(.045)}`,
        background: hover ? t.ink(.02) : "transparent",
        transition: "background .1s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {hasChildren ? (
          <button
            onClick={onToggleCollapse}
            style={{
              width: 16, height: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", cursor: "pointer", color: t.ink(.35),
              transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform .12s",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
        ) : <span style={{ width: 16, flexShrink: 0 }} />}
        {/* D.4.7D — inline rename in the table, without losing the
            existing "click the name to open the drawer" interaction.
            InlineText's own dirty-draft/save-status machinery is reused
            verbatim via renderTrigger — only the "not editing" display is
            customised here: the name text itself still opens the drawer,
            and a separate hover-revealed pencil icon (mirroring this
            row's own hover-revealed delete icon below) starts the rename.
            The two can never fire off the same click. */}
        <InlineText
          value={item.name}
          onSave={v => onUpdate(item.id, { name: v })}
          status={saveStatus[`item:${item.id}:name`]}
          renderTrigger={({ display, startEdit }) => (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
              <span
                onClick={() => onOpenDrawer(item)}
                title="Open details"
                style={{ cursor: "pointer", fontSize: depth === 0 ? 12.5 : 12, fontWeight: depth === 0 ? 600 : 400, color: t.ink(.90), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {display}
              </span>
              {hover && (
                <button
                  onClick={startEdit}
                  title="Rename"
                  style={{ width: 16, height: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", color: t.ink(.30) }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
              )}
            </span>
          )}
        />
      </div>

      <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        <PillSelect value={item.status} options={STATUS_OPTIONS} colorFor={statusColor} onChange={v => onUpdate(item.id, { status: v })} />
        <SaveDot status={saveStatus[`item:${item.id}:status`]} />
      </span>
      <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        <PillSelect value={item.priority ?? ""} options={PRIORITY_OPTIONS} colorFor={priorityColor} onChange={v => onUpdate(item.id, { priority: v })} placeholder="Priority" />
        <SaveDot status={saveStatus[`item:${item.id}:priority`]} />
      </span>

      <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        <input
          type="date"
          value={item.due_date ?? ""}
          onChange={e => onUpdate(item.id, { due_date: e.target.value || null })}
          style={{
            background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6,
            padding: "3px 6px", fontSize: 11, color: item.due_date ? t.ink(.90) : t.ink(.30), fontFamily: FONT, colorScheme: "dark",
          }}
        />
        <SaveDot status={saveStatus[`item:${item.id}:due_date`]} />
      </span>

      <span style={{ fontSize: 11.5, color: t.ink(.55), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.owner || "—"}
      </span>

      {columns.map(col => (
        <div key={col.id} style={{ minWidth: 0 }}>
          <CustomCell
            column={col}
            value={item.custom_values?.[col.id]}
            onChange={v => onUpdate(item.id, { custom_values: { [col.id]: v } })}
          />
        </div>
      ))}

      <span />

      {hover ? (
        <button
          onClick={() => onDelete(item.id)}
          title="Delete"
          style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(239,68,68,.10)", border: "1px solid rgba(239,68,68,.24)", color: "#EF4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      ) : <span />}
    </div>
  );
}

// ── GROUP SECTION ────────────────────────────────────────────────────────────

function GroupSection({
  group, items, columns, onUpdateItem, onDeleteItem, onAddItem, onOpenDrawer, onRenameGroup, onDeleteGroup,
  onAddColumn, onRenameColumn, onDeleteColumn, onEditColumnOptions, saveStatus, onGroupDragHandleStart,
}: {
  group: OrganiserGroup | null; items: OrganiserItem[]; columns: OrganiserColumn[];
  onUpdateItem: (id: string, patch: Record<string, unknown>) => void;
  onDeleteItem: (id: string) => void;
  onAddItem: (name: string, groupId: string | null, parentItemId: string | null) => Promise<boolean>;
  onOpenDrawer: (item: OrganiserItem) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onAddColumn: (name: string, type: ColumnType) => void;
  onRenameColumn: (id: string, name: string) => void;
  onDeleteColumn: (id: string) => void;
  onEditColumnOptions: (column: OrganiserColumn) => void;
  saveStatus: Record<string, SaveStatus>;
  // D.4.7E (Slice E2) — omitted entirely for the synthetic "No group"
  // bucket (group === null): that section has no persisted row/position of
  // its own, so it must never become a drag source or be counted as part
  // of the reorderable scope. Only present for a real group.
  onGroupDragHandleStart?: () => void;
}) {
  const t = useOpsTheme();
  const [open, setOpen] = useState(true);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  const topLevel = items
    .filter(i => i.group_id === (group?.id ?? null) && !i.parent_item_id)
    .sort((a, b) => a.position - b.position);
  const childrenOf = (parentId: string) => items.filter(i => i.parent_item_id === parentId).sort((a, b) => a.position - b.position);

  const color = group?.color || "#8B5CF6";

  return (
    <div style={{ marginBottom: 18, borderRadius: 12, overflow: "hidden", background: t.paper(.6), border: `1px solid ${t.ink(.06)}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: `${color}10`, borderBottom: open ? `1px solid ${t.ink(.06)}` : "none" }}>
        {onGroupDragHandleStart && (
          <span
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onGroupDragHandleStart(); }}
            title="Drag to reorder"
            aria-label="Reorder group"
            style={{ width: 14, height: 18, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", color: t.ink(.22) }}
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.4" /><circle cx="7.5" cy="2.5" r="1.4" /><circle cx="2.5" cy="7" r="1.4" /><circle cx="7.5" cy="7" r="1.4" /><circle cx="2.5" cy="11.5" r="1.4" /><circle cx="7.5" cy="11.5" r="1.4" /></svg>
          </span>
        )}
        <button onClick={() => setOpen(o => !o)} style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", color, transform: open ? "none" : "rotate(-90deg)", transition: "transform .12s" }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {group ? (
            <InlineText value={group.name} bold onSave={v => onRenameGroup(group.id, v)} status={saveStatus[`group:${group.id}:name`]} />
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600, color: t.ink(.45) }}>No group</span>
          )}
        </div>
        <span style={{ fontSize: 10.5, color: t.ink(.28) }}>{topLevel.length} item{topLevel.length !== 1 ? "s" : ""}</span>
        {group && (
          <button onClick={() => onDeleteGroup(group.id)} title="Delete group" style={{ width: 20, height: 20, borderRadius: 6, background: "transparent", border: "none", color: t.ink(.22), cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /></svg>
          </button>
        )}
      </div>

      {open && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: gridTemplate(columns), gap: 10, padding: "6px 12px", fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", color: t.ink(.24), textTransform: "uppercase" }}>
            <span>Name</span><span>Status</span><span>Priority</span><span>Due date</span><span>Owner</span>
            {columns.map(col => (
              <ColumnHeaderCell
                key={col.id} column={col}
                onRename={name => onRenameColumn(col.id, name)}
                onDelete={() => onDeleteColumn(col.id)}
                onEditOptions={() => onEditColumnOptions(col)}
              />
            ))}
            <AddColumnButton onAdd={onAddColumn} />
            <span />
          </div>
          {topLevel.map(item => {
            const kids = childrenOf(item.id);
            const collapsed = collapsedParents.has(item.id);
            return (
              <React.Fragment key={item.id}>
                <ItemRow
                  item={item} depth={0} columns={columns}
                  onUpdate={onUpdateItem} onDelete={onDeleteItem} onOpenDrawer={onOpenDrawer}
                  hasChildren={kids.length > 0} collapsed={collapsed}
                  onToggleCollapse={() => setCollapsedParents(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
                  saveStatus={saveStatus}
                />
                {!collapsed && kids.map(child => (
                  <ItemRow
                    key={child.id} item={child} depth={1} columns={columns}
                    onUpdate={onUpdateItem} onDelete={onDeleteItem} onOpenDrawer={onOpenDrawer}
                    hasChildren={false} collapsed={false} onToggleCollapse={() => {}}
                    saveStatus={saveStatus}
                  />
                ))}
                {!collapsed && (
                  <AddItemRow indent onAdd={name => onAddItem(name, group?.id ?? null, item.id)} />
                )}
              </React.Fragment>
            );
          })}
          <AddItemRow onAdd={name => onAddItem(name, group?.id ?? null, null)} />
        </div>
      )}
    </div>
  );
}

// ── BOARD (KANBAN) VIEW ──────────────────────────────────────────────────────

function KanbanView({
  items, onOpenDrawer, onUpdateItem,
}: {
  items: OrganiserItem[]; onOpenDrawer: (item: OrganiserItem) => void; onUpdateItem: (id: string, patch: Record<string, unknown>) => void;
}) {
  const t = useOpsTheme();
  const topLevel = items.filter(i => !i.parent_item_id);
  const statuses = Array.from(new Set([...STATUS_OPTIONS, ...topLevel.map(i => i.status)]));

  return (
    <div style={{ display: "flex", gap: 14, padding: "4px 20px 20px", overflowX: "auto", height: "100%" }}>
      {statuses.map(status => {
        const cards = topLevel.filter(i => i.status === status);
        const color = statusColor(status);
        return (
          <div key={status} style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 4px", marginBottom: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: t.ink(.65) }}>{status}</span>
              <span style={{ fontSize: 10, color: t.ink(.28) }}>{cards.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1 }}>
              {cards.map(item => (
                <div
                  key={item.id} onClick={() => onOpenDrawer(item)}
                  style={{ padding: "10px 12px", borderRadius: 10, background: t.ink(.03), border: `1px solid ${t.ink(.07)}`, cursor: "pointer" }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.ink(.90), marginBottom: 6, lineHeight: 1.4 }}>{item.name}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                    {item.priority && <Pill label={item.priority} color={priorityColor(item.priority)} />}
                    {item.due_date && <span style={{ fontSize: 10, color: t.ink(.35) }}>{item.due_date}</span>}
                  </div>
                  <select
                    value={item.status}
                    onClick={e => e.stopPropagation()}
                    onChange={e => onUpdateItem(item.id, { status: e.target.value })}
                    style={{ fontSize: 10, background: t.ink(.05), border: `1px solid ${t.ink(.1)}`, borderRadius: 6, color: t.ink(.6), padding: "2px 4px", fontFamily: FONT }}
                  >
                    {Array.from(new Set([...STATUS_OPTIONS, item.status])).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ))}
              {cards.length === 0 && <div style={{ fontSize: 10.5, color: t.ink(.20), padding: "8px 4px" }}>No items</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── CALENDAR VIEW ────────────────────────────────────────────────────────────

function navBtnStyle(t: ReturnType<typeof useOpsTheme>): React.CSSProperties {
  return { width: 26, height: 26, borderRadius: 7, background: t.ink(.05), border: `1px solid ${t.ink(.1)}`, color: t.ink(.55), cursor: "pointer", fontSize: 14, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" };
}

function CalendarView({ items, onOpenDrawer }: { items: OrganiserItem[]; onOpenDrawer: (item: OrganiserItem) => void }) {
  const t = useOpsTheme();
  const [monthDate, setMonthDate] = useState(() => new Date());
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const itemsByDate = new Map<string, OrganiserItem[]>();
  for (const it of items) {
    if (!it.due_date) continue;
    const arr = itemsByDate.get(it.due_date) ?? [];
    arr.push(it);
    itemsByDate.set(it.due_date, arr);
  }
  const todayStr = fmt(new Date());

  return (
    <div style={{ padding: "4px 20px 20px", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button onClick={() => setMonthDate(new Date(year, month - 1, 1))} style={navBtnStyle(t)}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: t.ink(.90), minWidth: 150, textAlign: "center" }}>
          {monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => setMonthDate(new Date(year, month + 1, 1))} style={navBtnStyle(t)}>›</button>
        <button onClick={() => setMonthDate(new Date())} style={{ ...btnStyle(false, t), marginLeft: 4 }}>Today</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, flex: 1, overflowY: "auto" }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", color: t.ink(.28), textTransform: "uppercase", padding: "0 4px 4px" }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const key = d ? fmt(d) : `blank-${i}`;
          const dayItems = d ? (itemsByDate.get(fmt(d)) ?? []) : [];
          const isToday = !!d && fmt(d) === todayStr;
          return (
            <div key={key} style={{ minHeight: 86, borderRadius: 8, padding: 6, background: d ? t.ink(.02) : "transparent", border: d ? `1px solid ${isToday ? "rgba(139,92,246,.4)" : t.ink(.05)}` : "none" }}>
              {d && <div style={{ fontSize: 10.5, fontWeight: isToday ? 700 : 500, color: isToday ? "#C4B5FD" : t.ink(.35), marginBottom: 4 }}>{d.getDate()}</div>}
              {dayItems.slice(0, 3).map(it => (
                <div
                  key={it.id} onClick={() => onOpenDrawer(it)} title={it.name}
                  style={{ fontSize: 9.5, fontWeight: 600, color: t.ink(.90), background: `${statusColor(it.status)}22`, border: `1px solid ${statusColor(it.status)}40`, borderRadius: 5, padding: "2px 5px", marginBottom: 3, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {it.name}
                </div>
              ))}
              {dayItems.length > 3 && <div style={{ fontSize: 9, color: t.ink(.25) }}>+{dayItems.length - 3} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BOARD ACTIVITY (Phase D.4.5E) ───────────────────────────────────────────
//
// Read-only board-wide feed — "what changed on this board" — sourced from
// GET /api/organiser/activity?boardId= (lib/organiser/activityRead.ts's
// listBoardActivity — tenant-scoped, deletion-safe, keyset-paginated,
// mirroring ItemActivity's own fetch/pagination shape exactly). Kept LOCAL
// to this file rather than split into components/organiser/BoardActivity.tsx
// — every other per-view surface in this file (KanbanView, CalendarView,
// ItemDrawer, ItemActivity) is already a local function, not a separate
// component file; BoardActivity is directly analogous to KanbanView/
// CalendarView (one more board VIEW alongside table/board/calendar), and
// splitting only this one out would both break that established local
// convention and require threading boardId/items/groupNamesById/onOpenItem
// across a new file boundary for no benefit — everything it needs is
// already in scope in OrganiserPageContent.
//
// Mounted only while the Activity view is selected (view === "activity"),
// matching KanbanView/CalendarView's own "only render while this view is
// active" convention — never fetched for an inactive view. Re-fetches from
// page 1 whenever boardId changes (switching boards) or refreshKey changes
// (a mutation happened while this view is open — see its call site's
// boardActivityRefreshKey, derived from boardData.items).
function BoardActivity({
  boardId, items, groupNamesById, userNamesById, onOpenItem, refreshKey,
}: {
  boardId: string; items: OrganiserItem[]; groupNamesById: Record<string, string>;
  userNamesById: Record<string, string>;
  onOpenItem: (item: OrganiserItem) => void; refreshKey: string;
}) {
  const t = useOpsTheme();
  const [events, setEvents] = useState<OrganiserActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Phase D.4.5E — section 12/19: item name resolution (for events whose
  // own before/after diff doesn't happen to include `name`) and item
  // click-through both need the board's CURRENT live items, never an
  // independent fetch. Derived from the same `items` prop already loaded
  // by the page for the table/board/calendar views.
  const liveItemsById = useMemo(() => {
    const map: Record<string, OrganiserItem> = {};
    for (const it of items) map[it.id] = it;
    return map;
  }, [items]);
  const liveItemNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const it of items) map[it.id] = it.name;
    return map;
  }, [items]);

  // No synchronous setLoading(true)/setError(null) here — same
  // react-hooks/set-state-in-effect avoidance as ItemActivity, via the
  // key={`${boardId}:${refreshKey}`} on this component's call site, which
  // remounts a fresh instance (loading/error/events already at their
  // initial values) instead of this effect resetting them imperatively.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/organiser/activity?boardId=${encodeURIComponent(boardId)}`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then(d => {
        if (cancelled) return;
        setEvents(d.activity ?? []);
        setNextCursor(d.next_cursor ?? null);
      })
      .catch(() => { if (!cancelled) setError("Unable to load activity."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boardId, refreshKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/organiser/activity?boardId=${encodeURIComponent(boardId)}&cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const d = await res.json();
      setEvents(prev => [...prev, ...(d.activity ?? [])]);
      setNextCursor(d.next_cursor ?? null);
    } catch {
      setError("Unable to load more activity.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 60px" }}>
      {loading ? (
        <div style={{ color: t.ink(.35), fontSize: 13 }}>Loading activity…</div>
      ) : error ? (
        <div style={{ color: "#EF4444", fontSize: 13 }}>{error}</div>
      ) : events.length === 0 ? (
        <div style={{ color: t.ink(.30), fontSize: 12.5 }}>No activity yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
          {events.map(ev => {
            const desc = describeBoardActivityEvent(ev, groupNamesById, liveItemNamesById, userNamesById);
            // Deleted items (and any non-item entity type, once a future
            // phase instruments one) have no live row to open — no
            // click-through for those, per section 19.
            const liveItem = ev.entity_type === "item" ? liveItemsById[ev.entity_id] : undefined;
            return (
              <div key={ev.id} style={{ padding: "10px 12px", borderRadius: 8, background: t.ink(.025), border: `1px solid ${t.ink(.05)}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 8 }}>
                  <span
                    onClick={liveItem ? () => onOpenItem(liveItem) : undefined}
                    style={{
                      fontSize: 12, fontWeight: 600, color: t.ink(.80),
                      cursor: liveItem ? "pointer" : "default",
                    }}
                  >
                    {desc.summary}
                  </span>
                  <span style={{ fontSize: 9.5, color: t.ink(.25), flexShrink: 0 }}>{new Date(ev.created_at).toLocaleString()}</span>
                </div>
                {desc.detail && (
                  <div style={{ fontSize: 11.5, color: t.ink(.55), fontStyle: "italic", marginTop: 2 }}>{`"${desc.detail}"`}</div>
                )}
                {desc.diffs.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                    {desc.diffs.map((d, i) => (
                      <div key={i} style={{ fontSize: 11, color: t.ink(.6) }}>
                        <span style={{ color: t.ink(.4) }}>{d.label}: </span>
                        {d.before !== null ? (
                          <>{d.before} <span style={{ color: t.ink(.3) }}>→</span> {d.after}</>
                        ) : d.after}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {nextCursor && (
            <button onClick={loadMore} disabled={loadingMore} style={btnStyle(false, t)}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── ITEM DETAIL DRAWER ──────────────────────────────────────────────────────

// ── ITEM ACTIVITY (Phase D.4.5D) ────────────────────────────────────────────
//
// Read-only history for one item, sourced from GET /api/organiser/activity
// (lib/organiser/activityRead.ts — tenant-scoped, deletion-safe, keyset-
// paginated). Mounted only while the item drawer is open (ItemDrawer only
// renders when openItem is non-null), so activity is never fetched for a
// closed drawer. Re-fetches from page 1 whenever `itemId` OR `updatedAt`
// changes — `updatedAt` changing means this same item was just mutated
// (status/priority/owner/due date/notes/custom field edit, or a move) via
// onUpdate elsewhere in this file, so the freshly-written activity row
// needs to appear without requiring the drawer to be closed and reopened.
// This reuses the item's own already-tracked updated_at as the cheapest
// possible "did something change" signal — no new global state, no extra
// request. D.4.7C fixed the one thing that used to make this a broken
// promise in practice: `item` here is now ALWAYS derived fresh from
// boardData.items (see openItem at this file's top-level component), so
// `item.updated_at` genuinely changes after loadBoardData() reloads post-
// mutation — before D.4.7C, `item` was a separately-held `drawerItem`
// snapshot whose `updated_at` was frozen at drawer-open time and never
// updated, so this key never actually changed and Activity silently never
// refreshed while the drawer stayed open.
// request beyond what a genuine mutation already causes.
function ItemActivity({
  itemId, updatedAt, groupNamesById, userNamesById,
}: { itemId: string; updatedAt: string; groupNamesById: Record<string, string>; userNamesById: Record<string, string> }) {
  const t = useOpsTheme();
  const [events, setEvents] = useState<OrganiserActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // No synchronous setLoading(true)/setError(null) here on purpose (avoids
  // react-hooks/set-state-in-effect) — the caller keys this component by
  // `${itemId}:${updatedAt}` (see its ItemDrawer call site), so a change to
  // either one remounts a fresh instance with loading/error/events already
  // at their initial values, rather than this effect needing to reset them
  // imperatively.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/organiser/activity?itemId=${encodeURIComponent(itemId)}`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then(d => {
        if (cancelled) return;
        setEvents(d.activity ?? []);
        setNextCursor(d.next_cursor ?? null);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load activity."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [itemId, updatedAt]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/organiser/activity?itemId=${encodeURIComponent(itemId)}&cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const d = await res.json();
      setEvents(prev => [...prev, ...(d.activity ?? [])]);
      setNextCursor(d.next_cursor ?? null);
    } catch {
      setError("Couldn't load more activity.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <div style={{ ...SECTION_LABEL, color: t.ink(.30) }}>Activity</div>
      {loading ? (
        <div style={{ fontSize: 11, color: t.ink(.25) }}>Loading…</div>
      ) : error ? (
        <div style={{ fontSize: 11, color: "#EF4444" }}>{error}</div>
      ) : events.length === 0 ? (
        <div style={{ fontSize: 11, color: t.ink(.25) }}>No activity yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map(ev => {
            const desc = describeActivityEvent(ev, groupNamesById, userNamesById);
            return (
              <div key={ev.id} style={{ padding: "8px 10px", borderRadius: 8, background: t.ink(.025), border: `1px solid ${t.ink(.05)}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: t.ink(.75) }}>{desc.summary}</span>
                  <span style={{ fontSize: 9.5, color: t.ink(.25), flexShrink: 0 }}>{new Date(ev.created_at).toLocaleString()}</span>
                </div>
                {desc.detail && (
                  <div style={{ fontSize: 11.5, color: t.ink(.55), fontStyle: "italic", marginTop: 2 }}>{`"${desc.detail}"`}</div>
                )}
                {desc.diffs.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                    {desc.diffs.map((d, i) => (
                      <div key={i} style={{ fontSize: 11, color: t.ink(.6) }}>
                        <span style={{ color: t.ink(.4) }}>{d.label}: </span>
                        {d.before !== null ? (
                          <>{d.before} <span style={{ color: t.ink(.3) }}>→</span> {d.after}</>
                        ) : d.after}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {nextCursor && (
            <button onClick={loadMore} disabled={loadingMore} style={btnStyle(false, t)}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ItemDrawer({
  item, onClose, onUpdate, groupNamesById, members, saveStatus,
}: {
  item: OrganiserItem; onClose: () => void; onUpdate: (id: string, patch: Record<string, unknown>) => void;
  groupNamesById: Record<string, string>; members: OrganiserMember[];
  // D.4.7B — same shared, `item:<id>:<field>`-keyed store as the table
  // row; only this open item's own entries are ever looked up below.
  saveStatus: Record<string, SaveStatus>;
}) {
  const t = useOpsTheme();
  const fieldEntries = Object.entries(item.fields || {});
  // Phase D.4.6P — same id -> name lookup OrganiserPageContent's own
  // userNamesById provides, built locally from this drawer's own already
  // tenant-scoped ACTIVE-members prop (the same list the Assignee picker
  // itself renders) rather than prop-drilling a second parallel map.
  const userNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.id] = m.name;
    return map;
  }, [members]);
  const [files, setFiles] = useState<OrganiserFile[]>([]);
  const [updates, setUpdates] = useState<OrganiserUpdate[]>([]);
  const [newUpdate, setNewUpdate] = useState("");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/organiser/items/${item.id}/files`, { credentials: "include" }).then(r => r.ok ? r.json() : { files: [] }).then(d => setFiles(d.files ?? [])).catch(() => {});
    fetch(`/api/organiser/items/${item.id}/updates`, { credentials: "include" }).then(r => r.ok ? r.json() : { updates: [] }).then(d => setUpdates(d.updates ?? [])).catch(() => {});
  }, [item.id]);

  // D.4.7C — Notes local draft + debounced autosave.
  //
  // Before this phase, the Notes textarea called onUpdate(id, { notes })
  // directly on every keystroke — R1's coalescing queue kept that
  // network-safe (at most one PATCH in flight, latest intent always wins),
  // but per-keystroke PATCH traffic is undesirable on its own, and typing
  // was one keystroke away from momentarily showing whatever boardData.
  // notes last settled to.
  //
  // notesDraft is now the ONLY thing the textarea renders — entirely local
  // component state, decoupled from item.notes (the authoritative,
  // boardData-derived value). notesDirty is true whenever the draft holds
  // something not yet confirmed identical to item.notes: from the first
  // keystroke, through the debounce window, through the in-flight PATCH,
  // and (critically) through a FAILED save — a rejected write must never
  // silently replace the user's typed text with the rolled-back
  // authoritative value the way a dropdown's rollback safely can. dirty is
  // cleared only when this exact key's SaveStatus reaches "saved" (see the
  // effect below) — reusing the same generic saveStatus/markSaved signal
  // every other field already produces, rather than inventing a second,
  // parallel notion of "the request for this field settled successfully."
  //
  // notesAutosave is one stable controller instance reused across item
  // switches (ItemDrawer is not remounted when the open item changes).
  // Lazily created via useState's own initializer (never a ref) — this
  // repo's lint config (react-hooks/refs) flags reading/writing a ref
  // during render, so the controller instance itself, and the "which item
  // did we last see" bookkeeping below, are ALL plain state, compared and
  // conditionally updated synchronously during render (React's documented
  // "adjusting state when a prop changes" pattern — see the block below).
  // See notesAutosave.ts's own header for why a timer scheduled for one
  // item can never fire with a different item's id or value.
  const notesKey = `item:${item.id}:notes`;
  const [notesDraft, setNotesDraft] = useState(item.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesAutosave] = useState<NotesAutosaveTimer<string>>(() =>
    createNotesAutosaveTimer<string>(
      (itemId, value) => onUpdate(itemId, { notes: value }),
      { debounceMs: 800 },
    ),
  );
  const [notesSeenItemId, setNotesSeenItemId] = useState(item.id);
  const [notesSeenValue, setNotesSeenValue] = useState(item.notes ?? "");

  // Synchronous state adjustment during render (no effect, no ref) — this
  // repo's lint config (react-hooks/set-state-in-effect) flags a plain
  // setState call inside a useEffect body for exactly this kind of "sync
  // local state to a changed prop" job, and react-hooks/refs flags reading
  // a ref during render, so both the item-switch case and the same-item
  // authoritative-refresh case are expressed as comparisons against
  // ordinary state instead, each firing only when something has actually
  // changed since the last render (so this can't loop).
  if (notesSeenItemId !== item.id) {
    // Item switch (this SAME ItemDrawer instance now shows a different
    // item) — re-initialise local draft state for the NEW item.
    setNotesSeenItemId(item.id);
    setNotesSeenValue(item.notes ?? "");
    setNotesDraft(item.notes ?? "");
    setNotesDirty(false);
  } else if (notesSeenValue !== (item.notes ?? "")) {
    // Same item, background authoritative refresh (this client's own
    // reconciliation/rollback, or — were it ever wired up — a server-side
    // change): adopt the fresh item.notes into the draft ONLY while
    // clean. A dirty draft (unsent edit, in-flight save, or a failure the
    // user hasn't since resolved) must never be overwritten here.
    setNotesSeenValue(item.notes ?? "");
    if (!notesDirty) setNotesDraft(item.notes ?? "");
  }

  // The generic saveStatus store is the authoritative "did the LATEST
  // intended value actually persist" signal (see updateItem's own
  // hasNewerPending()-gated markSaved) — reusing it here, rather than
  // inferring success from onUpdate's own return value, is deliberate:
  // updateItem resolves immediately (without waiting) for a call that
  // gets coalesced behind an in-flight one for the same key, so its
  // return value alone can't be trusted to mean "this exact value saved."
  // Same render-time-comparison shape as above, for the same lint reason.
  const notesSaveState = saveStatus[notesKey]?.state;
  const [notesSeenSaveState, setNotesSeenSaveState] = useState(notesSaveState);
  if (notesSeenSaveState !== notesSaveState) {
    setNotesSeenSaveState(notesSaveState);
    if (notesSaveState === "saved") setNotesDirty(false);
  }

  // Flushes a dirty draft as a genuine effect (an actual side effect —
  // dispatching a save — unlike the render-time state adjustments above)
  // whenever this drawer is about to stop showing THIS item: either
  // switching to a different item (cleanup runs before the effect
  // re-fires for the new item.id) or the drawer closing outright (cleanup
  // runs on unmount, regardless of dependency array). Using peek()+
  // cancel() here (not in handleNotesChange or the render body) means a
  // failed-to-debounce edit typed right before switching/closing is never
  // silently discarded.
  useEffect(() => {
    return () => {
      const pending = notesAutosave.peek();
      if (pending) {
        notesAutosave.cancel();
        onUpdate(pending.itemId, { notes: pending.value });
      }
    };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleNotesChange(value: string) {
    setNotesDraft(value);
    if (value === (item.notes ?? "")) {
      // Back to the authoritative value (e.g. the user undid their own
      // edit) — nothing to send, and nothing to protect from reconciliation.
      notesAutosave.cancel();
      setNotesDirty(false);
      return;
    }
    setNotesDirty(true);
    notesAutosave.schedule(item.id, value);
  }

  function flushNotesNow() {
    const pending = notesAutosave.peek();
    if (!pending) return;
    notesAutosave.cancel();
    onUpdate(pending.itemId, { notes: pending.value });
  }

  async function uploadFile(file: File) {
    setUploadingFile(true);
    setFileError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/organiser/items/${item.id}/files`, { method: "POST", credentials: "include", body: fd });
      let d: { file?: OrganiserFile; error?: string } = {};
      try { d = await res.json(); } catch { /* non-JSON error body */ }
      if (!res.ok || !d.file) {
        setFileError(d.error || `Upload failed (${res.status}).`);
        return;
      }
      setFiles(prev => [d.file!, ...prev]);
    } catch {
      setFileError("Upload failed. Check your connection and try again.");
    } finally {
      setUploadingFile(false);
    }
  }
  async function deleteFile(fileId: string) {
    setFileError(null);
    try {
      const res = await fetch(`/api/organiser/items/${item.id}/files/${fileId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        setFileError(`Couldn't delete file (${res.status}).`);
        return;
      }
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch {
      setFileError("Couldn't delete file. Check your connection and try again.");
    }
  }
  // D.4.7C — was previously "fake success": it cleared the input and
  // never surfaced an error regardless of whether the POST actually
  // succeeded. Now mirrors uploadFile/deleteFile's own res.ok + catch
  // pattern — the input (and the user's typed text) is only cleared on a
  // confirmed success, matching Step 3's "on failure, do not fake success."
  async function addUpdate() {
    const body = newUpdate.trim();
    if (!body) return;
    setUpdateError(null);
    try {
      const res = await fetch(`/api/organiser/items/${item.id}/updates`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ body }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.update) {
        setUpdateError(`Couldn't post update (${res.status}).`);
        return;
      }
      setUpdates(prev => [d.update, ...prev]);
      setNewUpdate("");
    } catch {
      setUpdateError("Couldn't post update. Check your connection and try again.");
    }
  }

  // D.4.6P-R2 (PR #214 UI blocker fix) — OrganiserShell wraps this drawer's
  // page tree in its own `position: fixed; z-index: 50` box, which
  // establishes a stacking context. A z-index set on a descendant (this
  // drawer's own 200) is only ever compared *inside* that context, so it
  // can never out-rank siblings of OrganiserShell itself — TopNav
  // (position: sticky, z-index: 100) and the HLNA assistant bar
  // (z-index: 60-70) both live outside it and always painted over the
  // drawer regardless of the drawer's own z-index. Portaling straight to
  // document.body escapes that trap entirely, the same fix TopNav.tsx
  // already uses for its own dropdown menus (see its own comment there).
  // No layout/offset math needed — once escaped, 200 already beats both.
  const drawerContent = (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.45)" }} />
      <div style={{
        position: "relative", width: 400, maxWidth: "92vw", height: "100%",
        background: t.panelBgSolid, borderLeft: `1px solid ${t.ink(.08)}`,
        display: "flex", flexDirection: "column", boxShadow: "-16px 0 40px rgba(0,0,0,.5)",
        animation: "drawer-in .18s ease",
      }}>
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${t.ink(.06)}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <InlineText value={item.name} bold onSave={v => onUpdate(item.id, { name: v })} status={saveStatus[`item:${item.id}:name`]} />
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 7, background: t.ink(.05), border: `1px solid ${t.ink(.08)}`, color: t.ink(.5), cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Field label="Status" status={saveStatus[`item:${item.id}:status`]}><PillSelect value={item.status} options={STATUS_OPTIONS} colorFor={statusColor} onChange={v => onUpdate(item.id, { status: v })} /></Field>
            <Field label="Priority" status={saveStatus[`item:${item.id}:priority`]}><PillSelect value={item.priority ?? ""} options={PRIORITY_OPTIONS} colorFor={priorityColor} onChange={v => onUpdate(item.id, { priority: v })} placeholder="None" /></Field>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Field label="Due date" status={saveStatus[`item:${item.id}:due_date`]}>
              <input type="date" value={item.due_date ?? ""} onChange={e => onUpdate(item.id, { due_date: e.target.value || null })}
                style={{ background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, color: t.ink(.90), fontFamily: FONT, colorScheme: "dark" }} />
            </Field>
            <Field label="Owner">
              <input value={item.owner ?? ""} onChange={e => onUpdate(item.id, { owner: e.target.value })}
                placeholder="Unassigned"
                style={{ background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, color: t.ink(.90), fontFamily: FONT, width: 140 }} />
            </Field>
          </div>

          {/* Phase D.4.6P — real, identity-bound assignee. Deliberately a
              SEPARATE field from the legacy free-text Owner input above,
              not a replacement for it (see this phase's own discovery
              report) — a real dropdown of this organisation's own ACTIVE
              members (from GET /api/organiser/members), never free text.
              An empty option always means "Unassigned" (assignee_user_id:
              null), the same semantics the human PATCH route and Helena's
              own propose_organiser_assignee_change both use. */}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Field label="Assignee" status={saveStatus[`item:${item.id}:assignee_user_id`]}>
              <AssigneeDropdown
                value={item.assignee_user_id ?? ""}
                members={members}
                onChange={v => onUpdate(item.id, { assignee_user_id: v || null })}
              />
            </Field>
          </div>

          <Field label="Notes" status={saveStatus[notesKey]}>
            <textarea
              value={notesDraft}
              onChange={e => handleNotesChange(e.target.value)}
              onBlur={flushNotesNow}
              rows={4}
              placeholder="Add notes…"
              style={{ background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: t.ink(.90), fontFamily: FONT, resize: "vertical", width: "100%" }}
            />
          </Field>

          <div>
            <div style={{ ...SECTION_LABEL, color: t.ink(.30) }}>Files</div>
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploadingFile} style={{ ...btnStyle(false, t), marginBottom: 8 }}>
              {uploadingFile ? "Uploading…" : "+ Attach file"}
            </button>
            {fileError && (
              <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 6 }}>{fileError}</div>
            )}
            {files.length === 0 ? (
              <div style={{ fontSize: 11, color: t.ink(.25) }}>No files attached.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {files.map(f => (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 7, background: t.ink(.03), border: `1px solid ${t.ink(.06)}` }}>
                    <a href={f.file_url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 11.5, color: "#a5b4fc", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</a>
                    <span style={{ fontSize: 9.5, color: t.ink(.25) }}>{f.file_size ? `${Math.round(f.file_size / 1024)} KB` : ""}</span>
                    <button onClick={() => deleteFile(f.id)} style={{ background: "transparent", border: "none", color: "rgba(239,68,68,.6)", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={{ ...SECTION_LABEL, color: t.ink(.30) }}>Updates</div>
            <textarea
              value={newUpdate} onChange={e => setNewUpdate(e.target.value)} rows={2}
              placeholder="Post an update…"
              style={{ width: "100%", background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 8, padding: "6px 9px", fontSize: 11.5, color: t.ink(.90), fontFamily: FONT, resize: "vertical", marginBottom: 6 }}
            />
            <button onClick={addUpdate} disabled={!newUpdate.trim()} style={{ ...btnStyle(true, t), marginBottom: 10 }}>Post update</button>
            {updateError && (
              <div style={{ fontSize: 11, color: "#EF4444", marginBottom: 8 }}>{updateError}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {updates.map(u => (
                <div key={u.id} style={{ padding: "8px 10px", borderRadius: 8, background: t.ink(.025), border: `1px solid ${t.ink(.05)}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: t.ink(.6) }}>{u.author_name || "Someone"}</span>
                    <span style={{ fontSize: 9.5, color: t.ink(.25), flexShrink: 0 }}>{new Date(u.created_at).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: t.ink(.8), lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{u.body}</div>
                </div>
              ))}
            </div>
          </div>

          <ItemActivity key={`${item.id}:${item.updated_at}`} itemId={item.id} updatedAt={item.updated_at} groupNamesById={groupNamesById} userNamesById={userNamesById} />

          {fieldEntries.length > 0 && (
            <div>
              <div style={{ ...SECTION_LABEL, color: t.ink(.30) }}>Imported fields</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {fieldEntries.map(([k, v]) => (
                  <div key={k} style={{ fontSize: 11.5, lineHeight: 1.5, padding: "6px 9px", borderRadius: 7, background: t.ink(.03), border: `1px solid ${t.ink(.05)}` }}>
                    <div style={{ color: t.ink(.35), fontWeight: 600, marginBottom: 1, textTransform: "capitalize" }}>{k}</div>
                    <div style={{ color: t.ink(.75) }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(drawerContent, document.body) : null;
}

function Field({ label, children, status }: { label: string; children: React.ReactNode; status?: SaveStatus }) {
  const t = useOpsTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ display: "flex", alignItems: "center", fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", color: t.ink(.30), textTransform: "uppercase" }}>
        {label}
        <SaveStatusText status={status} />
      </span>
      {children}
    </div>
  );
}

// ── PAGE ─────────────────────────────────────────────────────────────────────

type ViewMode = "table" | "board" | "calendar" | "activity";

// Board deep-link (?board=<id>) — smallest addition supporting Founder OS's
// "Open in Organiser" landing directly on a specific board (e.g. Founder
// Tasks) instead of always defaulting to the first board by position.
// Read once at mount; normal in-page board switching (clicking a board tab)
// still goes through setActiveId directly and is unaffected. Tenancy is
// enforced identically to every other board reference here: `list` itself
// only ever contains boards GET /api/organiser/boards already scoped to
// the caller's own organisation_id (see that route), so a foreign-org id
// in the URL simply won't be found in `list` and falls through to the
// existing first-board default — never a special "not found" state, never
// a cross-org data fetch. No URL param write-back on manual switching by
// design (out of scope for this correction).
function OrganiserPageContent() {
  const t = useOpsTheme();
  const searchParams = useSearchParams();
  const requestedBoardId = searchParams.get("board");
  const [boards, setBoards] = useState<OrganiserBoard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("table");
  // D.4.7C — the open drawer tracks only WHICH item is open, never a
  // separate copy of the item's own data. `openItem` (derived below, once
  // boardData is in scope) is looked up fresh from boardData.items on
  // every render, so a `loadBoardData()` refresh — from this client's own
  // mutation, or (were it ever wired up) a server-side/Helena change —
  // updates the open drawer's fields automatically, with no separate
  // "drawerItem" copy that could ever drift out of sync with boardData.
  // Before this phase, `drawerItem: OrganiserItem | null` held its own
  // snapshot of the item, patched in parallel by applyOptimisticItemPatch/
  // restoreItemFields — a split-brain that meant ItemActivity's own
  // `${item.id}:${item.updated_at}` refresh key never actually changed
  // after a mutation (drawerItem.updated_at was frozen at open-time), so
  // Activity silently never refreshed while the drawer stayed open.
  const [openDrawerItemId, setOpenDrawerItemId] = useState<string | null>(null);
  const [editingColumn, setEditingColumn] = useState<OrganiserColumn | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  // D.4.7B — duplicate-submit guard for +New group, mirroring AddItemRow:
  // the Enter key AND the Add button both route through this one submit
  // path, guarded by groupSubmitting so a fast double-click/Enter-then-
  // click cannot fire two POSTs for the same name.
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  // D.4.7D — repeatable group creation, modeled directly on AddItemRow:
  // a confirmed success clears the input and keeps the creation UI open
  // (never `setAddingGroup(false)`) so the user can immediately type the
  // next group name, exactly like the item-add row already does. Same
  // `createGroup(name): Promise<boolean>` path, same duplicate-submit
  // guard, same failure semantics (retain typed name, show error, stay
  // open, allow retry) — only the "what happens on success" branch
  // changed from D.4.7B's one-shot close.
  const groupNameInputRef = useRef<HTMLInputElement>(null);
  async function submitNewGroup() {
    const trimmed = groupName.trim();
    if (!trimmed || groupSubmitting) return;
    setGroupSubmitting(true);
    setGroupError(null);
    const ok = await createGroup(trimmed);
    setGroupSubmitting(false);
    if (ok) {
      setGroupName("");
      // The input is still `disabled={groupSubmitting}` in the DOM at this
      // exact point — setGroupSubmitting(false) above hasn't been flushed
      // into a real render yet (we're still inside the same synchronous
      // continuation), and a disabled input silently refuses focus(). A
      // macrotask defers this past that render, matching Test A7's live
      // requirement (a static check that the call merely exists would
      // have missed this — it only surfaces with a real disabled->enabled
      // transition in the browser).
      setTimeout(() => groupNameInputRef.current?.focus(), 0);
    } else {
      setGroupError("Couldn't create group. Try again.");
    }
  }
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [sheetChoices, setSheetChoices] = useState<SheetChoice[] | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // D.4.7B — mutation reliability + save-state foundation.
  //
  // saveStatus: one shared, keyed store every scalar-field mutation
  // reports into (see the SaveStatus type's own header comment for the
  // key convention). markSaving/markSaved/markError are the only
  // writers; markSaved schedules its own auto-clear back to "idle" after
  // a short, fixed delay, guarded so a newer status written in the
  // meantime (e.g. a fresh edit already saving again) is never
  // stomped back to idle by an old timer.
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  function markSaving(key: string) {
    setSaveStatus(prev => ({ ...prev, [key]: { state: "saving" } }));
  }
  function markSaved(key: string) {
    setSaveStatus(prev => ({ ...prev, [key]: { state: "saved" } }));
    setTimeout(() => {
      setSaveStatus(prev => (prev[key]?.state === "saved" ? { ...prev, [key]: { state: "idle" } } : prev));
    }, 1600);
  }
  function markError(key: string, message: string) {
    setSaveStatus(prev => ({ ...prev, [key]: { state: "error", message } }));
  }

  // boardLoadSeqRef guards EVERY loadBoardData call (regardless of which
  // mutation triggered it) against an out-of-order network response: if
  // a newer load has been kicked off by the time an older one resolves,
  // the older one's result is discarded rather than overwriting fresher
  // board state.
  const boardLoadSeqRef = useRef(0);

  // D.4.7B-R1 — replaces the original itemOpSeqRef response-sequence guard.
  // That guard only decided which RESPONSE the client trusted; it could
  // never prevent two overlapping REQUESTS for the same item+field from
  // being dispatched to the server back-to-back, so a network-delayed
  // earlier request could still commit last and leave server truth
  // diverged from what the client displayed. This queue guarantees at
  // most one PATCH in flight per `item:<id>:<fieldKey>` key at a time —
  // see lib/organiser/coalescingMutationQueue.ts's own header for the
  // full reasoning — which is what actually makes server commit order
  // deterministic, not just client display order.
  const itemFieldQueueRef = useRef<CoalescingQueueMap<Record<string, unknown>>>({});
  // D.4.7E (Slice E2) — separate from itemFieldQueueRef (different value
  // shape: a full ordered-id array, not a field patch). Keyed
  // `board:<boardId>:group-order` today; E3/E4's own item/subitem reorder
  // will use their own distinct key shapes on this same ref, matching the
  // discovery report's own recommendation.
  const reorderQueueRef = useRef<CoalescingQueueMap<string[]>>({});

  // Lightweight, single-slot transient notice for mutations with no
  // natural inline anchor to show Saving/Saved/error next to (group/item
  // delete, group create when the add-row has already closed). Not a
  // general toast framework — one message at a time, auto-clearing.
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  function showPageNotice(message: string) {
    setPageNotice(message);
    setTimeout(() => setPageNotice(prev => (prev === message ? null : prev)), 4000);
  }
  // Phase D.4.6P — organisation members for the assignee picker. Loaded
  // once per mount (membership doesn't change per-board, unlike
  // boardData) — never re-fetched on every board switch.
  const [members, setMembers] = useState<OrganiserMember[]>([]);
  useEffect(() => {
    fetch("/api/organiser/members", { credentials: "include" })
      .then(r => r.ok ? r.json() : { members: [] })
      .then(d => setMembers(d.members ?? []))
      .catch(() => {});
  }, []);

  // Phase D.4.5D — id -> name lookup for the Item Activity tab's group_id
  // resolution (lib/organiser/activityFormat.ts's resolveGroupLabel). Built
  // from this board's own already tenant-scoped groups list — never an
  // independent fetch — so a group renamed or deleted since a given
  // activity row was written safely falls back to "Another group" rather
  // than showing a stale or fabricated name.
  const groupNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of boardData?.groups ?? []) map[g.id] = g.name;
    return map;
  }, [boardData?.groups]);

  // Phase D.4.6P — id -> name lookup for the Activity tabs' assignee_user_id
  // resolution (lib/organiser/activityFormat.ts's resolveAssigneeLabel),
  // mirroring groupNamesById's own shape exactly. Built from this
  // organisation's own already tenant-scoped ACTIVE-members list (the same
  // GET /api/organiser/members fetch the assignee picker itself uses) —
  // never an independent fetch — so a deactivated/removed member since a
  // given activity row was written safely falls back to "Another member"
  // rather than showing a stale or fabricated name.
  const userNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.id] = m.name;
    return map;
  }, [members]);

  // Phase D.4.5E — cheap "did anything on this board change" signal for
  // BoardActivity's refresh effect, the board-level analogue of
  // ItemActivity's `${item.id}:${item.updated_at}` key. boardData.items is
  // already reloaded (a fresh array) after every mutation on this page
  // (addItem/updateItem/deleteItem/import/etc. all call loadBoardData), so
  // combining item count (catches create/delete) with the latest
  // updated_at across all items (catches update/move) covers every
  // mutation kind without diffing the array itself or introducing any new
  // state/global framework.
  const boardActivityRefreshKey = useMemo(() => {
    const items = boardData?.items ?? [];
    let latest = "";
    for (const it of items) if (it.updated_at > latest) latest = it.updated_at;
    return `${items.length}:${latest}`;
  }, [boardData?.items]);

  const loadBoards = useCallback(async (selectId?: string) => {
    const res = await fetch("/api/organiser/boards", { credentials: "include" });
    const d = await res.json().catch(() => ({ boards: [] }));
    const list: OrganiserBoard[] = d.boards ?? [];
    setBoards(list);
    if (selectId) {
      setActiveId(selectId);
    } else if (!activeId) {
      // Only ever consulted on initial load (activeId still unset) — a
      // requested board id that isn't in this org's own board list (wrong
      // org, deleted board, typo) is silently ignored, not surfaced as an
      // error, falling through to the existing first-board behaviour.
      const requested = requestedBoardId && list.some(b => b.id === requestedBoardId) ? requestedBoardId : null;
      if (requested) setActiveId(requested);
      else if (list.length > 0) setActiveId(list[0].id);
    }
    setLoading(false);
  }, [activeId, requestedBoardId]);

  const loadBoardData = useCallback(async (boardId: string) => {
    // D.4.7B — sequence-guarded against out-of-order responses: every
    // call claims the next number, and a response is only ever applied
    // if no newer call has started since. Without this, a slow reload
    // triggered by an earlier edit could resolve after (and silently
    // overwrite) a newer reload that already reflects a more recent
    // edit — reintroducing exactly the stale-response regression D.4.7B
    // exists to close off, at the one place ALL mutations converge.
    const seq = ++boardLoadSeqRef.current;
    let res: Response;
    try {
      res = await fetch(`/api/organiser/boards/${boardId}`, { credentials: "include" });
    } catch {
      return;
    }
    if (boardLoadSeqRef.current !== seq) return;
    if (!res.ok) { setBoardData(null); return; }
    const d = await res.json();
    if (boardLoadSeqRef.current !== seq) return;
    setBoardData(d);
  }, []);

  useEffect(() => { loadBoards(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeId) loadBoardData(activeId); else setBoardData(null); }, [activeId, loadBoardData]);

  async function createBoard(name: string) {
    const res = await fetch("/api/organiser/boards", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
    const d = await res.json();
    if (d.board) await loadBoards(d.board.id);
  }
  async function renameBoard(id: string, name: string) {
    await fetch(`/api/organiser/boards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
    await loadBoards();
    if (id === activeId) loadBoardData(id);
  }
  async function deleteBoard(id: string) {
    await fetch(`/api/organiser/boards/${id}`, { method: "DELETE", credentials: "include" });
    const nextActive = boards.find(b => b.id !== id)?.id ?? null;
    setActiveId(nextActive);
    await loadBoards(nextActive ?? undefined);
  }

  // D.4.7B — createGroup now returns a boolean success indicator (used by
  // the +New group UI's own duplicate-submit guard below) and never
  // silently ignores a non-2xx/network failure — both are treated as
  // failure and reported back to the caller, which is responsible for
  // surfacing them (this function has no natural inline anchor of its
  // own to show an error against).
  async function createGroup(name: string): Promise<boolean> {
    if (!activeId) return false;
    try {
      const res = await fetch(`/api/organiser/boards/${activeId}/groups`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
      if (!res.ok) return false;
    } catch {
      return false;
    }
    await loadBoardData(activeId);
    return true;
  }
  async function renameGroup(id: string, name: string) {
    const key = `group:${id}:name`;
    markSaving(key);
    let ok = false;
    try {
      const res = await fetch(`/api/organiser/groups/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      markError(key, "Couldn't rename group.");
      return;
    }
    markSaved(key);
    if (activeId) loadBoardData(activeId);
  }
  async function deleteGroup(id: string) {
    if (!confirm("Delete this group? Its items will move to “No group”.")) return;
    let ok = false;
    try {
      const res = await fetch(`/api/organiser/groups/${id}`, { method: "DELETE", credentials: "include" });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      showPageNotice("Couldn't delete group. Try again.");
      return;
    }
    if (activeId) loadBoardData(activeId);
  }

  // D.4.7E (Slice E2) — group reorder within one board. Mirrors updateItem's
  // own optimistic/coalesced/rollback shape (see that function's own header
  // comment), adapted for a full-order payload instead of a single-field
  // patch: `confirmedOrder` is captured ONCE per coalesced chain (lazily, on
  // the first attempt), from the board state as it stood immediately BEFORE
  // this drag's own optimistic reorder — so a LATER failure in the same
  // chain rolls back to the last genuinely server-confirmed order, never to
  // an intermediate optimistic state a newer drag has already superseded.
  // A 409 (the board's real group order changed elsewhere since this
  // client's own copy was loaded) is handled differently from every other
  // failure: since the client's whole mental model of the order is stale,
  // not just this one write, a full board reload is the only honest
  // recovery — reverting to `confirmedOrder` would just reapply a second
  // stale order.
  async function reorderGroups(orderedGroupIds: string[]) {
    if (!activeId || !boardData) return;
    const key = `board:${activeId}:group-order`;
    const preDragGroups = boardData.groups;

    setBoardData(prev => {
      if (!prev) return prev;
      const byId = new Map(prev.groups.map(g => [g.id, g]));
      const reordered = orderedGroupIds.map(id => byId.get(id)).filter((g): g is OrganiserGroup => !!g);
      const reorderedIds = new Set(reordered.map(g => g.id));
      const missing = prev.groups.filter(g => !reorderedIds.has(g.id));
      return { ...prev, groups: [...reordered, ...missing] };
    });

    let confirmedOrder: string[] | null = null;

    await enqueueCoalesced(reorderQueueRef.current, key, orderedGroupIds, async (value, hasNewerPending) => {
      if (confirmedOrder === null) confirmedOrder = preDragGroups.map(g => g.id);

      let res: Response | null = null;
      try {
        res = await fetch(`/api/organiser/boards/${activeId}/groups/reorder`, {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ ordered_group_ids: value }),
        });
      } catch {
        res = null;
      }

      if (hasNewerPending()) return;

      if (res && res.status === 409) {
        if (activeId) loadBoardData(activeId);
        return;
      }
      if (!res || !res.ok) {
        showPageNotice("Couldn't save group order. Reverting.");
        const restoreTo = confirmedOrder;
        setBoardData(prev => {
          if (!prev) return prev;
          const byId = new Map(prev.groups.map(g => [g.id, g]));
          const restored = restoreTo.map(id => byId.get(id)).filter((g): g is OrganiserGroup => !!g);
          const restoredIds = new Set(restored.map(g => g.id));
          const missing = prev.groups.filter(g => !restoredIds.has(g.id));
          return { ...prev, groups: [...restored, ...missing] };
        });
        return;
      }

      const data = await res.json().catch(() => null) as { order?: { id: string; position: number }[] } | null;
      if (data?.order) {
        confirmedOrder = value;
        const posById = new Map(data.order.map(o => [o.id, o.position]));
        setBoardData(prev => {
          if (!prev) return prev;
          return { ...prev, groups: prev.groups.map(g => (posById.has(g.id) ? { ...g, position: posById.get(g.id)! } : g)) };
        });
      }
    });
  }

  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  function handleGroupDrop(targetGroupId: string) {
    const draggedId = draggingGroupId;
    setDraggingGroupId(null);
    if (!draggedId || draggedId === targetGroupId || !boardData) return;
    const currentIds = boardData.groups.map(g => g.id);
    const without = currentIds.filter(id => id !== draggedId);
    const targetIndex = without.indexOf(targetGroupId);
    if (targetIndex === -1) return;
    const reordered = [...without.slice(0, targetIndex), draggedId, ...without.slice(targetIndex)];
    reorderGroups(reordered);
  }

  // D.4.7B — addItem now returns a boolean success indicator (used by
  // AddItemRow's own duplicate-submit guard below). No optimistic local
  // item is fabricated here — the server remains the sole source of the
  // new item's id/position/timestamps, exactly as before; this change is
  // purely "stop pretending every POST succeeded."
  async function addItem(name: string, groupId: string | null, parentItemId: string | null): Promise<boolean> {
    if (!activeId) return false;
    try {
      const res = await fetch(`/api/organiser/boards/${activeId}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ name, group_id: groupId, parent_item_id: parentItemId }),
      });
      if (!res.ok) return false;
    } catch {
      return false;
    }
    await loadBoardData(activeId);
    return true;
  }
  // D.4.7C — applies `patch` optimistically to boardData ONLY. Before this
  // phase this also patched a separate `drawerItem` copy; now that the
  // open drawer's item is DERIVED from boardData.items (see openItem
  // below), patching boardData alone is sufficient — the open drawer
  // reflects it automatically, with no second write site to keep in sync.
  function applyOptimisticItemPatch(id: string, patch: Record<string, unknown>) {
    setBoardData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(i => {
          if (i.id !== id) return i;
          const merged = { ...i, ...patch } as OrganiserItem;
          if (patch.custom_values && typeof patch.custom_values === "object") {
            merged.custom_values = { ...i.custom_values, ...(patch.custom_values as Record<string, unknown>) };
          }
          return merged;
        }),
      };
    });
  }
  function restoreItemFields(id: string, snapshot: Record<string, unknown>) {
    setBoardData(prev => prev ? { ...prev, items: prev.items.map(i => i.id === id ? ({ ...i, ...snapshot } as OrganiserItem) : i) } : prev);
  }
  // Reads the CURRENT (pre-optimistic-patch) values of `keys` for item
  // `id` from boardData — the single source of truth now that the open
  // drawer no longer holds its own separate copy. Only ever called
  // synchronously at the very start of a fresh (non-coalesced) mutation
  // chain — see updateItem below — never from deep inside an async
  // continuation, so there's no risk of reading stale React state from an
  // old render's closure.
  function readCurrentItemFields(id: string, keys: string[]): Record<string, unknown> {
    const source = boardData?.items.find(i => i.id === id);
    const out: Record<string, unknown> = {};
    if (source) for (const k of keys) out[k] = (source as unknown as Record<string, unknown>)[k];
    return out;
  }

  // D.4.7B / D.4.7B-R1 — the mutation reliability + save-state foundation
  // every later inline-editing/autosave phase builds on.
  //
  // 1. Response handling: the PATCH's success/failure is actually
  //    inspected (res.ok) and a thrown network error is caught — a
  //    rejected write no longer leaves the optimistic state in place
  //    forever with zero indication anything was wrong.
  // 2. Field-scoped rollback: only the exact fields this call patched are
  //    snapshotted and restored on failure — never a whole-item or
  //    whole-board rollback, so an unrelated concurrent edit to a
  //    different field is never touched.
  // 3. Server-ordering (D.4.7B-R1): D.4.7B's original per-field sequence
  //    number (itemOpSeqRef) only decided which RESPONSE the client
  //    trusted — it could never stop two overlapping REQUESTS for the
  //    same item+field from being dispatched to the server back-to-back,
  //    so a network-delayed earlier request could still commit LAST and
  //    leave server truth diverged from what the client displayed (the
  //    PATCH route is an unconditional overwrite, not a compare-and-
  //    swap). enqueueCoalesced (lib/organiser/coalescingMutationQueue.ts)
  //    replaces that guard: at most one PATCH is ever in flight per
  //    `item:<id>:<fieldKey>` key. A same-field edit made while one is
  //    already in flight replaces the pending value (never queues more
  //    than one) and is only actually sent once the in-flight call has
  //    fully settled — so the server always receives writes for a given
  //    item+field in the client's intended order, never racing to commit
  //    last. `hasNewerPending()` lets each step know whether it's safe to
  //    finalize (rollback/markSaved/reload) or whether a newer value is
  //    already about to supersede it — see its own JSDoc.
  //
  // Deliberately NOT wired up here: any Notes-specific debounce or
  // visible Saving/Saved UI. Notes still calls this same function on
  // every keystroke (unchanged in this phase), so it already benefits
  // from the ordering guarantee above, but a failure on the LATEST
  // keystroke (nothing newer yet issued) will still roll the textarea
  // back to the last successfully-saved text — reverting only the
  // unsaved-since-last-success delta, never silently further than that.
  // D.4.7C closes this exposure window entirely by moving Notes to
  // blur/debounced saves; see that phase's own header for the intended
  // wiring (pass `item:<id>:notes` as the status key to Field once Notes
  // gets its own Field wrapper and visible save state).
  async function updateItem(id: string, patch: Record<string, unknown>) {
    const fieldKey = Object.keys(patch).sort().join(",");
    const statusKey = `item:${id}:${fieldKey}`;
    const patchKeys = Object.keys(patch);

    // Always apply optimistically and mark saving immediately, whether or
    // not a request for this exact item+field is already in flight — the
    // UI stays instant even while the actual network dispatch is queued
    // behind an earlier one.
    applyOptimisticItemPatch(id, patch);
    markSaving(statusKey);

    // Captured lazily, once, by the first (non-coalesced) attempt in this
    // chain — see below. Updated to the just-applied patch's own values
    // after each attempt that actually succeeds, so a LATER failure in
    // the same chain rolls back to the last genuinely server-confirmed
    // value, never further than that.
    let confirmedBase: Record<string, unknown> | null = null;

    await enqueueCoalesced(itemFieldQueueRef.current, statusKey, patch, async (value, hasNewerPending) => {
      if (confirmedBase === null) confirmedBase = readCurrentItemFields(id, patchKeys);

      let ok = false;
      try {
        const res = await fetch(`/api/organiser/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(value) });
        ok = res.ok;
      } catch {
        ok = false;
      }

      if (!ok) {
        if (!hasNewerPending()) {
          restoreItemFields(id, confirmedBase as Record<string, unknown>);
          markError(statusKey, "Couldn't save. Your previous value was restored.");
        }
        // else: a newer value is already queued to try next — don't roll
        // back yet (the optimistic UI already shows that newer value);
        // leave confirmedBase as-is since this attempt was never confirmed.
        return;
      }

      confirmedBase = { ...(confirmedBase as Record<string, unknown>), ...value };
      if (!hasNewerPending()) {
        markSaved(statusKey);
        if (activeId) loadBoardData(activeId);
      }
      // else: don't flash Saved — a newer value is already pending and
      // will be attempted next; only the LAST step's outcome is reported.
    });
  }
  async function deleteItem(id: string) {
    let ok = false;
    try {
      const res = await fetch(`/api/organiser/items/${id}`, { method: "DELETE", credentials: "include" });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      showPageNotice("Couldn't delete item. Try again.");
      return;
    }
    setOpenDrawerItemId(prev => prev === id ? null : prev);
    if (activeId) loadBoardData(activeId);
  }

  async function addColumn(name: string, type: ColumnType) {
    if (!activeId) return;
    await fetch(`/api/organiser/boards/${activeId}/columns`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name, type }) });
    await loadBoardData(activeId);
  }
  async function renameColumn(id: string, name: string) {
    await fetch(`/api/organiser/columns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
    if (activeId) loadBoardData(activeId);
  }
  async function saveColumnOptions(id: string, options: ColumnOption[]) {
    await fetch(`/api/organiser/columns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ options }) });
    if (activeId) loadBoardData(activeId);
  }
  async function deleteColumn(id: string) {
    if (!confirm("Delete this column? Values stored in it will be lost.")) return;
    await fetch(`/api/organiser/columns/${id}`, { method: "DELETE", credentials: "include" });
    if (activeId) loadBoardData(activeId);
  }

  async function handleImport(file: File, sheet?: string) {
    if (!activeId) return;
    setImporting(true); setImportMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    if (sheet) fd.append("sheet", sheet);
    try {
      const res = await fetch(`/api/organiser/boards/${activeId}/import`, { method: "POST", credentials: "include", body: fd });
      const d = await res.json();
      if (!res.ok) {
        setImportMsg(d.error || "Import failed.");
      } else if (d.needsSheetSelection) {
        setSheetChoices(d.sheets);
        setPendingImportFile(file);
        setImporting(false);
        return;
      } else {
        setImportMsg(`Imported ${d.itemsCreated} item${d.itemsCreated === 1 ? "" : "s"}, ${d.groupsCreated} new group${d.groupsCreated === 1 ? "" : "s"}, linked ${d.subitemsLinked} subitem${d.subitemsLinked === 1 ? "" : "s"}.${d.unmatchedSubitems?.length ? ` ${d.unmatchedSubitems.length} subitem parent(s) not found.` : ""}`);
      }
      setSheetChoices(null);
      setPendingImportFile(null);
      await loadBoards(activeId);
      await loadBoardData(activeId);
    } catch {
      setImportMsg("Import failed — check your connection and try again.");
    } finally {
      setImporting(false);
    }
  }

  const activeBoard = boards.find(b => b.id === activeId) ?? null;
  const columns = boardData?.columns ?? [];
  // D.4.7C — the single derivation point for "what item is the drawer
  // showing." Looked up fresh from boardData.items on every render, so
  // any boardData refresh (this client's own mutations today; a future
  // server-side/Helena change tomorrow) is reflected immediately without
  // a second, separately-maintained item copy that could drift stale.
  const openItem = boardData?.items.find(i => i.id === openDrawerItemId) ?? null;
  const openDrawerForItem = (item: OrganiserItem) => setOpenDrawerItemId(item.id);

  // Phase D.4.6D — publish the current board/item to Helena (via
  // useAppStore's organiserContext) whenever either changes, exactly
  // mirroring DashboardShell.tsx's own dashboardAiContext
  // set-on-change/clear-on-unmount pattern. IDs only, no names — the
  // server resolves and validates names itself (see
  // resolveHelenaOrganiserContext) — so switching board/opening-closing
  // the item drawer never needs to worry about a stale display name, only
  // a stale id, which a fresh server-side lookup on the very next message
  // makes harmless (a since-deleted/wrong-tenant id simply resolves to no
  // context, never an error). Clearing on unmount is what keeps this from
  // leaking into global /hlna or any other page — see useAppStore.js's own
  // comment on why this field is deliberately not persisted.
  useEffect(() => {
    useAppStore.getState().setOrganiserContext(
      activeBoard || openDrawerItemId ? { boardId: activeBoard?.id, itemId: openDrawerItemId ?? undefined } : null,
    );
    return () => useAppStore.getState().setOrganiserContext(null);
  }, [activeBoard?.id, openDrawerItemId]);

  return (
    <OrganiserShell
      rail={
        <OrganiserRail
          boards={boards} activeId={activeId}
          onSelect={setActiveId} onCreate={createBoard} onRename={renameBoard} onDelete={deleteBoard}
        />
      }
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes drawer-in { from{ transform: translateX(24px); opacity:.4 } to{ transform:none; opacity:1 } }
        @keyframes bb-save-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(1) opacity(.4); cursor: pointer; }
      ` }} />

      {loading ? (
            <div style={{ padding: 24, color: t.ink(.35), fontSize: 13 }}>Loading…</div>
          ) : !activeBoard ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", maxWidth: 340 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: t.ink(.90), marginBottom: 6 }}>Create your first board</div>
                <div style={{ fontSize: 12.5, color: t.ink(.42), marginBottom: 16, lineHeight: 1.6 }}>
                  Boards keep separate lists — TAFE, Work, Home — each with its own groups and items. Add one to get started.
                </div>
                <NewBoardInline onCreate={createBoard} />
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: `1px solid ${t.ink(.05)}`, flexShrink: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  <InlineText value={activeBoard.name} bold onSave={v => renameBoard(activeBoard.id, v)} />
                </div>

                <div style={{ display: "flex", gap: 2, background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 8, padding: 2, marginLeft: 8 }}>
                  {(["table", "board", "calendar", "activity"] as ViewMode[]).map(v => (
                    <button
                      key={v} onClick={() => setView(v)}
                      style={{
                        padding: "4px 11px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: FONT,
                        background: view === v ? "rgba(139,92,246,.24)" : "transparent",
                        border: "none", color: view === v ? "#C4B5FD" : t.ink(.42),
                        cursor: "pointer", textTransform: "capitalize",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                <div style={{ flex: 1 }} />
                {view === "table" && <button onClick={() => setAddingGroup(true)} style={btnStyle(false, t)}>+ New group</button>}
                <button onClick={() => fileInputRef.current?.click()} disabled={importing} style={btnStyle(true, t)}>
                  {importing ? "Importing…" : "Import CSV/XLSX"}
                </button>
                <input
                  ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ""; }}
                />
              </div>

              {importMsg && (
                <div style={{ margin: "10px 20px 0", padding: "8px 12px", borderRadius: 8, background: "rgba(99,102,241,.10)", border: "1px solid rgba(99,102,241,.24)", color: "#a5b4fc", fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1 }}>{importMsg}</span>
                  <button onClick={() => setImportMsg(null)} style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: 13 }}>×</button>
                </div>
              )}

              {/* D.4.7B — single-slot transient error notice for mutations
                  with no natural inline anchor (delete failures); see
                  showPageNotice's own comment. Same visual convention as
                  the import-message banner above, error-toned. */}
              {pageNotice && (
                <div style={{ margin: "10px 20px 0", padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,.10)", border: "1px solid rgba(239,68,68,.28)", color: "#f87171", fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1 }}>{pageNotice}</span>
                  <button onClick={() => setPageNotice(null)} style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: 13 }}>×</button>
                </div>
              )}

              {sheetChoices && pendingImportFile && (
                <SheetPicker
                  fileName={pendingImportFile.name}
                  sheets={sheetChoices}
                  importing={importing}
                  onPick={sheetName => handleImport(pendingImportFile, sheetName)}
                  onCancel={() => { setSheetChoices(null); setPendingImportFile(null); }}
                />
              )}

              {view === "table" && (
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 60px" }}>
                  {boardData?.groups.map(g => (
                    <div
                      key={g.id}
                      onDragOver={e => { if (draggingGroupId) e.preventDefault(); }}
                      onDrop={e => { e.preventDefault(); handleGroupDrop(g.id); }}
                    >
                      <GroupSection
                        group={g} items={boardData.items} columns={columns}
                        onUpdateItem={updateItem} onDeleteItem={deleteItem} onAddItem={addItem}
                        onOpenDrawer={openDrawerForItem} onRenameGroup={renameGroup} onDeleteGroup={deleteGroup}
                        onAddColumn={addColumn} onRenameColumn={renameColumn} onDeleteColumn={deleteColumn} onEditColumnOptions={setEditingColumn}
                        saveStatus={saveStatus}
                        onGroupDragHandleStart={() => setDraggingGroupId(g.id)}
                      />
                    </div>
                  ))}
                  {boardData && boardData.items.some(i => !i.group_id) && (
                    <GroupSection
                      group={null} items={boardData.items} columns={columns}
                      onUpdateItem={updateItem} onDeleteItem={deleteItem} onAddItem={addItem}
                      onOpenDrawer={openDrawerForItem} onRenameGroup={renameGroup} onDeleteGroup={deleteGroup}
                      onAddColumn={addColumn} onRenameColumn={renameColumn} onDeleteColumn={deleteColumn} onEditColumnOptions={setEditingColumn}
                      saveStatus={saveStatus}
                    />
                  )}

                  {addingGroup && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <input
                        ref={groupNameInputRef}
                        autoFocus value={groupName} disabled={groupSubmitting}
                        onChange={e => { setGroupName(e.target.value); if (groupError) setGroupError(null); }}
                        placeholder="Group name…"
                        onKeyDown={e => { if (e.key === "Enter") submitNewGroup(); if (e.key === "Escape") { setGroupName(""); setGroupError(null); setAddingGroup(false); } }}
                        style={{ fontSize: 12.5, fontFamily: FONT, background: t.ink(.05), border: "1px solid rgba(139,92,246,.4)", borderRadius: 8, padding: "7px 10px", color: t.ink(.94), outline: "none", flex: 1, maxWidth: 260 }}
                      />
                      <button onClick={submitNewGroup} disabled={groupSubmitting} style={btnStyle(true, t)}>{groupSubmitting ? "Adding…" : "Add"}</button>
                      <button onClick={() => { setGroupName(""); setGroupError(null); setAddingGroup(false); }} style={btnStyle(false, t)}>Cancel</button>
                      {groupError && <span style={{ fontSize: 10.5, color: "#EF4444" }}>{groupError}</span>}
                    </div>
                  )}

                  {boardData && boardData.groups.length === 0 && !boardData.items.length && !addingGroup && (
                    <div style={{ color: t.ink(.30), fontSize: 12.5, padding: "20px 4px" }}>
                      No groups yet. Add a group, or import a CSV to populate this board.
                    </div>
                  )}
                </div>
              )}

              {view === "board" && boardData && (
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <KanbanView items={boardData.items} onOpenDrawer={openDrawerForItem} onUpdateItem={updateItem} />
                </div>
              )}

              {view === "calendar" && boardData && (
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <CalendarView items={boardData.items} onOpenDrawer={openDrawerForItem} />
                </div>
              )}

              {view === "activity" && boardData && (
                <BoardActivity
                  key={`${activeBoard.id}:${boardActivityRefreshKey}`}
                  boardId={activeBoard.id}
                  items={boardData.items}
                  groupNamesById={groupNamesById}
                  userNamesById={userNamesById}
                  onOpenItem={openDrawerForItem}
                  refreshKey={boardActivityRefreshKey}
                />
              )}
            </>
          )}

      {openItem && (
        <ItemDrawer item={openItem} onClose={() => setOpenDrawerItemId(null)} onUpdate={updateItem} groupNamesById={groupNamesById} members={members} saveStatus={saveStatus} />
      )}
      {editingColumn && (
        <ColumnOptionsEditor
          column={editingColumn}
          onSave={opts => saveColumnOptions(editingColumn.id, opts)}
          onClose={() => setEditingColumn(null)}
        />
      )}
    </OrganiserShell>
  );
}

export default function OrganiserPage() {
  return (
    <Suspense fallback={null}>
      <OrganiserPageContent />
    </Suspense>
  );
}

function SheetPicker({
  fileName, sheets, importing, onPick, onCancel,
}: {
  fileName: string; sheets: SheetChoice[]; importing: boolean;
  onPick: (sheetName: string) => void; onCancel: () => void;
}) {
  const t = useOpsTheme();
  // Recommend the data-shaped sheet with the most rows (e.g. a "STUDY_MASTER"
  // superset over a narrower "ASSESSMENTS" sheet), falling back to the first sheet.
  const dataSheets = sheets.filter(s => s.looksLikeData);
  const recommended = (dataSheets.length ? dataSheets : sheets).reduce((best, s) => (s.rowCount > (best?.rowCount ?? -1) ? s : best), dataSheets[0] ?? sheets[0]);

  return (
    <div style={{ margin: "10px 20px 0", padding: "14px 16px", borderRadius: 10, background: "rgba(139,92,246,.06)", border: "1px solid rgba(139,92,246,.24)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: t.ink(.90), marginBottom: 3 }}>“{fileName}” has {sheets.length} sheets — which one has your items?</div>
      <div style={{ fontSize: 11, color: t.ink(.40), marginBottom: 10 }}>Sheets without an “Item Name” column are probably instructions, dashboards, or lookup lists, not task data.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {sheets.map(s => (
          <button
            key={s.name}
            disabled={importing}
            onClick={() => onPick(s.name)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, textAlign: "left",
              background: s.name === recommended?.name ? "rgba(139,92,246,.14)" : t.ink(.03),
              border: `1px solid ${s.name === recommended?.name ? "rgba(139,92,246,.4)" : t.ink(.08)}`,
              cursor: importing ? "default" : "pointer", fontFamily: FONT,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: s.looksLikeData ? t.ink(.90) : t.ink(.40), flex: 1 }}>{s.name}</span>
            {s.name === recommended?.name && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", color: "#C4B5FD", textTransform: "uppercase" }}>Recommended</span>}
            <span style={{ fontSize: 10.5, color: t.ink(.30) }}>{s.rowCount} row{s.rowCount === 1 ? "" : "s"}</span>
          </button>
        ))}
      </div>
      <button onClick={onCancel} disabled={importing} style={btnStyle(false, t)}>Cancel</button>
    </div>
  );
}

function NewBoardInline({ onCreate }: { onCreate: (name: string) => void }) {
  const t = useOpsTheme();
  const [name, setName] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
      <input
        autoFocus value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && name.trim()) onCreate(name.trim()); }}
        placeholder="e.g. TAFE"
        style={{ fontSize: 13, fontFamily: FONT, background: t.ink(.05), border: "1px solid rgba(139,92,246,.4)", borderRadius: 8, padding: "8px 12px", color: t.ink(.94), outline: "none", width: 180 }}
      />
      <button onClick={() => { if (name.trim()) onCreate(name.trim()); }} style={btnStyle(true, t)}>Create</button>
    </div>
  );
}

function btnStyle(primary: boolean, t: ReturnType<typeof useOpsTheme>): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, fontFamily: FONT,
    background: primary ? (t.isDark ? "rgba(139,92,246,.22)" : "rgba(124,58,237,.14)") : t.ink(.05),
    border: `1px solid ${primary ? (t.isDark ? "rgba(139,92,246,.4)" : "rgba(124,58,237,.35)") : t.ink(.10)}`,
    color: primary ? t.accentText : t.ink(.65),
    cursor: "pointer", whiteSpace: "nowrap",
  };
}
