import { assurancePostWithId } from '@/lib/assurance/route';
import { transitionEscalation } from '@/lib/assurance/deadlines';

export const POST = assurancePostWithId('record', (viewer, id, body) => transitionEscalation(viewer, id, body, 'acknowledge'), 'acknowledge escalation');
