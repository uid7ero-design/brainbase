import { assurancePost } from '@/lib/assurance/route';
import { createAction } from '@/lib/assurance/actions';

export const POST = assurancePost('record', (viewer, body) => createAction(viewer, body), 'create action');
