import { assurancePostWithId } from '@/lib/assurance/route';
import { startAudit } from '@/lib/assurance/audits';

export const POST = assurancePostWithId('record', (viewer, id) => startAudit(viewer, id), 'start audit');
