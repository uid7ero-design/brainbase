import CoachingWorkspaceScreen from '../_components/CoachingWorkspaceScreen';
import { resolveSchedulingPage } from '../_components/pageAccess';
export const dynamic = 'force-dynamic';
export default async function CoachingPage() {
  const {canManage,denied,timezone}=await resolveSchedulingPage();
  if (denied) return denied;
  if (!canManage) return <p>Coaching management access is required to view player rosters.</p>;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone ?? 'Australia/Adelaide',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return <CoachingWorkspaceScreen today={today} />;
}
