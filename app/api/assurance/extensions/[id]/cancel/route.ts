import { assurancePostWithId } from '@/lib/assurance/route';
import { cancelExtension } from '@/lib/assurance/deadlines';

export const POST = assurancePostWithId('record', (viewer, id, body) => cancelExtension(viewer, id, body), 'withdraw extension');
