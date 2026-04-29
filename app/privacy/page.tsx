import Link from 'next/link';

export const metadata = { title: 'Privacy Policy — Brainbase' };

const FONT = "var(--font-inter), -apple-system, sans-serif";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#F4F4F5', margin: '0 0 10px', letterSpacing: '-0.01em' }}>{title}</h2>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.60)', lineHeight: 1.75 }}>{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#08090C', color: '#F4F4F5', fontFamily: FONT, padding: '48px 24px 80px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          ← Back
        </Link>

        <div style={{ marginTop: 32, marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>Privacy Policy</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Last updated: 29 April 2026</p>
        </div>

        <Section title="1. Overview">
          Brainbase ("we", "us", "our") operates a voice-first AI operations platform for municipal councils and similar organisations. This Privacy Policy explains how we collect, use, store, and protect information when you use the Service. We are committed to handling all data in accordance with applicable privacy legislation, including the Australian Privacy Act 1988 and the Australian Privacy Principles.
        </Section>

        <Section title="2. Information We Collect">
          <p style={{ margin: '0 0 10px' }}>We collect and process the following categories of information:</p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li><strong style={{ color: '#F4F4F5' }}>Account information:</strong> Username, hashed password, name, and email address of platform users.</li>
            <li><strong style={{ color: '#F4F4F5' }}>Operational data:</strong> Data uploaded by your organisation including waste metrics, fleet records, and service request data.</li>
            <li><strong style={{ color: '#F4F4F5' }}>Usage data:</strong> Session activity, dashboard interactions, and AI query history for the purpose of service improvement and auditing.</li>
            <li><strong style={{ color: '#F4F4F5' }}>Integration data:</strong> Configuration and data retrieved from connected external systems, scoped to your organisation.</li>
          </ul>
        </Section>

        <Section title="3. How We Use Your Information">
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>To authenticate users and enforce role-based access controls</li>
            <li>To provide operational dashboards, AI insights, and reporting functionality</li>
            <li>To process voice and text queries through our AI engine (HLNA)</li>
            <li>To sync data via configured integrations and generate trend analysis</li>
            <li>To maintain audit logs for compliance and security purposes</li>
            <li>To improve and develop the Service</li>
          </ul>
        </Section>

        <Section title="4. AI Processing">
          The Service uses Anthropic's Claude AI models to generate insights, answers, and recommendations from your operational data. When you interact with HLNA, relevant data context may be included in prompts sent to Anthropic's API. Anthropic processes this data under their own privacy terms. We minimise the data sent to AI models and do not include personally identifiable employee data beyond what is necessary for the query.
        </Section>

        <Section title="5. Data Storage and Security">
          <p style={{ margin: '0 0 10px' }}>All data is stored in encrypted PostgreSQL databases hosted on Neon (a Vercel-affiliated cloud provider). We implement the following security controls:</p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Passwords are hashed using bcrypt with a cost factor of 12 — plaintext passwords are never stored</li>
            <li>Sessions are managed via HS256-signed JWTs stored in httpOnly, SameSite cookies</li>
            <li>All data is scoped to organisation identifiers — cross-tenant access is prevented at the query level</li>
            <li>All API routes require an authenticated session with a valid organisation ID</li>
            <li>File uploads are limited to 10 MB and validated for permitted formats</li>
          </ul>
        </Section>

        <Section title="6. Data Sharing">
          <p style={{ margin: '0 0 10px' }}>We do not sell your data. We share data only in these circumstances:</p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li><strong style={{ color: '#F4F4F5' }}>Service providers:</strong> Neon (database), Vercel (hosting), Anthropic (AI), ElevenLabs (voice synthesis), Spotify (optional music integration). Each is bound by their own data processing terms.</li>
            <li><strong style={{ color: '#F4F4F5' }}>Legal requirements:</strong> Where required by law, court order, or regulatory authority.</li>
            <li><strong style={{ color: '#F4F4F5' }}>Business transfers:</strong> In the event of a merger or acquisition, data may transfer subject to equivalent protections.</li>
          </ul>
        </Section>

        <Section title="7. Data Retention">
          Operational data is retained for the duration of your organisation's subscription and for a 90-day grace period following termination. Audit logs are retained for 12 months. You may request deletion of your organisation's data at any time by contacting us.
        </Section>

        <Section title="8. Your Rights">
          <p style={{ margin: '0 0 10px' }}>Under applicable privacy laws, you have the right to:</p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Access the personal information we hold about you</li>
            <li>Request correction of inaccurate information</li>
            <li>Request deletion of your personal information</li>
            <li>Object to or restrict certain processing activities</li>
            <li>Lodge a complaint with the Office of the Australian Information Commissioner (OAIC)</li>
          </ul>
          <p style={{ margin: '10px 0 0' }}>To exercise these rights, contact us at <a href="mailto:privacy@brainbase.app" style={{ color: '#A78BFA' }}>privacy@brainbase.app</a>.</p>
        </Section>

        <Section title="9. Cookies">
          We use a single session cookie to authenticate users. This cookie is httpOnly, secure in production, and expires after 7 days. We do not use advertising or third-party tracking cookies.
        </Section>

        <Section title="10. Changes to This Policy">
          We may update this Privacy Policy periodically. Material changes will be communicated to organisation administrators by email. Continued use of the Service after updates constitutes acceptance of the revised policy.
        </Section>

        <Section title="11. Contact">
          For privacy enquiries, contact us at <a href="mailto:privacy@brainbase.app" style={{ color: '#A78BFA' }}>privacy@brainbase.app</a> or at Brainbase, Adelaide, South Australia, Australia.
        </Section>

      </div>
    </div>
  );
}
