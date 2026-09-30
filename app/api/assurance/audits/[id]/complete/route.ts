import { assurancePostWithId } from '@/lib/assurance/route';
import { completeAudit } from '@/lib/assurance/audits';

export const POST = assurancePostWithId('record', (viewer, id, body) => completeAudit(viewer, id, body), 'complete audit');
