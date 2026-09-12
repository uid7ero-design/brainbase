import { neon } from '@neondatabase/serverless';

// C6.9 TEMPORARY — narrow, branch-scoped database-target override.
//
// Root cause this exists for: Vercel's Neon Preview integration
// dynamically (re)injects its own auto-provisioned, Production-derived
// branch DATABASE_URL for every Preview deployment on this project —
// confirmed via the temporary app/api/health/db-identity diagnostic
// route, which proved feat/c6-9-purchasing-remediation's Preview
// deployment was querying that Production-derived branch DB even after
// DATABASE_URL was manually edited in the Vercel dashboard. The
// integration re-asserts its managed value, so editing DATABASE_URL
// itself is not viable for this one branch's certification without
// disconnecting the integration for the whole project — explicitly
// ruled out (other Preview branches depend on it).
//
// This override is scoped as narrowly as the Vercel runtime allows:
//   - VERCEL_ENV must be exactly 'preview' (never true in Production or
//     local dev, where VERCEL_ENV is 'production' or unset respectively)
//   - VERCEL_GIT_COMMIT_REF (Vercel's own system env var carrying the
//     deploying git branch name) must be exactly this one branch name
//   - C69_CERT_DATABASE_URL (a plain env var the Neon integration does
//     not know about and therefore never overwrites) must actually be
//     set — if it is not, this falls back to DATABASE_URL exactly as
//     before, never throws, never breaks a build missing the override
//
// Every other case — Production, local dev, and every other Preview
// branch, even if C69_CERT_DATABASE_URL somehow leaked into their
// environment — resolves to the original, unchanged `DATABASE_URL`
// behavior. Neither connection string is ever logged, and this module
// exports nothing but the already-constructed `sql` client — the raw
// strings never leave this file.
//
// TEMPORARY: revert to `const sql = neon(process.env.DATABASE_URL!);`
// once C6.9's isolated-Preview certification is complete.
const isC69CertificationPreview =
  process.env.VERCEL_ENV === 'preview' &&
  process.env.VERCEL_GIT_COMMIT_REF === 'feat/c6-9-purchasing-remediation';

const connectionString =
  isC69CertificationPreview && process.env.C69_CERT_DATABASE_URL
    ? process.env.C69_CERT_DATABASE_URL
    : process.env.DATABASE_URL;

const sql = neon(connectionString!);
export default sql;
