"use client";

// Data Hub 6.1C — Source configuration admin surface.
//
// Manages the existing SourceSystem -> SourceMapping -> MappingVersion
// lifecycle through the EXISTING six API routes only (no new backend
// endpoint, no second mapping system). Reuses the platform's own generic
// canonical-target vocabulary (ILLEGAL_DUMPING_KNOWN_HEADERS/
// REQUIRED_HEADERS, imported directly below — both files are pure,
// dependency-free constants with no `server-only`/DB import, safe to ship
// to the browser) rather than re-declaring it here.
//
// PERMISSIONS: `isAdmin` is a plain boolean computed server-side (page.tsx)
// from the session's own role — this component never imports lib/org.ts or
// lib/session.ts (both carry `server-only`/DB-adjacent imports that must
// never reach the client bundle). Mutating controls are disabled (not
// hidden) for a non-admin viewer, but this is UX only — every mutating
// call still goes through the existing, unchanged, independently
// admin-gated API route, and every mutation handler below treats a 403
// response as a normal, displayed error state, never a crash, so a
// bypassed/forged request is handled correctly either way.
//
// No new preview/test engine: Section 7 of the authorizing spec forbids
// a second dry-run mechanism. A configured mapping can only actually be
// exercised by uploading a real worksheet through the existing Data Hub
// import flow and using its own Preview step — this UI says so explicitly
// rather than implying a mapping has been validated against real data.

import { useCallback, useEffect, useReducer, useState } from "react";
import Link from "next/link";
import {
  listSourceSystemsAdmin,
  createSourceSystem,
  updateSourceSystem,
  listSourceMappingsAdmin,
  createSourceMapping,
  updateSourceMapping,
  listMappingVersions,
  createMappingVersion,
  activateMappingVersion,
} from "@/lib/data-hub/client/orchestrator";
import type {
  SourceSystemAdminDTO,
  SourceMappingAdminDTO,
  MappingVersionAdminDTO,
  TransportResult,
} from "@/lib/data-hub/client/types";
import {
  CANONICAL_TARGET_FIELDS,
  MAX_SOURCE_HEADER_LENGTH,
} from "@/lib/data-hub/sourceMapping/mappingDocument";
import { ILLEGAL_DUMPING_REQUIRED_HEADERS } from "@/lib/data-hub/importBatch/illegalDumpingMapper";
import { validateMappingRows, buildMappingDocumentFields, type MappingFieldRow } from "./mappingRowValidation";

// ---------------------------------------------------------------------------
// Shared style constants — matches the existing dark-theme, inline-style
// convention already used throughout this repo (e.g.
// app/settings/branding/BrandingSettingsClient.tsx, app/data-hub/import's
// own _components) rather than introducing a new component library.
// ---------------------------------------------------------------------------

const CARD = "#0e1014";
const BORDER = "#1a1d24";
const TEXT_PRIMARY = "#f9fafb";
const TEXT_MUTED = "#6b7280";
const TEXT_SECONDARY = "#9ca3af";
const ACCENT = "#8a4dff";
const RED = "#f87171";
const GREEN = "#4ade80";

const panelStyle: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 20,
  marginBottom: 20,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  background: "#111318",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  color: TEXT_PRIMARY,
  fontSize: 13,
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".03em",
  textTransform: "uppercase",
  color: TEXT_MUTED,
  marginBottom: 6,
};

function buttonStyle(kind: "primary" | "secondary" | "danger", disabled: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "7px 14px",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    border: "1px solid transparent",
  };
  if (kind === "primary") return { ...base, background: ACCENT, color: "#fff" };
  if (kind === "danger") return { ...base, background: "transparent", color: RED, border: `1px solid ${RED}` };
  return { ...base, background: "transparent", color: TEXT_SECONDARY, border: `1px solid ${BORDER}` };
}

function humanize(canonicalTarget: string): string {
  return canonicalTarget.replace(/_/g, " ");
}

