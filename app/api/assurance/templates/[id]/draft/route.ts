import { assurancePostWithId } from '@/lib/assurance/route';
import { updateTemplateDraft } from '@/lib/assurance/templateLifecycle';

// Saves a DRAFT version (guarded on lockVersion).
export const POST = assurancePostWithId('administer', (viewer, id, body) => updateTemplateDraft(viewer, id, body), 'save template draft');
