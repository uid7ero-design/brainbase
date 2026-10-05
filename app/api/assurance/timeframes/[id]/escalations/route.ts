import { assurancePostWithId } from '@/lib/assurance/route';
import { raiseEscalation } from '@/lib/assurance/deadlines';

export const POST = assurancePostWithId('record', (viewer, id, body) => raiseEscalation(viewer, id, body), 'raise escalation');
