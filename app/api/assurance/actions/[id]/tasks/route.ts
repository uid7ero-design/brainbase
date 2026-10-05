import { assurancePostWithId } from '@/lib/assurance/route';
import { linkActionTask } from '@/lib/assurance/actions';

export const POST = assurancePostWithId('record', (viewer, id, body) => linkActionTask(viewer, id, body), 'link action task');
