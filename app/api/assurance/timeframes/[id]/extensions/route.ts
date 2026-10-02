import { assurancePostWithId } from '@/lib/assurance/route';
import { requestExtension } from '@/lib/assurance/deadlines';

export const POST = assurancePostWithId('record', (viewer, id, body) => requestExtension(viewer, id, body), 'request extension');
