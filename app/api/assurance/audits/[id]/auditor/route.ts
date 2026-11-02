import { assurancePostWithId } from '@/lib/assurance/route';
import { assignAuditor } from '@/lib/assurance/audits';

export const POST = assurancePostWithId('record', (viewer, id, body) => assignAuditor(viewer, id, body), 'assign auditor');
