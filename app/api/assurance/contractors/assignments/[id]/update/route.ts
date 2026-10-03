import { assurancePostWithId } from '@/lib/assurance/route';
import { updateAssignment } from '@/lib/assurance/contractorAssurance';

export const POST = assurancePostWithId('record', (viewer, id, body) => updateAssignment(viewer, id, body), 'update requirement assignment');
