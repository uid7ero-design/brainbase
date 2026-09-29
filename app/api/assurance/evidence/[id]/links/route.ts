import { assurancePostWithId } from '@/lib/assurance/route';
import { linkEvidence } from '@/lib/assurance/evidence';

export const POST = assurancePostWithId('record', (viewer, id, body) => linkEvidence(viewer, id, body), 'link evidence');
