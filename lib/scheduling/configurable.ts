import type { PresetKey } from '@scheduling/core';

// The presets the Scheduling configuration API and dashboard let an organisation create or switch to (Phase 2B scope).
// Restaurant tables, accommodation and events are fully supported by the shared core and database, but have no configuration
// interface yet, so the API refuses them and the dashboard does not offer them.
//
// PURE on purpose (no server import): the dashboard's client components import this file, and a client component that
// imported a server module would ship it to the browser. tests/containment/schedulingPhase2b2cContainment.test.ts pins that.
export const CONFIGURABLE_PRESETS: readonly PresetKey[] = ['classes_coaching', 'appointments', 'resource_hire'];

export const isConfigurablePreset = (value: unknown): value is PresetKey =>
  typeof value === 'string' && (CONFIGURABLE_PRESETS as readonly string[]).includes(value);
