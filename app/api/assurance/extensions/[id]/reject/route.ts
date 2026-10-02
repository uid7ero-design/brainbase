import { assurancePostWithId } from '@/lib/assurance/route';
import { decideExtension } from '@/lib/assurance/deadlines';

export const POST = assurancePostWithId('administer', (viewer, id, body) => decideExtension(viewer, id, body, 'reject'), 'reject extension');
