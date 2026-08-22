"use client";

import React, { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import WorkspaceShell from "@/components/ops/WorkspaceShell";
import { useOpsTheme } from "@/components/ops/theme";

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
  position: number; created_at: string; updated_at: string;
};

type OrganiserFile = { id: string; file_name: string; file_url: string; file_size: number | null; created_at: string };
type OrganiserUpdate = { id: string; author_name: string | null; body: string; created_at: string };

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

function InlineText({
  value, placeholder, onSave, bold,
}: {
  value: string; placeholder?: string; onSave: (v: string) => void; bold?: boolean;
}) {
  const t = useOpsTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        title="Click to edit"
        style={{
          cursor: "text", fontWeight: bold ? 600 : 400,
          color: value ? t.ink(.90) : t.ink(.28),
          fontSize: bold ? 13 : 12, lineHeight: 1.4,
        }}
      >
        {value || placeholder || "—"}
      </span>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== value) onSave(draft); }}
      onKeyDown={e => {
        if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
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

function AddItemRow({ onAdd, indent }: { onAdd: (name: string) => void; indent?: boolean }) {
  const t = useOpsTheme();
  const [value, setValue] = useState("");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", paddingLeft: indent ? 44 : 12 }}>
      <span style={{ color: "rgba(139,92,246,.6)", fontSize: 14, lineHeight: 1 }}>+</span>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && value.trim()) { onAdd(value.trim()); setValue(""); }
        }}
        placeholder={indent ? "Add subitem…" : "Add item…"}
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          fontSize: 12, color: t.ink(.90), fontFamily: FONT,
        }}
      />
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
  item, depth, columns, onUpdate, onDelete, onOpenDrawer, hasChildren, collapsed, onToggleCollapse,
}: {
  item: OrganiserItem; depth: number; columns: OrganiserColumn[];
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onOpenDrawer: (item: OrganiserItem) => void;
  hasChildren: boolean; collapsed: boolean; onToggleCollapse: () => void;
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
        <span
          onClick={() => onOpenDrawer(item)}
          title="Open details"
          style={{ cursor: "pointer", fontSize: depth === 0 ? 12.5 : 12, fontWeight: depth === 0 ? 600 : 400, color: t.ink(.90), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {item.name}
        </span>
      </div>

      <PillSelect value={item.status} options={STATUS_OPTIONS} colorFor={statusColor} onChange={v => onUpdate(item.id, { status: v })} />
      <PillSelect value={item.priority ?? ""} options={PRIORITY_OPTIONS} colorFor={priorityColor} onChange={v => onUpdate(item.id, { priority: v })} placeholder="Priority" />

      <input
        type="date"
        value={item.due_date ?? ""}
        onChange={e => onUpdate(item.id, { due_date: e.target.value || null })}
        style={{
          background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6,
          padding: "3px 6px", fontSize: 11, color: item.due_date ? t.ink(.90) : t.ink(.30), fontFamily: FONT, colorScheme: "dark",
        }}
      />

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
  onAddColumn, onRenameColumn, onDeleteColumn, onEditColumnOptions,
}: {
  group: OrganiserGroup | null; items: OrganiserItem[]; columns: OrganiserColumn[];
  onUpdateItem: (id: string, patch: Record<string, unknown>) => void;
  onDeleteItem: (id: string) => void;
  onAddItem: (name: string, groupId: string | null, parentItemId: string | null) => void;
  onOpenDrawer: (item: OrganiserItem) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onAddColumn: (name: string, type: ColumnType) => void;
  onRenameColumn: (id: string, name: string) => void;
  onDeleteColumn: (id: string) => void;
  onEditColumnOptions: (column: OrganiserColumn) => void;
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
        <button onClick={() => setOpen(o => !o)} style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", color, transform: open ? "none" : "rotate(-90deg)", transition: "transform .12s" }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {group ? (
            <InlineText value={group.name} bold onSave={v => onRenameGroup(group.id, v)} />
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
                />
                {!collapsed && kids.map(child => (
                  <ItemRow
                    key={child.id} item={child} depth={1} columns={columns}
                    onUpdate={onUpdateItem} onDelete={onDeleteItem} onOpenDrawer={onOpenDrawer}
                    hasChildren={false} collapsed={false} onToggleCollapse={() => {}}
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

// ── ITEM DETAIL DRAWER ──────────────────────────────────────────────────────

function ItemDrawer({ item, onClose, onUpdate }: { item: OrganiserItem; onClose: () => void; onUpdate: (id: string, patch: Record<string, unknown>) => void }) {
  const t = useOpsTheme();
  const fieldEntries = Object.entries(item.fields || {});
  const [files, setFiles] = useState<OrganiserFile[]>([]);
  const [updates, setUpdates] = useState<OrganiserUpdate[]>([]);
  const [newUpdate, setNewUpdate] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/organiser/items/${item.id}/files`, { credentials: "include" }).then(r => r.ok ? r.json() : { files: [] }).then(d => setFiles(d.files ?? [])).catch(() => {});
    fetch(`/api/organiser/items/${item.id}/updates`, { credentials: "include" }).then(r => r.ok ? r.json() : { updates: [] }).then(d => setUpdates(d.updates ?? [])).catch(() => {});
  }, [item.id]);

  async function uploadFile(file: File) {
    setUploadingFile(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/organiser/items/${item.id}/files`, { method: "POST", credentials: "include", body: fd });
      const d = await res.json();
      if (d.file) setFiles(prev => [d.file, ...prev]);
    } finally {
      setUploadingFile(false);
    }
  }
  async function deleteFile(fileId: string) {
    await fetch(`/api/organiser/items/${item.id}/files/${fileId}`, { method: "DELETE", credentials: "include" });
    setFiles(prev => prev.filter(f => f.id !== fileId));
  }
  async function addUpdate() {
    const body = newUpdate.trim();
    if (!body) return;
    const res = await fetch(`/api/organiser/items/${item.id}/updates`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ body }) });
    const d = await res.json();
    if (d.update) setUpdates(prev => [d.update, ...prev]);
    setNewUpdate("");
  }

  return (
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
            <InlineText value={item.name} bold onSave={v => onUpdate(item.id, { name: v })} />
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 7, background: t.ink(.05), border: `1px solid ${t.ink(.08)}`, color: t.ink(.5), cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Field label="Status"><PillSelect value={item.status} options={STATUS_OPTIONS} colorFor={statusColor} onChange={v => onUpdate(item.id, { status: v })} /></Field>
            <Field label="Priority"><PillSelect value={item.priority ?? ""} options={PRIORITY_OPTIONS} colorFor={priorityColor} onChange={v => onUpdate(item.id, { priority: v })} placeholder="None" /></Field>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Field label="Due date">
              <input type="date" value={item.due_date ?? ""} onChange={e => onUpdate(item.id, { due_date: e.target.value || null })}
                style={{ background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, color: t.ink(.90), fontFamily: FONT, colorScheme: "dark" }} />
            </Field>
            <Field label="Owner">
              <input value={item.owner ?? ""} onChange={e => onUpdate(item.id, { owner: e.target.value })}
                placeholder="Unassigned"
                style={{ background: t.ink(.04), border: `1px solid ${t.ink(.08)}`, borderRadius: 6, padding: "5px 8px", fontSize: 12, color: t.ink(.90), fontFamily: FONT, width: 140 }} />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={item.notes ?? ""}
              onChange={e => onUpdate(item.id, { notes: e.target.value })}
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
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useOpsTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", color: t.ink(.30), textTransform: "uppercase" }}>{label}</span>
      {children}
    </div>
  );
}

