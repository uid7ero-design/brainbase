import { validateExpectedUpdatedAt, validateOfferingForPreset, validateOfferingPatch, type OfferingPatch, type Recurrence, type StoredOffering } from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';
import { audit, badRequest, changedFields, conflict, failureResponse, guarded, idParam, notFound, omitOrganisation, readBody, splitExpectedUpdatedAt, unknownFields } from './http';

// Phase 2B.2b — offering create / read / edit / archive. An offering inherits its schedule's preset, so every rule below
// is checked against the SCHEDULE's preset, never one the caller names.

export const publicOffering = (o: StoredOffering) => omitOrganisation(o);

const FIELDS = ['name', 'typeKey', 'colourKey', 'durationMinutes', 'capacity', 'priceCents', 'startTime', 'recurrence'] as const;
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

export async function listOfferings(context: SchedulingRouteContext): Promise<Response> {
  const scheduleId = idParam(context, 'scheduleId');
  if (!scheduleId) return notFound();
  const schedule = await context.persistence.config.getSchedule(context.tenant, scheduleId);
  if (!schedule) return notFound();
  const offerings = await context.persistence.config.listOfferings(context.tenant, scheduleId);
  return schedulingJson({ offerings: offerings.map(publicOffering) });
}

export async function createOffering(context: SchedulingRouteContext): Promise<Response> {
  const scheduleId = idParam(context, 'scheduleId');
  if (!scheduleId) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const schedule = await context.persistence.config.getSchedule(context.tenant, scheduleId);
  if (!schedule) return notFound();
  if (schedule.archivedAt !== null) return conflict('ARCHIVED', 'This schedule is archived; it cannot take new offerings.');

  const problems = unknownFields(body, FIELDS);
  if (!has(body, 'name')) problems.push('name is required');
  const recurrence = (has(body, 'recurrence') ? body.recurrence : { kind: 'none' }) as Recurrence;
  const values = {
    name: body.name as string,
    durationMinutes: has(body, 'durationMinutes') ? (body.durationMinutes as number | null) : null,
    capacity: has(body, 'capacity') ? (body.capacity as number | null) : null,
    startTime: has(body, 'startTime') ? (body.startTime as string | null) : null,
    recurrence,
  };
  if (problems.length === 0) {
    problems.push(...validateOfferingPatch({ ...values, priceCents: has(body, 'priceCents') ? (body.priceCents as number) : 0, typeKey: has(body, 'typeKey') ? (body.typeKey as string | null) : null, colourKey: has(body, 'colourKey') ? (body.colourKey as string | null) : null } as OfferingPatch, schedule.presetKey));
    problems.push(...validateOfferingForPreset(values, schedule.presetKey));
  }
  if (problems.length > 0) return badRequest([...new Set(problems)]);

  const created = await guarded(() =>
    context.persistence.config.createOffering(context.tenant, scheduleId, {
      scheduleId,
      name: values.name.trim(),
      typeKey: has(body, 'typeKey') ? (body.typeKey as string | null) : null,
      colourKey: has(body, 'colourKey') ? (body.colourKey as string | null) : null,
      durationMinutes: values.durationMinutes,
      capacity: values.capacity,
      price: { amountCents: has(body, 'priceCents') ? (body.priceCents as number) : 0, currency: context.settings.currency },
      startTime: values.startTime as StoredOffering['startTime'],
      recurrence: values.recurrence,
    }),
  );
  if (!created.ok) return created.response;
  await audit(context, 'scheduling.offering.created', 'offering', created.value.id, { schedule_id: scheduleId, preset_key: schedule.presetKey });
  return schedulingJson({ offering: publicOffering(created.value) }, { status: 201 });
}

export async function getOffering(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'offeringId');
  if (!id) return notFound();
  const offering = await context.persistence.config.getOffering(context.tenant, id);
  if (!offering) return notFound();
  const resources = await context.persistence.config.listOfferingResources(context.tenant, id);
  return schedulingJson({ offering: publicOffering(offering), resources: resources.map(r => omitOrganisation(r)) });
}

export async function updateOffering(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'offeringId');
  if (!id) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt, changes } = splitExpectedUpdatedAt(parsed.body);

  const current = await context.persistence.config.getOffering(context.tenant, id);
  if (!current) return notFound();
  const schedule = await context.persistence.config.getSchedule(context.tenant, current.scheduleId);
  if (!schedule) return notFound();

  const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...unknownFields(changes, FIELDS)];
  if (problems.length === 0) {
    problems.push(...validateOfferingPatch(changes as OfferingPatch, schedule.presetKey));
    // The preset's rules apply to the RESULT of the edit, so a partial patch cannot leave an offering the preset forbids.
    const merged = {
      name: has(changes, 'name') ? (changes.name as string) : current.name,
      durationMinutes: has(changes, 'durationMinutes') ? (changes.durationMinutes as number | null) : current.durationMinutes,
      capacity: has(changes, 'capacity') ? (changes.capacity as number | null) : current.capacity,
      startTime: has(changes, 'startTime') ? (changes.startTime as string | null) : current.startTime,
      recurrence: has(changes, 'recurrence') ? (changes.recurrence as Recurrence) : current.recurrence,
    };
    problems.push(...validateOfferingForPreset(merged, schedule.presetKey));
  }
  if (problems.length > 0) return badRequest([...new Set(problems)]);

  const result = await guarded(() => context.persistence.config.updateOffering(context.tenant, id, expectedUpdatedAt as string, changes as OfferingPatch));
  if (!result.ok) return result.response;
  if (!result.value.ok) return failureResponse(result.value.reason, result.value.detail);
  await audit(context, 'scheduling.offering.updated', 'offering', id, { fields: changedFields(changes), schedule_id: current.scheduleId });
  return schedulingJson({ offering: publicOffering(result.value.value) });
}

export async function archiveOffering(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'offeringId');
  if (!id) return notFound();
  const archived = await context.persistence.config.archiveOffering(context.tenant, id);
  if (!archived) {
    const existing = await context.persistence.config.getOffering(context.tenant, id);
    return existing ? conflict('ARCHIVED', 'This offering is already archived.') : notFound();
  }
  await audit(context, 'scheduling.offering.archived', 'offering', id);
  return schedulingJson({ archived: true });
}
