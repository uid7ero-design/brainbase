import { requireRole } from '@/lib/org';
import { redirect } from 'next/navigation';
import sql from '@/lib/db';
import Link from 'next/link';


const statusStyles: Record<string, string> = {
  new:       'bg-green-500/10 text-green-400 border-green-500/20',
  contacted: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  booked:    'bg-purple-500/10 text-purple-400 border-purple-500/20',
  closed:    'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
};

function formatDateTime(ts: string) {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
  };
}

export default async function LeadsDashboard() {
  let session;
  try { session = await requireRole('viewer'); } catch { redirect('/login'); }

  const leads = await sql`
    SELECT id, name, email, phone, session_type, message, status, created_at
    FROM tennis_leads
    WHERE organisation_id = ${session.organisationId}
    ORDER BY created_at DESC
  `;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">Tennis Leads</h1>
        <p className="text-zinc-500 text-sm mt-1">{leads.length} total lead{leads.length !== 1 ? 's' : ''} from ldtennis.com.au</p>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/4 p-12 text-center">
          <p className="text-zinc-500 text-sm">No leads yet. They'll appear here when someone submits the form at <span className="text-zinc-400">/tennis</span>.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 bg-white/4">
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">Name</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">Contact</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 hidden md:table-cell">Session Type</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 hidden lg:table-cell">Message</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">Status</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 hidden sm:table-cell">Received</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, i) => {
                const { date, time } = formatDateTime(lead.created_at);
                return (
                  <tr key={lead.id} className={`border-b border-white/5 hover:bg-white/4 transition-colors ${i === leads.length - 1 ? 'border-none' : ''}`}>
                    <td className="px-5 py-4 font-medium text-white">
                      <Link href={`/dashboard/leads/${lead.id}`} className="hover:text-green-400 transition-colors">{lead.name}</Link>
                    </td>
                    <td className="px-5 py-4">
                      <a href={`mailto:${lead.email}`} className="text-zinc-300 hover:text-white transition-colors block">{lead.email}</a>
                      {lead.phone && <span className="text-zinc-500 text-xs">{lead.phone}</span>}
                    </td>
                    <td className="px-5 py-4 text-zinc-400 hidden md:table-cell">{lead.session_type || '—'}</td>
                    <td className="px-5 py-4 text-zinc-500 max-w-xs truncate hidden lg:table-cell">{lead.message || '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border capitalize ${statusStyles[lead.status] ?? statusStyles.new}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-zinc-500 text-xs hidden sm:table-cell whitespace-nowrap">
                      <span className="block">{date}</span>
                      <span className="text-zinc-600">{time}</span>
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/dashboard/leads/${lead.id}`} className="text-zinc-600 hover:text-zinc-300 transition-colors text-xs">View →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
