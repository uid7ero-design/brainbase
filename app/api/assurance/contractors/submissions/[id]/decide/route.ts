import { assurancePostWithId } from '@/lib/assurance/route';
import { decideSubmission } from '@/lib/assurance/contractorAssurance';

// Accept or reject evidence. The recorder can never decide on their own submission.
export const POST = assurancePostWithId('verify', (viewer, id, body) => decideSubmission(viewer, id, body), 'decide requirement evidence');
