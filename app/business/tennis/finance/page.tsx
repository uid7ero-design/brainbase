import { redirect } from 'next/navigation';
import { tennisBusinessAccess } from '@/lib/tennisBusiness/access';
import TennisBusiness from '../TennisBusiness';
export default async function TennisFinancePage() {
  const access = await tennisBusinessAccess();
  if (!access.ok) {
    if (access.status === 401) redirect('/login');
    return <main><h1>Business finances unavailable</h1><p>Ask your administrator to check your organisation access.</p></main>;
  }
  if (!access.modules.some(key => key === 'invoicing' || key === 'purchasing')) return <main><h1>Business finances unavailable</h1><p>Invoicing or Purchasing access is required.</p></main>;
  return <TennisBusiness financeOnly />;
}
