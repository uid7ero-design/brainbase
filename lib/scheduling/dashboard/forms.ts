import {
  getPreset,
  validateOfferingForPreset,
  validateOfferingPatch,
  validateResourcePatch,
  validateSchedulePatch,
  type CancellationPolicy,
  type OfferingPatch,
  type PresetKey,
  type Recurrence,
  type ResourceKind,
  type ResourcePatch,
  type SchedulePatch,
} from '@scheduling/core';
import { CONFIGURABLE_PRESETS } from '../configurable';
import type { OfferingView, ResourceView, ScheduleView } from './types';

// Form logic for the dashboard, kept out of the components so it is testable without a DOM and shared by every screen. Each
// builder turns the text the user typed into the body the API takes, runs the SAME pure validators the API runs (the shared core's),
// and returns plain-language problems instead of a body when something is wrong. The API still validates everything again; this is
// feedback, never authority. PURE: client components import it.

export type Built<T> = { ok: true; value: T } | { ok: false; problems: string[] };
const fail = <T>(problems: string[]): Built<T> => ({ ok: false, problems });

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const blank = (s: string) => s.trim() === '';

/** "25", "25.5", "25.50", "$1,250" -> cents; anything else is null. */
export function parseMoneyToCents(text: string): number | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
export const centsToText = (cents: number): string => (cents / 100).toFixed(2);

const toInt = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

// ─── schedules ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ScheduleFormValues {
  name: string;
  presetKey: PresetKey;
  /** Blank = use the organisation's timezone. */
  timezone: string;
  customerCanCancel: boolean;
  /** Blank = a cancellation is never "late". */
  freeHours: string;
  lateKind: 'none' | 'percent' | 'fixed';
  lateValue: string;
}

function policyToValues(policy: CancellationPolicy): Pick<ScheduleFormValues, 'customerCanCancel' | 'freeHours' | 'lateKind' | 'lateValue'> {
  const late = policy.lateCancellationCharge;
  return {
    customerCanCancel: policy.customerCanCancel,
    freeHours: policy.freeCancellationHoursBefore === null ? '' : String(policy.freeCancellationHoursBefore),
    lateKind: late.kind,
    lateValue: late.kind === 'percent' ? String(late.percent) : late.kind === 'fixed' ? centsToText(late.amountCents) : '',
  };
}

export function emptyScheduleValues(presetKey: PresetKey = CONFIGURABLE_PRESETS[0]): ScheduleFormValues {
  return { name: '', presetKey, timezone: '', ...policyToValues(getPreset(presetKey).defaultCancellationPolicy) };
}

/** Switching preset in the create form re-seeds the cancellation defaults, but keeps what the user already typed for the name. */
export const withPreset = (values: ScheduleFormValues, presetKey: PresetKey): ScheduleFormValues => ({
  ...values,
  presetKey,
  ...policyToValues(getPreset(presetKey).defaultCancellationPolicy),
});

export function valuesFromSchedule(s: ScheduleView): ScheduleFormValues {
  return { name: s.name, presetKey: s.presetKey, timezone: s.timezone ?? '', ...policyToValues(s.cancellationPolicy) };
}

function policyFromValues(v: ScheduleFormValues): Built<CancellationPolicy> {
  const problems: string[] = [];
  let free: number | null = null;
  if (!blank(v.freeHours)) {
    free = toInt(v.freeHours);
    if (free === null) problems.push('Free cancellation hours must be a whole number, or blank for no limit.');
  }
  let late: CancellationPolicy['lateCancellationCharge'] = { kind: 'none' };
  if (v.lateKind === 'percent') {
    const n = Number(v.lateValue);
    if (blank(v.lateValue) || !Number.isFinite(n) || n < 0 || n > 100) problems.push('The late cancellation percentage must be between 0 and 100.');
    else late = { kind: 'percent', percent: n };
  } else if (v.lateKind === 'fixed') {
    const cents = parseMoneyToCents(v.lateValue);
    if (cents === null) problems.push('The late cancellation charge must be an amount such as 20.00.');
    else late = { kind: 'fixed', amountCents: cents };
  }
  if (problems.length > 0) return fail(problems);
  return { ok: true, value: { customerCanCancel: v.customerCanCancel, freeCancellationHoursBefore: free, lateCancellationCharge: late } };
}

