import { assurancePostWithId } from '@/lib/assurance/route';
import { setAuditTemplateActive } from '@/lib/assurance/auditTemplates';

export const POST = assurancePostWithId('administer', (viewer, id, body) => setAuditTemplateActive(viewer, id, body.active === true), 'set audit template active');