/** Every mutating/list call returns a TransportResult<{X}|{error}> — this
 * extracts a displayable error message for every non-success case
 * (network failure, malformed body, or a well-formed {error} body from any
 * HTTP status including 403), never throwing and never silently ignoring
 * a failure. */
function describeError(result: TransportResult<unknown>): string {
  if (result.kind === "networkUncertain") return result.message;
  if (result.kind === "malformed") return "The server returned an unexpected response.";
  const body = result.body as { error?: string };
  return body?.error ?? `Request failed (HTTP ${result.httpStatus}).`;
}

function isSuccessBody<T extends object, K extends string>(body: unknown, key: K): body is T {
  return typeof body === "object" && body !== null && key in body;
}

// ---------------------------------------------------------------------------
// Small shared UI primitives
// ---------------------------------------------------------------------------

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{ background: "rgba(248,113,113,.08)", border: `1px solid ${RED}`, borderRadius: 8, padding: "10px 12px", color: RED, fontSize: 12.5, marginBottom: 12 }} role="alert">
      {message}
    </div>
  );
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div style={{ background: "rgba(74,222,128,.08)", border: `1px solid ${GREEN}`, borderRadius: 8, padding: "10px 12px", color: GREEN, fontSize: 12.5, marginBottom: 12 }}>
      {message}
    </div>
  );
}

function Badge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: ".03em",
        textTransform: "uppercase",
        padding: "2px 8px",
        borderRadius: 999,
        color: active ? GREEN : TEXT_MUTED,
        border: `1px solid ${active ? GREEN : BORDER}`,
      }}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

/** Two-step inline confirmation for activate/deactivate — this codebase has
 * no modal precedent anywhere (Data Hub's own ConfirmAction.tsx uses a
 * direct button + consequence text, never a modal); mirrors that exactly. */
function ActivationToggle({
  active,
  disabled,
  busy,
  onToggle,
  activateLabel = "Activate",
  deactivateLabel = "Deactivate",
}: {
  active: boolean;
  disabled: boolean;
  busy: boolean;
  onToggle: () => void;
  activateLabel?: string;
  deactivateLabel?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (active && confirming) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: TEXT_SECONDARY }}>Deactivate this? Existing history is preserved.</span>
        <button type="button" style={buttonStyle("danger", busy)} disabled={busy} onClick={() => { setConfirming(false); onToggle(); }}>
          Confirm
        </button>
        <button type="button" style={buttonStyle("secondary", false)} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      style={buttonStyle(active ? "danger" : "primary", disabled || busy)}
      disabled={disabled || busy}
      title={disabled ? "Requires admin" : undefined}
      onClick={() => (active ? setConfirming(true) : onToggle())}
    >
      {busy ? "Working..." : active ? deactivateLabel : activateLabel}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared list-load state — useReducer, not useState, mirroring
// app/data-hub/import/useSourceSystems.ts's own established convention
// exactly: a reducer's dispatch is exempt from this repo's ESLint
// react-hooks/set-state-in-effect rule the way a raw useState setter is
// not, since calling `load()` from a useEffect body needs to update state
// synchronously on mount for a first fetch.
// ---------------------------------------------------------------------------

type ListState<T> = { status: "loading" } | { status: "success"; items: T[] } | { status: "error"; message: string };
type ListAction<T> = { type: "LOAD_START" } | { type: "LOAD_SUCCESS"; items: T[] } | { type: "LOAD_FAILURE"; message: string };

function listReducer<T>(_state: ListState<T>, action: ListAction<T>): ListState<T> {
  switch (action.type) {
    case "LOAD_START":
      return { status: "loading" };
    case "LOAD_SUCCESS":
      return { status: "success", items: action.items };
    case "LOAD_FAILURE":
      return { status: "error", message: action.message };
    default:
      return _state;
  }
}

