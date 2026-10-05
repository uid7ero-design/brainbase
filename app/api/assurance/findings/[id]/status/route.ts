import { assurancePostWithId } from '@/lib/assurance/route';
import { transitionFinding } from '@/lib/assurance/findings';

export const POST = assurancePostWithId('record', (viewer, id, body) => transitionFinding(viewer, id, body), 'transition finding');