function commonScheduleFields(v: ScheduleFormValues): Built<{ name: string; timezone: string | null; cancellationPolicy: CancellationPolicy }> {
  const problems: string[] = [];
  if (blank(v.name)) problems.push('Give the schedule a name.');
  const policy = policyFromValues(v);
  if (!policy.ok) problems.push(...policy.problems);
  if (problems.length > 0 || !policy.ok) return fail(problems);
  return { ok: true, value: { name: v.name.trim(), timezone: blank(v.timezone) ? null : v.timezone.trim(), cancellationPolicy: policy.value } };
}

export function buildScheduleCreate(v: ScheduleFormValues): Built<Record<string, unknown>> {
  const common = commonScheduleFields(v);
  if (!common.ok) return common;
  const body: Record<string, unknown> = { name: common.value.name, presetKey: v.presetKey, cancellationPolicy: common.value.cancellationPolicy };
  if (common.value.timezone !== null) body.timezone = common.value.timezone;
  const problems = validateSchedulePatch(body as SchedulePatch);
  return problems.length > 0 ? fail(problems) : { ok: true, value: body };
}

/** Only the fields that changed are sent. `presetKey` is included only when the preset may still change. */
export function buildScheduleEdit(v: ScheduleFormValues, original: ScheduleView, presetChangeable: boolean): Built<Record<string, unknown>> {
  const common = commonScheduleFields(v);
  if (!common.ok) return common;
  const changes: Record<string, unknown> = {};
  if (common.value.name !== original.name) changes.name = common.value.name;
  if (common.value.timezone !== original.timezone) changes.timezone = common.value.timezone;
  if (!same(common.value.cancellationPolicy, original.cancellationPolicy)) changes.cancellationPolicy = common.value.cancellationPolicy;
  if (presetChangeable && v.presetKey !== original.presetKey) changes.presetKey = v.presetKey;
  if (Object.keys(changes).length === 0) return fail(['Nothing has changed.']);
  const problems = validateSchedulePatch(changes as SchedulePatch);
  return problems.length > 0 ? fail(problems) : { ok: true, value: changes };
}

// ─── offerings ──────────────────────────────────────────────────────────────────────────────────────────────────

export type EndMode = 'ongoing' | 'after_occurrences' | 'on_date';

export interface OfferingFieldPlan {
  /** 'required' for headcount presets (classes); 'hidden' where the resource decides. */
  capacity: 'required' | 'hidden';
  /** 'required' where the offering fixes the duration; 'optional' where the customer chooses; 'hidden' otherwise. */
  duration: 'required' | 'optional' | 'hidden';
  recurrenceKinds: Array<'none' | 'weekly'>;
  endModes: EndMode[];
}

/** What the offering form shows, derived from the preset in the shared core, never from a table of its own. */
export function offeringFieldPlan(presetKey: PresetKey): OfferingFieldPlan {
  const p = getPreset(presetKey);
  const recurrenceKinds = p.recurrence.kinds.filter((k): k is 'none' | 'weekly' => k === 'none' || k === 'weekly');
  return {
    capacity: p.capacity.semantics === 'headcount_per_occurrence' ? 'required' : 'hidden',
    duration: p.durationSource === 'offering_fixed' ? 'required' : p.durationSource === 'customer_selected' ? 'optional' : 'hidden',
    recurrenceKinds,
    endModes: [...p.recurrence.endModes] as EndMode[],
  };
}

export interface OfferingFormValues {
  name: string;
  durationMinutes: string;
  capacity: string;
  /** Dollars as typed, e.g. "25.00". */
  price: string;
  recurrence: 'none' | 'weekly';
  dayOfWeek: string;
  startTime: string;
  startDate: string;
  endMode: EndMode;
  endCount: string;
  endDate: string;
}

export function emptyOfferingValues(presetKey: PresetKey): OfferingFormValues {
  const plan = offeringFieldPlan(presetKey);
  return {
    name: '',
    durationMinutes: '',
    capacity: '',
    price: '0.00',
    recurrence: 'none',
    dayOfWeek: '1',
    startTime: '',
    startDate: '',
    endMode: plan.endModes[0] ?? 'ongoing',
    endCount: '',
    endDate: '',
  };
}

