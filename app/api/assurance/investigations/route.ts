import { assurancePost } from '@/lib/assurance/route';
import { createInvestigation } from '@/lib/assurance/investigations';

export const POST = assurancePost('record', (viewer, body) => createInvestigation(viewer, body), 'create investigation');