// ── BOARD RAIL ───────────────────────────────────────────────────────────────

function BoardRail({
  boards, activeId, onSelect, onCreate, onRename, onDelete,
}: {
  boards: OrganiserBoard[]; activeId: string | null;
  onSelect: (id: string) => void; onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void; onDelete: (id: string) => void;
}) {
  const t = useOpsTheme();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  return (
    <div style={{ width: 208, flexShrink: 0, borderRight: `1px solid ${t.ink(.055)}`, display: "flex", flexDirection: "column", padding: "14px 10px", overflowY: "auto" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: t.ink(.24), textTransform: "uppercase", padding: "0 6px", marginBottom: 8 }}>
        Boards
      </div>
      {boards.map(b => (
        <div
          key={b.id}
          onClick={() => onSelect(b.id)}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", borderRadius: 8,
            cursor: "pointer", marginBottom: 2,
            background: activeId === b.id ? "rgba(139,92,246,.14)" : "transparent",
            color: activeId === b.id ? t.accentText : t.ink(.65),
            position: "relative",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: b.color || "#8B5CF6", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: activeId === b.id ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
          <span style={{ fontSize: 10, color: t.ink(.22) }}>{b.item_count ?? 0}</span>
          <button
            onClick={e => { e.stopPropagation(); setMenuFor(menuFor === b.id ? null : b.id); }}
            style={{ width: 16, height: 16, background: "transparent", border: "none", color: t.ink(.28), cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
          </button>
          {menuFor === b.id && (
            <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "100%", right: 4, zIndex: 20, background: t.menuBg, border: `1px solid ${t.ink(.1)}`, borderRadius: 8, padding: 4, minWidth: 120, boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
              <button onClick={() => { const n = prompt("Rename board", b.name); if (n?.trim()) onRename(b.id, n.trim()); setMenuFor(null); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 11.5, background: "transparent", border: "none", color: t.ink(.8), cursor: "pointer", borderRadius: 5 }}>
                Rename
              </button>
              <button onClick={() => { if (confirm(`Delete board "${b.name}"? This deletes all its groups and items.`)) onDelete(b.id); setMenuFor(null); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 11.5, background: "transparent", border: "none", color: "#EF4444", cursor: "pointer", borderRadius: 5 }}>
                Delete
              </button>
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim()) onCreate(name.trim()); setName(""); setAdding(false); }}
          onKeyDown={e => {
            if (e.key === "Enter" && name.trim()) { onCreate(name.trim()); setName(""); setAdding(false); }
            if (e.key === "Escape") { setName(""); setAdding(false); }
          }}
          placeholder="Board name…"
          style={{ marginTop: 4, fontSize: 12.5, fontFamily: FONT, background: t.ink(.05), border: "1px solid rgba(139,92,246,.4)", borderRadius: 8, padding: "7px 9px", color: t.ink(.94), outline: "none" }}
        />
      ) : (
        <button onClick={() => setAdding(true)} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, padding: "7px 8px", borderRadius: 8, background: "transparent", border: `1px dashed ${t.ink(.14)}`, color: t.ink(.40), cursor: "pointer", fontSize: 12, fontFamily: FONT }}>
          <span>+</span> New board
        </button>
      )}
    </div>
  );
}

