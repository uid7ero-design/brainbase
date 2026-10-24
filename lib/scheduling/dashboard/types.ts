import type { CancellationPolicy, PresetKey, Recurrence, ResourceKind, TermLabels } from '@scheduling/core';

// The shapes the Scheduling configuration API returns (lib/scheduling/config/*), as the dashboard uses them. The organisation is
// never part of a response. PURE types only: client components import this file.

export interface ScheduleView {
  id: string;
  name: string;
  presetKey: PresetKey;
  presetVersion: number;
  terminology: Partial<TermLabels>;
  cancellationPolicy: CancellationPolicy;
  timezone: string | null;
  publicSlug: string | null;
  /** The version token: send it back unchanged with an edit. */
  updatedAt: string;
  archivedAt: string | null;
}

export interface OfferingView {
  id: string;
  scheduleId: string;
  name: string;
  typeKey: string | null;
  colourKey: string | null;
  durationMinutes: number | null;
  capacity: number | null;
  price: { amountCents: number; currency: string };
  startTime: string | null;
  recurrence: Recurrence;
  resourceKinds: ResourceKind[];
  updatedAt: string;
  archivedAt: string | null;
}

export interface ResourceView {
  id: string;
  kind: ResourceKind;
  name: string;
  capacity: number;
  minParty: number | null;
  active: boolean;
  updatedAt: string;
}

export interface StatusView {
  configured: boolean;
  timezone: string;
  timezone_source: 'organisation' | 'fallback';
  currency: string;
  access: { scope: 'full' | 'reduced'; permissions: string[] };
}
