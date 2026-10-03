import { redirect } from 'next/navigation';
import { resolvePageViewer } from '../../_components/pageAccess';

export const dynamic = 'force-dynamic';

// Inspection templates moved to Assurance → Templates (A0.1F lifecycle).
export default async function InspectionTemplatesRedirect() {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  redirect('/assurance/templates?kind=inspection');
}
