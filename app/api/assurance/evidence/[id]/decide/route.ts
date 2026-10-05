import { assurancePostWithId } from '@/lib/assurance/route';
import { decideEvidence } from '@/lib/assurance/evidence';

// Accept or reject evidence. Independence and the state are enforced server-side and in the database.
export const POST = assurancePostWithId('verify', (viewer, id, body) => decideEvidence(viewer, id, body), 'decide evidence');
