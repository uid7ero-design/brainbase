import sql from '@/lib/db'

type Lead = {
  id: number
  name: string
  email: string
  phone: string | null
  message: string | null
  source: string
  created_at: string
}

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  let leads: Lead[] = []
  let error: string | null = null

  try {
    leads = await sql`
      SELECT id, name, email, phone, message, source, created_at
      FROM leads
      ORDER BY created_at DESC
    ` as Lead[]
  } catch {
    error = 'Could not connect to database. Have you run /api/init?'
  }

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-1">{leads.length} enquir{leads.length === 1 ? 'y' : 'ies'} received</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4 mb-6 text-sm">
            {error}
          </div>
        )}

        {!error && leads.length === 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
            <div className="text-4xl mb-3">🎾</div>
            <p className="font-medium">No leads yet</p>
            <p className="text-sm mt-1">Submit the form on the landing page to test the flow.</p>
          </div>
        )}

        {leads.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Message</th>
                  <th className="px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr
                    key={lead.id}
                    className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i === leads.length - 1 ? 'border-0' : ''}`}
                  >
                    <td className="px-5 py-4 font-medium text-gray-900">{lead.name}</td>
                    <td className="px-5 py-4 text-gray-600">{lead.email}</td>
                    <td className="px-5 py-4 text-gray-600">{lead.phone ?? '—'}</td>
                    <td className="px-5 py-4 text-gray-500 max-w-xs truncate">{lead.message ?? '—'}</td>
                    <td className="px-5 py-4 text-gray-400 whitespace-nowrap">
                      {new Date(lead.created_at).toLocaleDateString('en-AU', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
