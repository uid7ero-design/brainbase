import { assurancePostWithId } from '@/lib/assurance/route';
import { reopenFinding } from '@/lib/assurance/findings';

export const POST = assurancePostWithId('close', (viewer, id, body) => reopenFinding(viewer, id, body), 'reopen finding');
