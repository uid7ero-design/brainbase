import { assurancePostWithId } from '@/lib/assurance/route';
import { requestEvidenceVerification } from '@/lib/assurance/evidence';

// Submit unverified evidence for an independent verification decision.
export const POST = assurancePostWithId('record', (viewer, id, body) => requestEvidenceVerification(viewer, id, body), 'request evidence verification');
