import { assurancePostWithId } from '@/lib/assurance/route';
import { assignInspector } from '@/lib/assurance/inspections';

export const POST = assurancePostWithId('record', (viewer, id, body) => assignInspector(viewer, id, body), 'assign inspector');