export function valuesFromOffering(o: OfferingView): OfferingFormValues {
  const r = o.recurrence;
  return {
    name: o.name,
    durationMinutes: o.durationMinutes === null ? '' : String(o.durationMinutes),
    capacity: o.capacity === null ? '' : String(o.capacity),
    price: centsToText(o.price.amountCents),
    recurrence: r.kind,
    dayOfWeek: r.kind === 'weekly' ? String(r.dayOfWeek) : '1',
    startTime: o.startTime ?? '',
    startDate: r.kind === 'weekly' ? r.startDate ?? '' : '',
    endMode: r.kind === 'weekly' ? r.end.mode : 'ongoing',
    endCount: r.kind === 'weekly' && r.end.mode === 'after_occurrences' ? String(r.end.count) : '',
    endDate: r.kind === 'weekly' && r.end.mode === 'on_date' ? r.end.date : '',
  };
}

function recurrenceFromValues(v: OfferingFormValues): Built<Recurrence> {
  if (v.recurrence === 'none') return { ok: true, value: { kind: 'none' } };
  const problems: string[] = [];
  const day = toInt(v.dayOfWeek);
  if (day === null || day > 6) problems.push('Choose a day of the week.');
  if (blank(v.startTime)) problems.push('A weekly offering needs a start time.');
  let end: Extract<Recurrence, { kind: 'weekly' }>['end'] = { mode: 'ongoing' };
  if (v.endMode === 'after_occurrences') {
    const n = toInt(v.endCount);
    if (n === null || n < 1) problems.push('Enter how many times it repeats.');
    else end = { mode: 'after_occurrences', count: n };
    if (blank(v.startDate)) problems.push('A series that ends after a number of times needs a first date.');
  } else if (v.endMode === 'on_date') {
    if (blank(v.endDate)) problems.push('Choose the date the series ends.');
    else end = { mode: 'on_date', date: v.endDate.trim() };
  }
  if (problems.length > 0 || day === null) return fail(problems);
  return { ok: true, value: { kind: 'weekly', dayOfWeek: day, startDate: blank(v.startDate) ? null : v.startDate.trim(), end } };
}

interface OfferingFields {
  name: string;
  durationMinutes: number | null;
  capacity: number | null;
  priceCents: number;
  startTime: string | null;
  recurrence: Recurrence;
}

function offeringFields(v: OfferingFormValues, presetKey: PresetKey): Built<OfferingFields> {
  const plan = offeringFieldPlan(presetKey);
  const problems: string[] = [];
  let durationMinutes: number | null = null;
  if (plan.duration !== 'hidden' && !blank(v.durationMinutes)) {
    durationMinutes = toInt(v.durationMinutes);
    if (durationMinutes === null || durationMinutes < 1) problems.push('Duration must be a whole number of minutes.');
  }
  let capacity: number | null = null;
  if (plan.capacity === 'required' && !blank(v.capacity)) {
    capacity = toInt(v.capacity);
    if (capacity === null || capacity < 1) problems.push('Capacity must be a whole number of at least 1.');
  }
  const priceCents = parseMoneyToCents(v.price);
  if (priceCents === null) problems.push('Price must be an amount such as 25.00.');
  const recurrence = recurrenceFromValues(v);
  if (!recurrence.ok) problems.push(...recurrence.problems);
  if (!(plan.recurrenceKinds as string[]).includes(v.recurrence)) problems.push('This type of schedule does not allow that repeat pattern.');
  if (v.recurrence === 'weekly' && !(plan.endModes as string[]).includes(v.endMode)) problems.push('This type of schedule does not allow that way of ending a series.');
  if (problems.length > 0 || !recurrence.ok || priceCents === null) return fail([...new Set(problems)]);
  return {
    ok: true,
    value: { name: v.name.trim(), durationMinutes, capacity, priceCents, startTime: blank(v.startTime) ? null : v.startTime.trim(), recurrence: recurrence.value },
  };
}

function offeringRuleProblems(f: OfferingFields, presetKey: PresetKey): string[] {
  return [
    ...validateOfferingPatch({ name: f.name, durationMinutes: f.durationMinutes, capacity: f.capacity, priceCents: f.priceCents, startTime: f.startTime, recurrence: f.recurrence } as OfferingPatch, presetKey),
    ...validateOfferingForPreset({ name: f.name, durationMinutes: f.durationMinutes, capacity: f.capacity, startTime: f.startTime, recurrence: f.recurrence }, presetKey),
  ];
}

