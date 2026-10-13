import { parseProfileCountSelectionInput, type ProfileCountSelection } from "./profileCountSelection";

export interface PlanningSelectionRequest {
  datasetProfileRunId: string;
  selection: ProfileCountSelection;
}
// The profile pin is an optimistic comparison, never lookup/permission authority.
export function parsePlanningSelectionRequest(input: unknown):
  | { ok: true; input: PlanningSelectionRequest }
  | { ok: false; code: "PROFILE_SELECTION_INVALID" } {
  const invalid = { ok: false, code: "PROFILE_SELECTION_INVALID" } as const;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || !keys.includes("datasetProfileRunId") || !keys.includes("selection")) return invalid;
  const fields = Object.getOwnPropertyDescriptors(input);
  if (!["datasetProfileRunId", "selection"].every(key => fields[key].enumerable && "value" in fields[key])) return invalid;
  const pin = fields.datasetProfileRunId.value;
  if (typeof pin !== "string" || !pin.trim()) return invalid;
  const selected = parseProfileCountSelectionInput(fields.selection.value);
  return selected.ok ? { ok: true, input: { datasetProfileRunId: pin, selection: selected.selection } } : invalid;
}
