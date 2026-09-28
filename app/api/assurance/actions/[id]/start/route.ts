import { assurancePostWithId } from '@/lib/assurance/route';
import { startAction } from '@/lib/assurance/actions';

export const POST = assurancePostWithId('record', (viewer, id) => startAction(viewer, id), 'start action');
