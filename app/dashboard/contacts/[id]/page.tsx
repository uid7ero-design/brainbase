import { requireRole } from '@/lib/org';
import { redirect, notFound } from 'next/navigation';
import sql from '@/lib/db';
import Link from 'next/link';
import JournalClient from './JournalClient';
import ContactDetailClient from './ContactDetailClient';
import { PageHeader, buttonProps } from '@/components/ui/app';
import styles from '../Contacts.module.css';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch { redirect('/login'); }

  const { id } = await params;

  const contacts = await sql`
    SELECT id, name, email, phone, status, address, age, program, session_times, next_action, last_contacted_at, created_at
    FROM contacts
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;
  if (contacts.length === 0) notFound();
  const contact = contacts[0];

  const journal = await sql`
    SELECT id, note, created_at
    FROM contact_journal
    WHERE contact_id = ${id} AND organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;

  const since = new Date(contact.created_at as string).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className={`${styles.page} ${styles.wide}`}>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/contacts" {...buttonProps('secondary', 'sm')}>
            ← Back to Contacts
          </Link>
        }
        title={contact.name as string}
        description={`Contact since ${since}`}
      />

      <div className={styles.detailGrid}>
        {/* Left — details & actions */}
        <div className={styles.detailAside}>
          <ContactDetailClient contact={{
            id: contact.id as string,
            name: contact.name as string,
            email: contact.email as string,
            phone: contact.phone as string | null,
            status: contact.status as string,
            address: contact.address as string | null,
            age: contact.age as number | null,
            program: contact.program as string | null,
            session_times: contact.session_times as string | null,
            next_action: contact.next_action as string | null,
            last_contacted_at: contact.last_contacted_at as string | null,
            created_at: contact.created_at as string,
          }} />
        </div>

        {/* Right — coaching journal */}
        <section aria-labelledby="session-notes-heading">
          <h2 id="session-notes-heading" className={styles.sectionLabel}>Session Notes</h2>
          <JournalClient contactId={id} initial={journal as { id: string; note: string; created_at: string }[]} />
        </section>
      </div>
    </div>
  );
}
