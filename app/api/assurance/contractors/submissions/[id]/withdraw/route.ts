import { assurancePostWithId } from '@/lib/assurance/route';
import { withdrawSubmission } from '@/lib/assurance/contractorAssurance';

export const POST = assurancePostWithId('record', (viewer, id, body) => withdrawSubmission(viewer, id, body), 'withdraw requirement evidence');
