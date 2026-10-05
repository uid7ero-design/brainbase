import { assurancePostWithId } from '@/lib/assurance/route';
import { startInspection } from '@/lib/assurance/inspections';

export const POST = assurancePostWithId('record', (viewer, id) => startInspection(viewer, id), 'start inspection');
