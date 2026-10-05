import { assurancePostWithId } from '@/lib/assurance/route';
import { withdrawEvidenceVerification } from '@/lib/assurance/evidence';

// Take evidence back out of the verification queue (e.g. to correct it first).
export const POST = assurancePostWithId('record', (viewer, id, body) => withdrawEvidenceVerification(viewer, id, body), 'withdraw evidence verification');
