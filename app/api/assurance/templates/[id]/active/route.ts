import { assurancePostWithId } from '@/lib/assurance/route';
import { setTemplateActive } from '@/lib/assurance/templates';

export const POST = assurancePostWithId('administer', (viewer, id, body) => setTemplateActive(viewer, id, body.active === true), 'set template active');
