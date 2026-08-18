import 'server-only'
import sql from '@/lib/db'

// Session Type is now the primary visible identity for a class (see
// app/dashboard/sessions/page.tsx's sessionLabel/optionalLabel); the
// stored sessions.name column is an optional secondary label. That column
// stays NOT NULL with no default in the database (no migration was made
// for this — see the smallest-change instruction this was built under), so
// when a manager leaves the "Optional Label" field blank in the Create/Edit
// form, the API resolves the type's own friendly display name and stores
// that instead of an empty string. Because that resolved name is stored
// verbatim, optionalLabel()'s redundancy check on the read side recognises
// it as an exact match and correctly suppresses it as a duplicate — so a
// session created with no custom label never displays a stray secondary
// line.
export async function resolveTypeDisplayName(organisationId: string, slug: string): Promise<string> {
  try {
    const rows = await sql`
      SELECT name FROM session_types WHERE organisation_id = ${organisationId} AND slug = ${slug} LIMIT 1
    `
    if (rows[0]?.name) return rows[0].name as string
  } catch {
    // session_types may not exist yet (migration not applied) — fall through
  }
  return slug
}
