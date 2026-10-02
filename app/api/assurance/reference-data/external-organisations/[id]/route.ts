import { assurancePostWithId } from '@/lib/assurance/route';
import { referenceActor } from '@/lib/assurance/referenceData';
import { updateReferenceRecord } from '@/lib/referenceData/service';

export const POST = assurancePostWithId('administer', (viewer, id, body) => updateReferenceRecord(referenceActor(viewer), 'external_organisation', id, body), 'update external organisation');