export function buildOfferingCreate(v: OfferingFormValues, presetKey: PresetKey): Built<Record<string, unknown>> {
  const f = offeringFields(v, presetKey);
  if (!f.ok) return f;
  const problems = [...new Set(offeringRuleProblems(f.value, presetKey))];
  if (problems.length > 0) return fail(problems);
  const body: Record<string, unknown> = { name: f.value.name, priceCents: f.value.priceCents, recurrence: f.value.recurrence };
  if (f.value.durationMinutes !== null) body.durationMinutes = f.value.durationMinutes;
  if (f.value.capacity !== null) body.capacity = f.value.capacity;
  if (f.value.startTime !== null) body.startTime = f.value.startTime;
  return { ok: true, value: body };
}

export function buildOfferingEdit(v: OfferingFormValues, original: OfferingView, presetKey: PresetKey): Built<Record<string, unknown>> {
  const f = offeringFields(v, presetKey);
  if (!f.ok) return f;
  const problems = [...new Set(offeringRuleProblems(f.value, presetKey))];
  if (problems.length > 0) return fail(problems);
  const changes: Record<string, unknown> = {};
  if (f.value.name !== original.name) changes.name = f.value.name;
  if (f.value.durationMinutes !== original.durationMinutes) changes.durationMinutes = f.value.durationMinutes;
  if (f.value.capacity !== original.capacity) changes.capacity = f.value.capacity;
  if (f.value.priceCents !== original.price.amountCents) changes.priceCents = f.value.priceCents;
  if (f.value.startTime !== original.startTime) changes.startTime = f.value.startTime;
  if (!same(f.value.recurrence, original.recurrence)) changes.recurrence = f.value.recurrence;
  if (Object.keys(changes).length === 0) return fail(['Nothing has changed.']);
  return { ok: true, value: changes };
}

// ─── resources ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ResourceFormValues {
  name: string;
  kind: ResourceKind;
  capacity: string;
  minParty: string;
}

export const emptyResourceValues = (kind: ResourceKind): ResourceFormValues => ({ name: '', kind, capacity: '1', minParty: '' });
export const valuesFromResource = (r: ResourceView): ResourceFormValues => ({ name: r.name, kind: r.kind, capacity: String(r.capacity), minParty: r.minParty === null ? '' : String(r.minParty) });

function resourceFields(v: ResourceFormValues): Built<{ name: string; kind: ResourceKind; capacity: number; minParty: number | null }> {
  const problems: string[] = [];
  if (blank(v.name)) problems.push('Give the resource a name.');
  const capacity = toInt(v.capacity);
  if (capacity === null || capacity < 1) problems.push('Capacity must be a whole number of at least 1.');
  let minParty: number | null = null;
  if (!blank(v.minParty)) {
    minParty = toInt(v.minParty);
    if (minParty === null || minParty < 1) problems.push('Minimum party must be a whole number of at least 1, or blank.');
  }
  if (problems.length > 0 || capacity === null) return fail(problems);
  return { ok: true, value: { name: v.name.trim(), kind: v.kind, capacity, minParty } };
}

export function buildResourceCreate(v: ResourceFormValues): Built<Record<string, unknown>> {
  const f = resourceFields(v);
  if (!f.ok) return f;
  const body: Record<string, unknown> = { kind: f.value.kind, name: f.value.name, capacity: f.value.capacity };
  if (f.value.minParty !== null) body.minParty = f.value.minParty;
  const problems = validateResourcePatch(body as ResourcePatch);
  return problems.length > 0 ? fail(problems) : { ok: true, value: body };
}

export function buildResourceEdit(v: ResourceFormValues, original: ResourceView): Built<Record<string, unknown>> {
  const f = resourceFields(v);
  if (!f.ok) return f;
  const changes: Record<string, unknown> = {};
  if (f.value.name !== original.name) changes.name = f.value.name;
  if (f.value.kind !== original.kind) changes.kind = f.value.kind;
  if (f.value.capacity !== original.capacity) changes.capacity = f.value.capacity;
  if (f.value.minParty !== original.minParty) changes.minParty = f.value.minParty;
  if (Object.keys(changes).length === 0) return fail(['Nothing has changed.']);
  const problems = validateResourcePatch(changes as ResourcePatch);
  return problems.length > 0 ? fail(problems) : { ok: true, value: changes };
}
