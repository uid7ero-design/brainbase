import { requireRole } from '@/lib/org';
import { redirect } from 'next/navigation';
import sql from '@/lib/db';
import ContactsClient from './ContactsClient';

export default async function ContactsPage() {
  let session;
  try { session = await requireRole('viewer'); } catch { redirect('/login'); }

  const contacts = await sql`
    SELECT id, name, email, phone, status, last_contacted_at, created_at
    FROM contacts
    WHERE organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">Contacts</h1>
        <p className="text-zinc-500 text-sm mt-1">{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</p>
      </div>
      <ContactsClient contacts={contacts as Parameters<typeof ContactsClient>[0]['contacts']} />
    </div>
  );
}
