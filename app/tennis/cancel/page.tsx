import { notFound } from 'next/navigation';
import sql from '@/lib/db';
import CancelButton from './CancelButton';

export default async function CancelPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  if (!t) notFound();

  type CancelRow = { name: string; session_type: string | null; status: string }
  let rows: CancelRow[] = [];
  try {
    rows = (await sql`
      SELECT name, session_type, status
      FROM tennis_leads
      WHERE client_token = ${t}::uuid
      LIMIT 1
    `) as unknown as CancelRow[];
  } catch {
    notFound();
  }

  if (rows.length === 0) notFound();
  const lead = rows[0];

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        {lead.status === 'cancelled' ? (
          <div className="rounded-2xl border border-white/8 bg-white/2 p-8 text-center">
            <p className="text-zinc-500 text-sm mb-3">Request already cancelled</p>
            <h1 className="text-xl font-bold text-white mb-4">This request has been cancelled</h1>
            <p className="text-zinc-500 text-sm mb-6">If you'd like to make a new enquiry, we'd love to hear from you.</p>
            <a href="/tennis" className="inline-block text-sm text-zinc-400 hover:text-white transition-colors">← Back to LD Tennis</a>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/8 bg-white/2 p-8">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-white mb-2">Cancel your request?</h1>
              <p className="text-zinc-400 text-sm">
                Hi {lead.name}, are you sure you want to cancel your coaching enquiry
                {lead.session_type ? ` for ${lead.session_type}` : ''}?
              </p>
            </div>

            <div className="rounded-xl border border-white/8 bg-white/4 p-4 mb-5">
              <p className="text-xs text-zinc-500 mb-1">Name</p>
              <p className="text-sm text-white font-medium">{lead.name}</p>
              {lead.session_type && (
                <>
                  <p className="text-xs text-zinc-500 mt-3 mb-1">Session Type</p>
                  <p className="text-sm text-zinc-300">{lead.session_type}</p>
                </>
              )}
            </div>

            <p className="text-xs text-zinc-600 mb-6">
              Your enquiry will be marked as cancelled. We&apos;ll keep your details on file for our records only.
            </p>

            <CancelButton token={t} />
          </div>
        )}
      </div>
    </div>
  );
}
