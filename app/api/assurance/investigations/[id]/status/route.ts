import { assurancePostWithId } from '@/lib/assurance/route';
import { transitionInvestigation } from '@/lib/assurance/investigations';

// Completing/cancelling additionally requires the 'close' floor (enforced in the service).
// Completing an investigation never closes its incidents or findings.
export const POST = assurancePostWithId('record', (viewer, id, body) => transitionInvestigation(viewer, id, body), 'transition investigation');
