import { assurancePost } from '@/lib/assurance/route';
import { referenceActor } from '@/lib/assurance/referenceData';
import { createReferenceRecord } from '@/lib/referenceData/service';

export const POST = assurancePost('administer', (viewer, body) => createReferenceRecord(referenceActor(viewer), 'external_organisation', body), 'create external organisation');
