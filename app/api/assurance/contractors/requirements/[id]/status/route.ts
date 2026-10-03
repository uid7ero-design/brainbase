import { assurancePostWithId } from '@/lib/assurance/route';
import { setRequirementStatus } from '@/lib/assurance/contractorAssurance';

// ACTIVE ↔ INACTIVE. Deactivation only stops new assignments.
export const POST = assurancePostWithId('administer', (viewer, id, body) => setRequirementStatus(viewer, id, body), 'set assurance requirement status');
