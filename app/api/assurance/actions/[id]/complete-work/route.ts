import { assurancePostWithId } from '@/lib/assurance/route';
import { completeActionWork } from '@/lib/assurance/actions';

export const POST = assurancePostWithId('record', (viewer, id) => completeActionWork(viewer, id), 'complete action work');
