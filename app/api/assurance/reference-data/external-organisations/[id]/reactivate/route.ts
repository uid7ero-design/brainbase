import { assurancePostWithId } from '@/lib/assurance/route';
import { referenceActor } from '@/lib/assurance/referenceData';
import { reactivateReferenceRecord } from '@/lib/referenceData/service';

export const POST = assurancePostWithId('administer', (viewer, id, body) => reactivateReferenceRecord(referenceActor(viewer), 'external_organisation', id, body), 'reactivate external organisation');
