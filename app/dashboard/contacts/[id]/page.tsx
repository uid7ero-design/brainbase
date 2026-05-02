import { requireRole } from '@/lib/org';
import { redirect, notFound } from 'next/navigation';
import sql from '@/lib/db';
import Link from 'next/link';
import JournalClient from './JournalClient';
import ContactDetailClient from './ContactDetailClient';

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
    <div className="p-6 max-w-7xl mx-auto pb-32">
      <Link href="/dashboard/contacts" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors border border-white/8 hover:border-white/16 rounded-full px-4 py-2">
        ← Back to Contacts
      </Link>

      <div className="mt-6 mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">{contact.name as string}</h1>
        <p className="text-zinc-500 text-sm mt-1">Contact since {since}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 items-start">
        {/* Left — details & actions */}
        <div className="lg:sticky lg:top-20">
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
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-6">Session Notes</p>
          <JournalClient contactId={id} initial={journal as { id: string; note: string; created_at: string }[]} />
        </div>
      </div>
    </div>
  );
}
