import { assurancePostWithId } from '@/lib/assurance/route';
import { cancelInspection } from '@/lib/assurance/inspections';

export const POST = assurancePostWithId('close', (viewer, id) => cancelInspection(viewer, id), 'cancel inspection');
