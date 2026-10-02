import { assurancePostWithId } from '@/lib/assurance/route';
import { referenceActor } from '@/lib/assurance/referenceData';
import { deactivateReferenceRecord } from '@/lib/referenceData/service';

export const POST = assurancePostWithId('administer', (viewer, id, body) => deactivateReferenceRecord(referenceActor(viewer), 'external_organisation', id, body), 'deactivate external organisation');
