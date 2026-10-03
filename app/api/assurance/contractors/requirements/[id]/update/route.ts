import { assurancePostWithId } from '@/lib/assurance/route';
import { updateRequirement } from '@/lib/assurance/contractorAssurance';

// Edits a requirement (guarded on lockVersion). Recorded submissions keep their own snapshot.
export const POST = assurancePostWithId('administer', (viewer, id, body) => updateRequirement(viewer, id, body), 'update assurance requirement');
