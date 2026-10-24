import { getPreset } from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';
import { audit, badRequest, conflict, failureResponse, guarded, idParam, notFound, omitOrganisation, readBody, unknownFields } from './http';

// Phase 2B.2b — assigning a resource to an offering and removing it again. Only the link is ever created or deleted here:
// a reservation, hold or occurrence is never touched (the repository's unlink refuses while a live reservation of the
// offering holds the resource, and the database enforces the same rule against a concurrent booking).

export async function listOfferingResources(context: SchedulingRouteContext): Promise<Response> {
  const offeringId = idParam(context, 'offeringId');
  if (!offeringId) return notFound();
  const offering = await context.persistence.config.getOffering(context.tenant, offeringId);
  if (!offering) return notFound();
  const resources = await context.persistence.config.listOfferingResources(context.tenant, offeringId);
  return schedulingJson({ resources: resources.map(r => omitOrganisation(r)) });
}

export async function linkResource(context: SchedulingRouteContext): Promise<Response> {
  const offeringId = idParam(context, 'offeringId');
  if (!offeringId) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const problems = unknownFields(parsed.body, ['resourceId']);
  const resourceId = parsed.body.resourceId;
  if (typeof resourceId !== 'string' || resourceId.trim() === '') problems.push('resourceId is required');
  if (problems.length > 0) return badRequest(problems);

  const offering = await context.persistence.config.getOffering(context.tenant, offeringId);
  if (!offering) return notFound();
  if (offering.archivedAt !== null) return conflict('ARCHIVED', 'This offering is archived; resources cannot be assigned to it.');
  const schedule = await context.persistence.config.getSchedule(context.tenant, offering.scheduleId);
  if (!schedule) return notFound();
  const resource = (await context.persistence.config.listResources(context.tenant)).find(r => r.id === resourceId);
  if (!resource) return notFound(); // missing, or another organisation's: the same answer

  const preset = getPreset(schedule.presetKey);
  if (!resource.active) return conflict('RESOURCE_INACTIVE', 'An inactive resource cannot be assigned. Reactivate it first.');
  if (!(preset.resources.kinds as readonly string[]).includes(resource.kind)) {
    return conflict('KIND_NOT_ACCEPTED', `${preset.name} offerings accept these resource types: ${preset.resources.kinds.join(', ')}.`, { accepted: preset.resources.kinds });
  }

  const already = (await context.persistence.config.listOfferingResources(context.tenant, offeringId)).some(r => r.id === resource.id);
  const linked = await guarded(() => context.persistence.config.linkOfferingResource(context.tenant, offeringId, resource.id));
  if (!linked.ok) return linked.response;
  if (!already) await audit(context, 'scheduling.resource.linked', 'resource', resource.id, { offering_id: offeringId });
  return schedulingJson({ linked: true, changed: !already }, { status: already ? 200 : 201 });
}

export async function unlinkResource(context: SchedulingRouteContext): Promise<Response> {
  const offeringId = idParam(context, 'offeringId');
  const resourceId = idParam(context, 'resourceId');
  if (!offeringId || !resourceId) return notFound();
  const result = await guarded(() => context.persistence.config.unlinkOfferingResource(context.tenant, offeringId, resourceId));
  if (!result.ok) return result.response;
  if (!result.value.ok) return failureResponse(result.value.reason, result.value.detail);
  if (result.value.value.removed) await audit(context, 'scheduling.resource.unlinked', 'resource', resourceId, { offering_id: offeringId });
  return schedulingJson({ removed: result.value.value.removed });
}
