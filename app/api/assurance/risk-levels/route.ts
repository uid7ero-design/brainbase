import { assurancePost } from '@/lib/assurance/route';
import { createRiskLevel } from '@/lib/assurance/riskLevels';

export const POST = assurancePost('administer', (viewer, body) => createRiskLevel(viewer, body), 'create risk level');
