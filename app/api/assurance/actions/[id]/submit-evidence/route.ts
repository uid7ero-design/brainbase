import { assurancePostWithId } from '@/lib/assurance/route';
import { submitActionEvidence } from '@/lib/assurance/actions';

export const POST = assurancePostWithId('record', (viewer, id) => submitActionEvidence(viewer, id), 'submit action evidence');
