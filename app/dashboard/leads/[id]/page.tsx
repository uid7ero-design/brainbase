import { requireRole } from '@/lib/org';
import { redirect, notFound } from 'next/navigation';
import sql from '@/lib/db';
import Link from 'next/link';
import DeleteLeadButton from './DeleteLeadButton';

const statusStyles: Record<string, string> = {
  new:       'bg-green-500/10 text-green-400 border-green-500/20',
  contacted: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  booked:    'bg-purple-500/10 text-purple-400 border-purple-500/20',
  closed:    'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="py-4 border-b border-white/5 last:border-none grid grid-cols-[160px_1fr] gap-4 items-start">
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 pt-0.5">{label}</span>
      <span className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{value || '—'}</span>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole('viewer'); } catch { redirect('/login'); }

  const { id } = await params;

  const rows = await sql`
    SELECT id, name, email, phone, session_type, message, status, created_at
    FROM tennis_leads
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
    LIMIT 1
  `;

  if (rows.length === 0) notFound();
  const lead = rows[0];

  const receivedAt = new Date(lead.created_at as string);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <Link href="/dashboard/leads" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors border border-white/8 hover:border-white/16 rounded-full px-4 py-2">
          ← Back to Leads
        </Link>
        <h1 className="text-2xl font-bold text-white tracking-tight mt-4">{lead.name as string}</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Received {receivedAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} at {receivedAt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/2 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Lead Details</p>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border capitalize ${statusStyles[lead.status as string] ?? statusStyles.new}`}>
            {lead.status as string}
          </span>
        </div>
        <div className="px-6">
          <Field label="Full Name" value={lead.name as string} />
          <Field label="Email" value={lead.email as string} />
          <Field label="Phone" value={lead.phone as string} />
          <Field label="Session Type" value={lead.session_type as string} />
          <Field label="Message" value={lead.message as string} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3">
          <a
            href={`mailto:${lead.email as string}`}
            className="inline-flex items-center gap-2 bg-green-500 text-black font-semibold px-6 py-2.5 rounded-full hover:bg-green-400 transition-colors text-sm"
          >
            Reply by Email
          </a>
          {lead.phone && (
            <a
              href={`tel:${lead.phone as string}`}
              className="inline-flex items-center gap-2 border border-white/10 text-zinc-300 font-medium px-6 py-2.5 rounded-full hover:border-white/20 hover:text-white transition-colors text-sm"
            >
              Call {lead.phone as string}
            </a>
          )}
        </div>
        <DeleteLeadButton leadId={lead.id as string} />
      </div>
    </div>
  );
}
