import { assurancePostWithId } from '@/lib/assurance/route';
import { deactivateRiskLevel } from '@/lib/assurance/riskLevels';

export const POST = assurancePostWithId('administer', (viewer, id, body) => deactivateRiskLevel(viewer, id, body), 'deactivate risk level');
