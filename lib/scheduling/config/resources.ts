import { validateExpectedUpdatedAt, validateResourcePatch, type ResourceKind, type ResourcePatch, type StoredResource } from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';
import { audit, badRequest, changedFields, failureResponse, guarded, idParam, notFound, omitOrganisation, readBody, splitExpectedUpdatedAt, unknownFields } from './http';

// Phase 2B.2b — resource create / read / edit / deactivate / reactivate. Deactivation is its own operation (its own audit
// action, and the same booking rules as any edit): `active` is NOT accepted by the general edit.

export const publicResource = (r: StoredResource) => omitOrganisation(r);

const CREATE_FIELDS = ['kind', 'name', 'capacity', 'minParty'] as const;
const EDIT_FIELDS = ['name', 'kind', 'capacity', 'minParty'] as const;
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

export async function listResources({ persistence, tenant }: SchedulingRouteContext): Promise<Response> {
  const resources = await persistence.config.listResources(tenant);
  return schedulingJson({ resources: resources.map(publicResource) });
}

export async function createResource(context: SchedulingRouteContext): Promise<Response> {
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const problems = unknownFields(body, CREATE_FIELDS);
  for (const required of ['kind', 'name', 'capacity']) if (!has(body, required)) problems.push(`${required} is required`);
  if (problems.length === 0) problems.push(...validateResourcePatch({ kind: body.kind as ResourceKind, name: body.name as string, capacity: body.capacity as number, ...(has(body, 'minParty') ? { minParty: body.minParty as number | null } : {}) }));
  if (problems.length > 0) return badRequest(problems);

  const created = await guarded(() =>
    context.persistence.config.createResource(context.tenant, {
      kind: body.kind as ResourceKind,
      name: (body.name as string).trim(),
      capacity: body.capacity as number,
      minParty: has(body, 'minParty') ? (body.minParty as number | null) : null,
      active: true,
    }),
  );
  if (!created.ok) return created.response;
  await audit(context, 'scheduling.resource.created', 'resource', created.value.id, { kind: created.value.kind });
  return schedulingJson({ resource: publicResource(created.value) }, { status: 201 });
}

async function findResource(context: SchedulingRouteContext, id: string): Promise<StoredResource | null> {
  const all = await context.persistence.config.listResources(context.tenant);
  return all.find(r => r.id === id) ?? null;
}

export async function getResource(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'resourceId');
  if (!id) return notFound();
  const resource = await findResource(context, id);
  return resource ? schedulingJson({ resource: publicResource(resource) }) : notFound();
}

export async function updateResource(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'resourceId');
  if (!id) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt, changes } = splitExpectedUpdatedAt(parsed.body);
  const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...unknownFields(changes, EDIT_FIELDS)];
  if (has(changes, 'active')) problems.push('use the deactivate or reactivate operation to change whether a resource is active');
  if (problems.length === 0) problems.push(...validateResourcePatch(changes as ResourcePatch));
  if (problems.length > 0) return badRequest([...new Set(problems)]);

  const result = await guarded(() => context.persistence.config.updateResource(context.tenant, id, expectedUpdatedAt as string, changes as ResourcePatch));
  if (!result.ok) return result.response;
  if (!result.value.ok) return failureResponse(result.value.reason, result.value.detail);
  await audit(context, 'scheduling.resource.updated', 'resource', id, { fields: changedFields(changes) });
  return schedulingJson({ resource: publicResource(result.value.value) });
}

async function setActive(context: SchedulingRouteContext, active: boolean): Promise<Response> {
  const id = idParam(context, 'resourceId');
  if (!id) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt, changes } = splitExpectedUpdatedAt(parsed.body);
  const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...unknownFields(changes, [])];
  if (problems.length > 0) return badRequest(problems);

  const result = await guarded(() => context.persistence.config.updateResource(context.tenant, id, expectedUpdatedAt as string, { active }));
  if (!result.ok) return result.response;
  if (!result.value.ok) return failureResponse(result.value.reason, result.value.detail);
  await audit(context, active ? 'scheduling.resource.reactivated' : 'scheduling.resource.deactivated', 'resource', id);
  return schedulingJson({ resource: publicResource(result.value.value) });
}

export const deactivateResource = (context: SchedulingRouteContext) => setActive(context, false);
export const reactivateResource = (context: SchedulingRouteContext) => setActive(context, true);
