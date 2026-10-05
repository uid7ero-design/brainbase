import { assurancePostWithId } from '@/lib/assurance/route';
import { cancelAssignment } from '@/lib/assurance/contractorAssurance';

// Cancels an assignment with a reason; its evidence history is kept.
export const POST = assurancePostWithId('close', (viewer, id, body) => cancelAssignment(viewer, id, body), 'cancel requirement assignment');
