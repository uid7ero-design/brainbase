import 'server-only'
import { Resend } from 'resend'

// Lazily constructs (and memoizes) the Resend SDK client on first actual
// use inside a request — never at module import time. Several API routes
// used to do `const resend = new Resend(process.env.RESEND_API_KEY)` at
// module scope, which throws ("Missing API key") the instant the module
// is loaded if the key isn't set — and Next.js loads route modules during
// the build's route-collection step, not just at request time. Vercel
// Preview environments don't have RESEND_API_KEY configured; Production
// does. That mismatch is what broke every Preview build.
//
// This is deliberately separate from lib/email.ts's sendEmail() helper,
// not a duplicate of it: sendEmail() calls Resend's REST API directly via
// fetch() (no SDK, no client object) for the simpler from/to/subject/html
// case used by auth and web-service-lead emails. The routes this helper
// serves need the SDK's replyTo option and a different sender address, so
// they construct a Resend client — this just makes that construction lazy
// and shared, rather than four separate module-scope instantiations.
let client: Resend | null | undefined

export function getResendClient(): Resend | null {
  if (client !== undefined) return client
  const apiKey = process.env.RESEND_API_KEY
  client = apiKey ? new Resend(apiKey) : null
  return client
}
