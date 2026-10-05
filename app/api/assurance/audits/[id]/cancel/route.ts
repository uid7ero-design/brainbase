import { assurancePostWithId } from '@/lib/assurance/route';
import { cancelAudit } from '@/lib/assurance/audits';

export const POST = assurancePostWithId('close', (viewer, id, body) => cancelAudit(viewer, id, body), 'cancel audit');
