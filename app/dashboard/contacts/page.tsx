import { requireRole } from '@/lib/org';
import { redirect } from 'next/navigation';
import sql from '@/lib/db';
import ContactsClient from './ContactsClient';
import { PageHeader } from '@/components/ui/app';
import styles from './Contacts.module.css';

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
    <div className={styles.page}>
      <PageHeader
        title="Contacts"
        description={`${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`}
      />
      <ContactsClient contacts={contacts as Parameters<typeof ContactsClient>[0]['contacts']} />
    </div>
  );
}
