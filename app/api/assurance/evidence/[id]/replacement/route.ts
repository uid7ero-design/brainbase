import { assurancePostWithId } from '@/lib/assurance/route';
import { recordReplacementEvidence } from '@/lib/assurance/evidence';

// Record replacement evidence for accepted or rejected evidence; the original stays as history.
export const POST = assurancePostWithId('record', (viewer, id, body) => recordReplacementEvidence(viewer, id, body), 'record replacement evidence');
