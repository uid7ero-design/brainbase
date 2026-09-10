"use client";

// Data Hub 5B.5B — SourceMapping selection data fetching for the Review
// screen. Mirrors useSourceSystems.ts's own rationale and shape exactly:
// deliberately independent of any DataHubIllegalDumpingImportSession
// instance (listing mappings is not part of the import state machine), a
// thin passthrough to the orchestrator's re-exported listSourceMappings/
// getSourceMapping (never httpClient.ts directly — preserves this
// package's existing, tested module boundary).
import { useEffect, useReducer } from "react";
import { getSourceMapping, listSourceMappings } from "@/lib/data-hub/client/orchestrator";
import type { SourceMappingDTOClient } from "@/lib/data-hub/client/types";

// A manager-administered list per SourceSystem — expected to be small. Same
// one-shot-page rationale as useSourceSystems.ts's own SOURCE_SYSTEM_PAGE_SIZE.
const SOURCE_MAPPING_PAGE_SIZE = 100;

const GENERIC_LOAD_ERROR = "Couldn't load source mappings.";

export type SourceMappingsLoadState =
  // Data Hub Section 8 — a null-source (legacy) batch has nothing to list
  // by; this hook never fetches for that case, and this is the ONE status
  // that means "not applicable", distinct from "loading"/"error".
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; sourceMappings: SourceMappingDTOClient[] }
  | { status: "error"; message: string };

type SourceMappingsAction =
  | { type: "RESET" }
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; sourceMappings: SourceMappingDTOClient[] }
  | { type: "LOAD_FAILURE"; message: string };

function sourceMappingsReducer(_state: SourceMappingsLoadState, action: SourceMappingsAction): SourceMappingsLoadState {
  switch (action.type) {
    case "RESET":
      return { status: "idle" };
    case "LOAD_START":
      return { status: "loading" };
    case "LOAD_SUCCESS":
      return { status: "success", sourceMappings: action.sourceMappings };
    case "LOAD_FAILURE":
      return { status: "error", message: action.message };
    default:
      return _state;
  }
}

/**
 * `sourceSystemId` is the batch's own AUTHORITATIVE persisted source
 * (ImportBatchHandle.sourceSystemId) — never a value this hook resolves
 * itself. Passing `null` (legacy/no-source batch, Section 8) skips the
 * fetch entirely and returns `{ status: "idle" }` — this hook never renders
 * an active mapping selector for a batch with no source, by construction.
 * Re-fetches whenever `sourceSystemId` itself changes (never expected to,
 * in practice — Section 10/V: the batch's own source is immutable after
 * initiation — but this hook stays correct if a caller is ever reused
 * across batches).
 */
export function useSourceMappings(sourceSystemId: string | null): SourceMappingsLoadState {
  const [state, dispatch] = useReducer(sourceMappingsReducer, { status: sourceSystemId === null ? "idle" : "loading" });

  useEffect(() => {
    if (sourceSystemId === null) {
      dispatch({ type: "RESET" });
      return;
    }
    let cancelled = false;
    dispatch({ type: "LOAD_START" });
    void listSourceMappings({ sourceSystemId, limit: SOURCE_MAPPING_PAGE_SIZE }).then((result) => {
      if (cancelled) return;
      if (result.kind !== "response" || !("sourceMappings" in result.body)) {
        dispatch({ type: "LOAD_FAILURE", message: GENERIC_LOAD_ERROR });
        return;
      }
      dispatch({ type: "LOAD_SUCCESS", sourceMappings: result.body.sourceMappings });
    });
    return () => {
      cancelled = true;
    };
  }, [sourceSystemId]);

  return state;
}

export type FrozenMappingLabelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; name: string }
  | { status: "error" };

type FrozenMappingLabelAction =
  | { type: "RESET" }
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; name: string }
  | { type: "LOAD_FAILURE" };

function frozenMappingLabelReducer(_state: FrozenMappingLabelState, action: FrozenMappingLabelAction): FrozenMappingLabelState {
  switch (action.type) {
    case "RESET":
      return { status: "idle" };
    case "LOAD_START":
      return { status: "loading" };
    case "LOAD_SUCCESS":
      return { status: "success", name: action.name };
    case "LOAD_FAILURE":
      return { status: "error" };
    default:
      return _state;
  }
}

/**
 * Data Hub 5B.5B, Section 16 — resolves a human-readable name for a
 * worksheet's frozen SourceMapping by id, for the ONE case the already-
 * loaded active=true list (useSourceMappings above) cannot serve: the
 * frozen mapping has since been deactivated (or its SourceSystem has), so
 * it is absent from that list. Callers should pass `null` whenever the
 * frozen mapping IS present in the already-loaded list (look it up there
 * first — zero extra network call) — this hook exists only for the
 * fallback case, never as the primary source for an active mapping's name.
 * Never fetches merely to decorate a NEW-selection dropdown.
 */
export function useFrozenSourceMappingLabel(sourceMappingId: string | null): FrozenMappingLabelState {
  const [state, dispatch] = useReducer(frozenMappingLabelReducer, { status: sourceMappingId === null ? "idle" : "loading" });

  useEffect(() => {
    if (sourceMappingId === null) {
      dispatch({ type: "RESET" });
      return;
    }
    let cancelled = false;
    dispatch({ type: "LOAD_START" });
    void getSourceMapping(sourceMappingId).then((result) => {
      if (cancelled) return;
      if (result.kind !== "response" || !("sourceMapping" in result.body)) {
        dispatch({ type: "LOAD_FAILURE" });
        return;
      }
      dispatch({ type: "LOAD_SUCCESS", name: result.body.sourceMapping.name });
    });
    return () => {
      cancelled = true;
    };
  }, [sourceMappingId]);

  return state;
}
