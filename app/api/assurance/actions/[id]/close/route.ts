import { assurancePostWithId } from '@/lib/assurance/route';
import { closeAction } from '@/lib/assurance/actions';

export const POST = assurancePostWithId('close', (viewer, id) => closeAction(viewer, id), 'close action');
