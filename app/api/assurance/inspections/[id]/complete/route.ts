import { assurancePostWithId } from '@/lib/assurance/route';
import { completeInspection } from '@/lib/assurance/inspections';

export const POST = assurancePostWithId('record', (viewer, id, body) => completeInspection(viewer, id, body), 'complete inspection');
