import { assurancePostWithId } from '@/lib/assurance/route';
import { recordInspectionResponse } from '@/lib/assurance/inspections';

export const POST = assurancePostWithId('record', (viewer, id, body) => recordInspectionResponse(viewer, id, body), 'record inspection response');
