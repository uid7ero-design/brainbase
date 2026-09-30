import { assurancePost } from '@/lib/assurance/route';
import { createFinding } from '@/lib/assurance/findings';

export const POST = assurancePost('record', (viewer, body) => createFinding(viewer, body), 'create finding');
