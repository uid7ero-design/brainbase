import { assurancePostWithId } from '@/lib/assurance/route';
import { cancelAction } from '@/lib/assurance/actions';

export const POST = assurancePostWithId('close', (viewer, id, body) => cancelAction(viewer, id, body), 'cancel action');
