import { redirect } from 'next/navigation';
import { resolvePageViewer } from '../../../_components/pageAccess';

export const dynamic = 'force-dynamic';

// Inspection templates moved to Assurance → Templates (A0.1F lifecycle).
export default async function InspectionTemplateRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  redirect(`/assurance/templates/inspection/${encodeURIComponent(id)}`);
}
