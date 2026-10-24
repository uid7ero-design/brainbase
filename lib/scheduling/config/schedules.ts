import { PRESETS, getPreset, validateExpectedUpdatedAt, validateSchedulePatch, type PresetKey, type SchedulePatch, type StoredSchedule } from '@scheduling/core';
import type { SchedulingRouteContext } from '../route';
import { schedulingJson } from '../route';
import { CONFIGURABLE_PRESETS, isConfigurablePreset } from '../configurable';
// The configurable presets live in a pure module so the dashboard's client components can import them (see ../configurable.ts).
import { audit, badRequest, changedFields, conflict, failureResponse, guarded, idParam, notFound, omitOrganisation, readBody, splitExpectedUpdatedAt, unknownFields } from './http';

// Phase 2B.2b — schedule create / read / edit / archive. Every handler is reached only through schedulingRoute(), so the
// session, the organisation's entitlement and the role's permission were checked before it runs; reads need
// scheduling.view, every write scheduling.manage (declared on the route file, enforced again by the repository).

export const publicSchedule = (s: StoredSchedule) => omitOrganisation(s);

const CREATE_FIELDS = ['name', 'presetKey', 'terminology', 'cancellationPolicy', 'timezone'] as const;
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

function presetProblem(value: unknown): string | null {
  return isConfigurablePreset(value) ? null : `presetKey must be one of: ${CONFIGURABLE_PRESETS.join(', ')}`;
}

export async function listSchedules({ persistence, tenant }: SchedulingRouteContext): Promise<Response> {
  const schedules = await persistence.config.listSchedules(tenant);
  return schedulingJson({ schedules: schedules.map(publicSchedule) });
}

export async function createSchedule(context: SchedulingRouteContext): Promise<Response> {
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const problems = unknownFields(body, CREATE_FIELDS);
  if (!has(body, 'name')) problems.push('name is required');
  if (!has(body, 'presetKey')) problems.push('presetKey is required');
  else {
    const p = presetProblem(body.presetKey);
    if (p) problems.push(p);
  }
  if (problems.length === 0) {
    const fields: SchedulePatch = { name: body.name as string };
    for (const k of ['terminology', 'cancellationPolicy', 'timezone'] as const) if (has(body, k)) (fields as Record<string, unknown>)[k] = body[k];
    problems.push(...validateSchedulePatch(fields));
  }
  if (problems.length > 0) return badRequest(problems);

  const presetKey = body.presetKey as PresetKey;
  const preset = getPreset(presetKey);
  const result = await guarded(() =>
    context.persistence.config.createSchedule(context.tenant, {
      name: (body.name as string).trim(),
      presetKey,
      presetVersion: PRESETS[presetKey].version,
      terminology: has(body, 'terminology') ? (body.terminology as StoredSchedule['terminology']) : {},
      cancellationPolicy: has(body, 'cancellationPolicy') ? (body.cancellationPolicy as StoredSchedule['cancellationPolicy']) : structuredClone(preset.defaultCancellationPolicy) as StoredSchedule['cancellationPolicy'],
      timezone: has(body, 'timezone') ? (body.timezone as string | null) : null,
      publicSlug: null, // public booking is not part of this API
    }),
  );
  if (!result.ok) return result.response;
  await audit(context, 'scheduling.schedule.created', 'schedule', result.value.id, { preset_key: presetKey });
  return schedulingJson({ schedule: publicSchedule(result.value) }, { status: 201 });
}

export async function getSchedule(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'scheduleId');
  if (!id) return notFound();
  const schedule = await context.persistence.config.getSchedule(context.tenant, id);
  if (!schedule) return notFound();
  const offerings = await context.persistence.config.listOfferings(context.tenant, id);
  return schedulingJson({ schedule: publicSchedule(schedule), offerings: offerings.map(o => omitOrganisation(o)) });
}

export async function updateSchedule(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'scheduleId');
  if (!id) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt, changes } = splitExpectedUpdatedAt(parsed.body);
  const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...unknownFields(changes, CREATE_FIELDS)];
  if (has(changes, 'presetKey')) {
    const p = presetProblem(changes.presetKey);
    if (p) problems.push(p);
  }
  if (problems.length === 0) problems.push(...validateSchedulePatch(changes as SchedulePatch));
  if (problems.length > 0) return badRequest(problems);

  const result = await guarded(() => context.persistence.config.updateSchedule(context.tenant, id, expectedUpdatedAt as string, changes as SchedulePatch));
  if (!result.ok) return result.response;
  if (!result.value.ok) return failureResponse(result.value.reason, result.value.detail);
  await audit(context, 'scheduling.schedule.updated', 'schedule', id, {
    fields: changedFields(changes),
    ...(has(changes, 'presetKey') ? { preset_key: changes.presetKey as string } : {}),
  });
  return schedulingJson({ schedule: publicSchedule(result.value.value) });
}

export async function archiveSchedule(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'scheduleId');
  if (!id) return notFound();
  const archived = await context.persistence.config.archiveSchedule(context.tenant, id);
  if (!archived) {
    const existing = await context.persistence.config.getSchedule(context.tenant, id);
    return existing ? conflict('ARCHIVED', 'This schedule is already archived.') : notFound();
  }
  await audit(context, 'scheduling.schedule.archived', 'schedule', id);
  return schedulingJson({ archived: true });
}
