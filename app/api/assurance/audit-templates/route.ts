import { assurancePost } from '@/lib/assurance/route';
import { createAuditTemplate } from '@/lib/assurance/auditTemplates';

export const POST = assurancePost('administer', (viewer, body) => createAuditTemplate(viewer, body), 'create audit template');