// ── PAGE ─────────────────────────────────────────────────────────────────────

type ViewMode = "table" | "board" | "calendar";

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
  const [drawerItem, setDrawerItem] = useState<OrganiserItem | null>(null);
  const [editingColumn, setEditingColumn] = useState<OrganiserColumn | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [sheetChoices, setSheetChoices] = useState<SheetChoice[] | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const res = await fetch(`/api/organiser/boards/${boardId}`, { credentials: "include" });
    if (!res.ok) { setBoardData(null); return; }
    const d = await res.json();
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

  async function createGroup(name: string) {
    if (!activeId) return;
    await fetch(`/api/organiser/boards/${activeId}/groups`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
    await loadBoardData(activeId);
  }
  async function renameGroup(id: string, name: string) {
    await fetch(`/api/organiser/groups/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name }) });
    if (activeId) loadBoardData(activeId);
  }
  async function deleteGroup(id: string) {
    if (!confirm("Delete this group? Its items will move to “No group”.")) return;
    await fetch(`/api/organiser/groups/${id}`, { method: "DELETE", credentials: "include" });
    if (activeId) loadBoardData(activeId);
  }

  async function addItem(name: string, groupId: string | null, parentItemId: string | null) {
    if (!activeId) return;
    await fetch(`/api/organiser/boards/${activeId}/items`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ name, group_id: groupId, parent_item_id: parentItemId }),
    });
    await loadBoardData(activeId);
  }
  async function updateItem(id: string, patch: Record<string, unknown>) {
    // Optimistic local update so pills/dates/cells feel instant.
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
    setDrawerItem(prev => {
      if (!prev || prev.id !== id) return prev;
      const merged = { ...prev, ...patch } as OrganiserItem;
      if (patch.custom_values && typeof patch.custom_values === "object") {
        merged.custom_values = { ...prev.custom_values, ...(patch.custom_values as Record<string, unknown>) };
      }
      return merged;
    });
    await fetch(`/api/organiser/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(patch) });
    if (activeId) loadBoardData(activeId);
  }
  async function deleteItem(id: string) {
    await fetch(`/api/organiser/items/${id}`, { method: "DELETE", credentials: "include" });
    setDrawerItem(prev => prev && prev.id === id ? null : prev);
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

  return (
    <WorkspaceShell title="Organiser">
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes drawer-in { from{ transform: translateX(24px); opacity:.4 } to{ transform:none; opacity:1 } }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(1) opacity(.4); cursor: pointer; }
      ` }} />

      <div style={{ display: "flex", height: "100%", fontFamily: FONT }}>
        <BoardRail
          boards={boards} activeId={activeId}
          onSelect={setActiveId} onCreate={createBoard} onRename={renameBoard} onDelete={deleteBoard}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
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
                  {(["table", "board", "calendar"] as ViewMode[]).map(v => (
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
                    <GroupSection
                      key={g.id} group={g} items={boardData.items} columns={columns}
                      onUpdateItem={updateItem} onDeleteItem={deleteItem} onAddItem={addItem}
                      onOpenDrawer={setDrawerItem} onRenameGroup={renameGroup} onDeleteGroup={deleteGroup}
                      onAddColumn={addColumn} onRenameColumn={renameColumn} onDeleteColumn={deleteColumn} onEditColumnOptions={setEditingColumn}
                    />
                  ))}
                  {boardData && boardData.items.some(i => !i.group_id) && (
                    <GroupSection
                      group={null} items={boardData.items} columns={columns}
                      onUpdateItem={updateItem} onDeleteItem={deleteItem} onAddItem={addItem}
                      onOpenDrawer={setDrawerItem} onRenameGroup={renameGroup} onDeleteGroup={deleteGroup}
                      onAddColumn={addColumn} onRenameColumn={renameColumn} onDeleteColumn={deleteColumn} onEditColumnOptions={setEditingColumn}
                    />
                  )}

                  {addingGroup && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      <input
                        autoFocus value={groupName} onChange={e => setGroupName(e.target.value)}
                        placeholder="Group name…"
                        onKeyDown={e => { if (e.key === "Enter" && groupName.trim()) { createGroup(groupName.trim()); setGroupName(""); setAddingGroup(false); } if (e.key === "Escape") { setGroupName(""); setAddingGroup(false); } }}
                        style={{ fontSize: 12.5, fontFamily: FONT, background: t.ink(.05), border: "1px solid rgba(139,92,246,.4)", borderRadius: 8, padding: "7px 10px", color: t.ink(.94), outline: "none", flex: 1, maxWidth: 260 }}
                      />
                      <button onClick={() => { if (groupName.trim()) createGroup(groupName.trim()); setGroupName(""); setAddingGroup(false); }} style={btnStyle(true, t)}>Add</button>
                      <button onClick={() => { setGroupName(""); setAddingGroup(false); }} style={btnStyle(false, t)}>Cancel</button>
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
                  <KanbanView items={boardData.items} onOpenDrawer={setDrawerItem} onUpdateItem={updateItem} />
                </div>
              )}

              {view === "calendar" && boardData && (
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <CalendarView items={boardData.items} onOpenDrawer={setDrawerItem} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {drawerItem && <ItemDrawer item={drawerItem} onClose={() => setDrawerItem(null)} onUpdate={updateItem} />}
      {editingColumn && (
        <ColumnOptionsEditor
          column={editingColumn}
          onSave={opts => saveColumnOptions(editingColumn.id, opts)}
          onClose={() => setEditingColumn(null)}
        />
      )}
    </WorkspaceShell>
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
