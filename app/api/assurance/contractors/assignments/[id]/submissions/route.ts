import { assurancePostWithId } from '@/lib/assurance/route';
import { recordSubmission } from '@/lib/assurance/contractorAssurance';

// Records evidence supplied for an assignment (shared evidence row + submission).
export const POST = assurancePostWithId('record', (viewer, id, body) => recordSubmission(viewer, id, body), 'record requirement evidence');