function useListState<T>() {
  return useReducer(listReducer<T>, { status: "loading" } as ListState<T>);
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

export default function SourcesAdminClient({ isAdmin }: { isAdmin: boolean }) {
  const [selectedSourceSystem, setSelectedSourceSystem] = useState<SourceSystemAdminDTO | null>(null);
  const [selectedMapping, setSelectedMapping] = useState<SourceMappingAdminDTO | null>(null);

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "32px 20px", color: TEXT_PRIMARY, fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Data Hub source configuration</h1>
      <p style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 24 }}>
        Configure the source systems and column mappings governed imports use — for example, mapping the City of
        Onkaparinga export&apos;s <code>Ticket #</code> column to the platform&apos;s generic{" "}
        <code>source_external_id</code> identity field. This does not import any data itself.
      </p>
      {!isAdmin && (
        <div style={{ background: "rgba(249,250,251,.05)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: TEXT_SECONDARY, marginBottom: 20 }}>
          You can view existing source configuration, but creating, editing, or activating anything here requires the
          <strong> admin</strong> role.
        </div>
      )}

      <SourceSystemsSection
        isAdmin={isAdmin}
        selected={selectedSourceSystem}
        onSelect={(s) => {
          setSelectedSourceSystem(s);
          setSelectedMapping(null);
        }}
      />

      {selectedSourceSystem && (
        <SourceMappingsSection
          isAdmin={isAdmin}
          sourceSystem={selectedSourceSystem}
          selected={selectedMapping}
          onSelect={setSelectedMapping}
        />
      )}

      {selectedSourceSystem && selectedMapping && (
        <MappingVersionsSection isAdmin={isAdmin} sourceSystem={selectedSourceSystem} mapping={selectedMapping} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. SOURCE SYSTEMS
// ---------------------------------------------------------------------------

function SourceSystemsSection({
  isAdmin,
  selected,
  onSelect,
}: {
  isAdmin: boolean;
  selected: SourceSystemAdminDTO | null;
  onSelect: (s: SourceSystemAdminDTO) => void;
}) {
  const [state, dispatch] = useListState<SourceSystemAdminDTO>();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const load = useCallback(() => {
    dispatch({ type: "LOAD_START" });
    void listSourceSystemsAdmin({ active: "all", limit: 100 }).then((result) => {
      if (result.kind === "response" && isSuccessBody<{ sourceSystems: SourceSystemAdminDTO[] }, "sourceSystems">(result.body, "sourceSystems")) {
        dispatch({ type: "LOAD_SUCCESS", items: result.body.sourceSystems });
      } else {
        dispatch({ type: "LOAD_FAILURE", message: describeError(result) });
      }
    });
  }, [dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFormError("Name is required.");
      return;
    }
    setCreating(true);
    const result = await createSourceSystem({ name: trimmed, description: description.trim() || null });
    setCreating(false);
    if (result.kind === "response" && isSuccessBody<{ sourceSystem: SourceSystemAdminDTO }, "sourceSystem">(result.body, "sourceSystem")) {
      setName("");
      setDescription("");
      setShowCreate(false);
      load();
    } else {
      setFormError(describeError(result));
    }
  }

  async function handleSaveEdit(id: string) {
    setFormError(null);
    const trimmed = editName.trim();
    if (trimmed.length === 0) {
      setFormError("Name is required.");
      return;
    }
    setBusyId(id);
    const result = await updateSourceSystem(id, { name: trimmed, description: editDescription.trim() || null });
    setBusyId(null);
    if (result.kind === "response" && isSuccessBody<{ sourceSystem: SourceSystemAdminDTO }, "sourceSystem">(result.body, "sourceSystem")) {
      setEditingId(null);
      load();
    } else {
      setFormError(describeError(result));
    }
  }

  async function handleToggleActive(s: SourceSystemAdminDTO) {
    setBusyId(s.id);
    const result = await updateSourceSystem(s.id, { active: !s.active });
    setBusyId(null);
    if (result.kind === "response" && isSuccessBody<{ sourceSystem: SourceSystemAdminDTO }, "sourceSystem">(result.body, "sourceSystem")) {
      load();
    } else {
      dispatch({ type: "LOAD_FAILURE", message: describeError(result) });
    }
  }

  return (
    <section style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Source systems</h2>
        <button
          type="button"
          style={buttonStyle("primary", !isAdmin)}
          disabled={!isAdmin}
          title={!isAdmin ? "Requires admin" : undefined}
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Cancel" : "New source system"}
        </button>
      </div>

      {showCreate && (
        <div style={{ marginBottom: 16, padding: 14, border: `1px solid ${BORDER}`, borderRadius: 8 }}>
          {formError && <ErrorBanner message={formError} />}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle} htmlFor="new-source-system-name">Name</label>
            <input id="new-source-system-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. City of Onkaparinga operational export" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle} htmlFor="new-source-system-description">Description (optional)</label>
            <input id="new-source-system-description" style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button type="button" style={buttonStyle("primary", creating)} disabled={creating} onClick={handleCreate}>
            {creating ? "Creating..." : "Create source system"}
          </button>
        </div>
      )}

      {state.status === "loading" && <p style={{ fontSize: 13, color: TEXT_SECONDARY }}>Loading source systems...</p>}
      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && state.items.length === 0 && (
        <p style={{ fontSize: 13, color: TEXT_SECONDARY }}>
          No source systems configured yet. {isAdmin ? "Create one to get started." : "An admin needs to create one before imports can be governed by source."}
        </p>
      )}
      {state.status === "success" && state.items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {state.items.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${selected?.id === s.id ? ACCENT : BORDER}`,
                background: selected?.id === s.id ? "rgba(138,77,255,.06)" : "transparent",
              }}
            >
              {editingId === s.id ? (
                <div style={{ flex: 1, marginRight: 12 }}>
                  {formError && <ErrorBanner message={formError} />}
                  <input style={{ ...inputStyle, marginBottom: 6 }} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <input style={inputStyle} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description" />
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button type="button" style={buttonStyle("primary", busyId === s.id)} disabled={busyId === s.id} onClick={() => handleSaveEdit(s.id)}>
                      Save
                    </button>
                    <button type="button" style={buttonStyle("secondary", false)} onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => onSelect(s)} style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", flex: 1, color: TEXT_PRIMARY }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</div>
                  {s.description && <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 }}>{s.description}</div>}
                </button>
              )}
              {editingId !== s.id && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge active={s.active} />
                  <button
                    type="button"
                    style={buttonStyle("secondary", !isAdmin)}
                    disabled={!isAdmin}
                    title={!isAdmin ? "Requires admin" : undefined}
                    onClick={() => {
                      setEditingId(s.id);
                      setEditName(s.name);
                      setEditDescription(s.description ?? "");
                      setFormError(null);
                    }}
                  >
                    Edit
                  </button>
                  <ActivationToggle active={s.active} disabled={!isAdmin} busy={busyId === s.id} onToggle={() => handleToggleActive(s)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. SOURCE MAPPINGS (for a selected SourceSystem)
// ---------------------------------------------------------------------------

function SourceMappingsSection({
  isAdmin,
  sourceSystem,
  selected,
  onSelect,
}: {
  isAdmin: boolean;
  sourceSystem: SourceSystemAdminDTO;
  selected: SourceMappingAdminDTO | null;
  onSelect: (m: SourceMappingAdminDTO) => void;
}) {
  const [state, dispatch] = useListState<SourceMappingAdminDTO>();
  const [versionCounts, setVersionCounts] = useState<Record<string, number>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(() => {
    dispatch({ type: "LOAD_START" });
    void listSourceMappingsAdmin({ sourceSystemId: sourceSystem.id, active: "all", limit: 100 }).then((result) => {
      if (result.kind === "response" && isSuccessBody<{ sourceMappings: SourceMappingAdminDTO[] }, "sourceMappings">(result.body, "sourceMappings")) {
        dispatch({ type: "LOAD_SUCCESS", items: result.body.sourceMappings });
        // Best-effort version-number lookup for the active version of each
        // mapping, purely for display ("version N is active") — a failure
        // here degrades to omitting the number, never blocks the list.
        result.body.sourceMappings.forEach((m) => {
          if (!m.activeMappingVersionId) return;
          void listMappingVersions(m.id, { limit: 100 }).then((vResult) => {
            if (vResult.kind === "response" && isSuccessBody<{ mappingVersions: MappingVersionAdminDTO[] }, "mappingVersions">(vResult.body, "mappingVersions")) {
              const active = vResult.body.mappingVersions.find((v) => v.id === m.activeMappingVersionId);
              if (active) setVersionCounts((prev) => ({ ...prev, [m.id]: active.versionNumber }));
            }
          });
        });
      } else {
        dispatch({ type: "LOAD_FAILURE", message: describeError(result) });
      }
    });
  }, [sourceSystem.id, dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setFormError("Name is required.");
      return;
    }
    setCreating(true);
    const result = await createSourceMapping({ sourceSystemId: sourceSystem.id, name: trimmed });
    setCreating(false);
    if (result.kind === "response" && isSuccessBody<{ sourceMapping: SourceMappingAdminDTO }, "sourceMapping">(result.body, "sourceMapping")) {
      setName("");
      setShowCreate(false);
      load();
    } else {
      setFormError(describeError(result));
    }
  }

  async function handleSaveEdit(id: string) {
    setFormError(null);
    const trimmed = editName.trim();
    if (trimmed.length === 0) {
      setFormError("Name is required.");
      return;
    }
    setBusyId(id);
    const result = await updateSourceMapping(id, { name: trimmed });
    setBusyId(null);
    if (result.kind === "response" && isSuccessBody<{ sourceMapping: SourceMappingAdminDTO }, "sourceMapping">(result.body, "sourceMapping")) {
      setEditingId(null);
      load();
    } else {
      setFormError(describeError(result));
    }
  }

  async function handleToggleActive(m: SourceMappingAdminDTO) {
    setBusyId(m.id);
    const result = await updateSourceMapping(m.id, { active: !m.active });
    setBusyId(null);
    if (result.kind === "response" && isSuccessBody<{ sourceMapping: SourceMappingAdminDTO }, "sourceMapping">(result.body, "sourceMapping")) {
      load();
    } else {
      dispatch({ type: "LOAD_FAILURE", message: describeError(result) });
    }
  }

  return (
    <section style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>
          Mappings for <span style={{ color: ACCENT }}>{sourceSystem.name}</span>
        </h2>
        <button type="button" style={buttonStyle("primary", !isAdmin)} disabled={!isAdmin} title={!isAdmin ? "Requires admin" : undefined} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "New mapping"}
        </button>
      </div>

      {showCreate && (
        <div style={{ marginBottom: 16, padding: 14, border: `1px solid ${BORDER}`, borderRadius: 8 }}>
          {formError && <ErrorBanner message={formError} />}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle} htmlFor="new-mapping-name">Name</label>
            <input id="new-mapping-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Illegal Dumping monthly export" />
          </div>
          <button type="button" style={buttonStyle("primary", creating)} disabled={creating} onClick={handleCreate}>
            {creating ? "Creating..." : "Create mapping"}
          </button>
        </div>
      )}

      {state.status === "loading" && <p style={{ fontSize: 13, color: TEXT_SECONDARY }}>Loading mappings...</p>}
      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && state.items.length === 0 && (
        <p style={{ fontSize: 13, color: TEXT_SECONDARY }}>No mappings configured for this source system yet.</p>
      )}
      {state.status === "success" && state.items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {state.items.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${selected?.id === m.id ? ACCENT : BORDER}`,
                background: selected?.id === m.id ? "rgba(138,77,255,.06)" : "transparent",
              }}
            >
              {editingId === m.id ? (
                <div style={{ flex: 1, marginRight: 12 }}>
                  {formError && <ErrorBanner message={formError} />}
                  <input style={inputStyle} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button type="button" style={buttonStyle("primary", busyId === m.id)} disabled={busyId === m.id} onClick={() => handleSaveEdit(m.id)}>
                      Save
                    </button>
                    <button type="button" style={buttonStyle("secondary", false)} onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => onSelect(m)} style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", flex: 1, color: TEXT_PRIMARY }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 }}>
                    {m.activeMappingVersionId ? `Active version: v${versionCounts[m.id] ?? "..."}` : "No active version"}
                  </div>
                </button>
              )}
              {editingId !== m.id && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Badge active={m.active} />
                  <button
                    type="button"
                    style={buttonStyle("secondary", !isAdmin)}
                    disabled={!isAdmin}
                    title={!isAdmin ? "Requires admin" : undefined}
                    onClick={() => {
                      setEditingId(m.id);
                      setEditName(m.name);
                      setFormError(null);
                    }}
                  >
                    Rename
                  </button>
                  <ActivationToggle active={m.active} disabled={!isAdmin} busy={busyId === m.id} onToggle={() => handleToggleActive(m)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3/4/5/6. MAPPING VERSIONS — creation (with client-side UX validation
// mirroring the server's authoritative rules) and explicit activation.
// ---------------------------------------------------------------------------

function MappingVersionsSection({
  isAdmin,
  sourceSystem,
  mapping,
}: {
  isAdmin: boolean;
  sourceSystem: SourceSystemAdminDTO;
  mapping: SourceMappingAdminDTO;
}) {
  const [state, dispatch] = useListState<MappingVersionAdminDTO>();
  const [rows, setRows] = useState<MappingFieldRow[]>([{ canonicalTarget: CANONICAL_TARGET_FIELDS[0], sourceHeader: "" }]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const load = useCallback(() => {
    dispatch({ type: "LOAD_START" });
    void listMappingVersions(mapping.id, { limit: 100 }).then((result) => {
      if (result.kind === "response" && isSuccessBody<{ mappingVersions: MappingVersionAdminDTO[] }, "mappingVersions">(result.body, "mappingVersions")) {
        dispatch({ type: "LOAD_SUCCESS", items: result.body.mappingVersions });
      } else {
        dispatch({ type: "LOAD_FAILURE", message: describeError(result) });
      }
    });
  }, [mapping.id, dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  function addRow() {
    const used = new Set(rows.map((r) => r.canonicalTarget));
    const next = CANONICAL_TARGET_FIELDS.find((f) => !used.has(f));
    if (!next) return; // every canonical target already has a row
    setRows((prev) => [...prev, { canonicalTarget: next, sourceHeader: "" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, patch: Partial<MappingFieldRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleCreate() {
    setSubmitError(null);
    setSuccessMessage(null);
    const error = validateMappingRows(rows);
    setValidationError(error);
    if (error) return;

    const fields = buildMappingDocumentFields(rows);

    setCreating(true);
    const result = await createMappingVersion(mapping.id, { fields });
    setCreating(false);
    if (result.kind === "response" && isSuccessBody<{ mappingVersion: MappingVersionAdminDTO }, "mappingVersion">(result.body, "mappingVersion")) {
      setSuccessMessage(`Version ${result.body.mappingVersion.versionNumber} created. It is not active yet — activate it explicitly below when you are ready.`);
      setRows([{ canonicalTarget: CANONICAL_TARGET_FIELDS[0], sourceHeader: "" }]);
      load();
    } else {
      setSubmitError(describeError(result));
    }
  }

  async function handleActivate(versionId: string) {
    setActivatingId(versionId);
    setSubmitError(null);
    setSuccessMessage(null);
    const result = await activateMappingVersion(mapping.id, versionId);
    setActivatingId(null);
    if (result.kind === "response" && isSuccessBody<{ sourceMapping: SourceMappingAdminDTO }, "sourceMapping">(result.body, "sourceMapping")) {
      setSuccessMessage("That version is now active for this mapping.");
      load();
    } else {
      setSubmitError(describeError(result));
    }
  }

  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
        Versions for <span style={{ color: ACCENT }}>{mapping.name}</span>
      </h2>
      <p style={{ fontSize: 12, color: TEXT_SECONDARY, marginBottom: 16 }}>
        A mapping version is immutable once created — activate the version you want the next governed import for{" "}
        <strong>{sourceSystem.name}</strong> to use. Creating a version does not activate it automatically.
      </p>

      {submitError && <ErrorBanner message={submitError} />}
      {successMessage && <SuccessBanner message={successMessage} />}

      {state.status === "loading" && <p style={{ fontSize: 13, color: TEXT_SECONDARY }}>Loading versions...</p>}
      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && state.items.length === 0 && (
        <p style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 16 }}>No versions yet — create the first one below.</p>
      )}
      {state.status === "success" && state.items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {state.items
            .slice()
            .sort((a, b) => b.versionNumber - a.versionNumber)
            .map((v) => {
              const active = mapping.activeMappingVersionId === v.id;
              return (
                <div key={v.id} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${active ? GREEN : BORDER}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                      Version {v.versionNumber} {active && <Badge active />}
                    </div>
                    {!active && (
                      <button
                        type="button"
                        style={buttonStyle("primary", !isAdmin || activatingId === v.id)}
                        disabled={!isAdmin || activatingId === v.id}
                        title={!isAdmin ? "Requires admin" : undefined}
                        onClick={() => handleActivate(v.id)}
                      >
                        {activatingId === v.id ? "Activating..." : "Activate"}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: TEXT_SECONDARY, marginTop: 6 }}>
                    {Object.entries(v.mappingDocument.fields)
                      .map(([target, header]) => `"${header}" → ${target}`)
                      .join(",  ")}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <div style={{ padding: 14, border: `1px solid ${BORDER}`, borderRadius: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Create a new version</h3>
        <p style={{ fontSize: 11.5, color: TEXT_MUTED, marginBottom: 12 }}>
          For each row, enter the exact column header from the source file on the left, and choose which platform
          field it supplies on the right. For example, if the source file has a column literally named{" "}
          <code>Ticket #</code>, map it to <code>source_external_id</code> — that field is the generic identity the
          platform uses for reconciliation, regardless of what any particular source calls it.
        </p>

        {validationError && <ErrorBanner message={validationError} />}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {rows.map((row, i) => {
            const usedElsewhere = new Set(rows.filter((_, j) => j !== i).map((r) => r.canonicalTarget));
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="Source column header, e.g. Ticket #"
                  value={row.sourceHeader}
                  onChange={(e) => updateRow(i, { sourceHeader: e.target.value })}
                  maxLength={MAX_SOURCE_HEADER_LENGTH}
                />
                <span style={{ color: TEXT_MUTED, fontSize: 13 }}>→</span>
                <select
                  style={{ ...inputStyle, flex: 1 }}
                  value={row.canonicalTarget}
                  onChange={(e) => updateRow(i, { canonicalTarget: e.target.value })}
                >
                  {CANONICAL_TARGET_FIELDS.map((f) => (
                    <option key={f} value={f} disabled={usedElsewhere.has(f)}>
                      {humanize(f)}
                      {ILLEGAL_DUMPING_REQUIRED_HEADERS.includes(f as (typeof ILLEGAL_DUMPING_REQUIRED_HEADERS)[number]) ? " (required)" : ""}
                    </option>
                  ))}
                </select>
                <button type="button" style={buttonStyle("secondary", rows.length <= 1)} disabled={rows.length <= 1} onClick={() => removeRow(i)}>
                  Remove
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={buttonStyle("secondary", rows.length >= CANONICAL_TARGET_FIELDS.length)} disabled={rows.length >= CANONICAL_TARGET_FIELDS.length} onClick={addRow}>
            Add field
          </button>
          <button type="button" style={buttonStyle("primary", !isAdmin || creating)} disabled={!isAdmin || creating} title={!isAdmin ? "Requires admin" : undefined} onClick={handleCreate}>
            {creating ? "Creating..." : "Create version"}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 16 }}>
        A mapping cannot be test-run from this page. To confirm it works, upload a real (or representative sample)
        file through the{" "}
        <Link href="/data-hub/import" style={{ color: ACCENT }}>
          Data Hub import flow
        </Link>{" "}
        and check its Preview step before confirming — no mapping here has been validated against real data yet.
      </p>
    </section>
  );
}
