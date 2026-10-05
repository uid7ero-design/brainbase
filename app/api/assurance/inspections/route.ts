import { assurancePost } from '@/lib/assurance/route';
import { createInspection } from '@/lib/assurance/inspections';

export const POST = assurancePost('record', (viewer, body) => createInspection(viewer, body), 'create inspection');
