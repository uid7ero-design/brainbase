import { PRESETS, getPreset, resolveScheduleTerminology, type PresetKey, type Recurrence, type ResourceKind, type TermLabels } from '@scheduling/core';
import { CONFIGURABLE_PRESETS } from '../configurable';
import type { ScheduleView } from './types';

// Preset-driven wording. Every noun the dashboard shows for a schedule comes from the shared core's preset labels (plus the
// schedule's own overrides): "Session" for classes, "Service" for appointments, "Facility" for hire. Nothing here, or anywhere in
// the dashboard, names a sport or a business: resource kinds use the core's neutral kinds. PURE: client components import it.

export const wordingFor = (schedule: Pick<ScheduleView, 'presetKey' | 'terminology'>): TermLabels => resolveScheduleTerminology(schedule);

export const RESOURCE_KIND_LABELS: Readonly<Record<ResourceKind, string>> = {
  court: 'Court',
  table: 'Table',
  room: 'Room',
  practitioner: 'Practitioner',
  equipment: 'Equipment',
  space: 'Space',
  virtual: 'Online room',
};

/** The resource kinds a preset accepts, in the core's order. */
export const kindsFor = (presetKey: PresetKey): ResourceKind[] => [...getPreset(presetKey).resources.kinds];

/** Every kind an organisation can create today: the union over the configurable presets (no table: that is the restaurant preset). */
export function configurableKinds(): ResourceKind[] {
  const out: ResourceKind[] = [];
  for (const key of CONFIGURABLE_PRESETS) for (const kind of kindsFor(key)) if (!out.includes(kind)) out.push(kind);
  return out;
}

export interface PresetChoice {
  key: PresetKey;
  name: string;
  description: string;
  offering: string;
  offeringPlural: string;
  resourcePlural: string;
  resourcesRequired: boolean;
}

/** The choices the preset picker offers: the three configurable presets, described from the core's own definitions. */
export function presetChoices(): PresetChoice[] {
  return CONFIGURABLE_PRESETS.map(key => {
    const p = PRESETS[key];
    return {
      key,
      name: p.name,
      description: p.description,
      offering: p.labels.offering,
      offeringPlural: p.labels.offeringPlural,
      resourcePlural: p.labels.resourcePlural,
      resourcesRequired: p.resources.requirement === 'required',
    };
  });
}

export const presetName = (key: PresetKey): string => PRESETS[key].name;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const dayName = (n: number): string => DAYS[n] ?? '';
export const DAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = DAYS.map((label, value) => ({ value, label }));

export function recurrenceSummary(r: Recurrence, startTime: string | null): string {
  if (r.kind === 'none') return startTime ? `One-off at ${startTime}` : 'One-off';
  const base = `Every ${dayName(r.dayOfWeek)}${startTime ? ` at ${startTime}` : ''}`;
  if (r.end.mode === 'ongoing') return `${base}, ongoing`;
  if (r.end.mode === 'after_occurrences') return `${base}, ${r.end.count} times`;
  return `${base}, until ${r.end.date}`;
}

export function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function describeCancellation(policy: ScheduleView['cancellationPolicy']): string {
  if (!policy.customerCanCancel) return 'Customers cannot cancel';
  const window = policy.freeCancellationHoursBefore === null ? 'any time' : `up to ${policy.freeCancellationHoursBefore} h before the start`;
  const late = policy.lateCancellationCharge;
  const charge = late.kind === 'none' ? 'no late charge' : late.kind === 'percent' ? `${late.percent}% late charge` : `${(late.amountCents / 100).toFixed(2)} late charge`;
  return `Free cancellation ${window}; ${charge}`;
}
