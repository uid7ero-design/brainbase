import { requireRole } from '@/lib/org';
import { redirect } from 'next/navigation';
import OrganisationUsersClient from './OrganisationUsersClient';
export default async function OrganisationUsersPage(){
  try{await requireRole('admin');}catch{redirect('/workspace');}
  return <OrganisationUsersClient />;
}
