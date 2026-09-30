import { assurancePostWithId } from '@/lib/assurance/route';
import { reactivateRiskLevel } from '@/lib/assurance/riskLevels';

export const POST = assurancePostWithId('administer', (viewer, id, body) => reactivateRiskLevel(viewer, id, body), 'reactivate risk level');
