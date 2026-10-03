import { redirect } from 'next/navigation';
import { resolvePageViewer } from '../../../_components/pageAccess';

export const dynamic = 'force-dynamic';

// Audit templates moved to Assurance → Templates (A0.1F lifecycle).
export default async function AuditTemplateRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { id } = await params;
  redirect(`/assurance/templates/audit/${encodeURIComponent(id)}`);
}
