import { assurancePostWithId } from '@/lib/assurance/route';
import { recordVerification } from '@/lib/assurance/verifications';

// Independence (the verifier is neither the owner nor the work completer)
// is enforced inside recordVerification().
export const POST = assurancePostWithId('verify', (viewer, id, body) => recordVerification(viewer, id, body), 'record verification');
