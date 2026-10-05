import { assurancePostWithId } from '@/lib/assurance/route';
import { updateRiskLevel } from '@/lib/assurance/riskLevels';

export const POST = assurancePostWithId('administer', (viewer, id, body) => updateRiskLevel(viewer, id, body), 'update risk level');
