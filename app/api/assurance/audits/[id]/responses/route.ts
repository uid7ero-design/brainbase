import { assurancePostWithId } from '@/lib/assurance/route';
import { recordAuditResponse } from '@/lib/assurance/audits';

// A criterion outcome never creates a Finding; findings are raised explicitly via /api/assurance/findings.
export const POST = assurancePostWithId('record', (viewer, id, body) => recordAuditResponse(viewer, id, body), 'record audit response');
