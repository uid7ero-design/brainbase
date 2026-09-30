import { assurancePost } from '@/lib/assurance/route';
import { createTemplate } from '@/lib/assurance/templates';

export const POST = assurancePost('administer', (viewer, body) => createTemplate(viewer, body), 'create inspection template');
