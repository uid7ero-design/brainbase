import { assurancePostWithId } from '@/lib/assurance/route';
import { linkFindingToAudit } from '@/lib/assurance/audits';

export const POST = assurancePostWithId('record', (viewer, id, body) => linkFindingToAudit(viewer, id, body), 'link finding to audit');
