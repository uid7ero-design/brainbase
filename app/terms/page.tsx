import Link from 'next/link';

export const metadata = { title: 'Terms of Service — Brainbase' };

const FONT = "var(--font-inter), -apple-system, sans-serif";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#F4F4F5', margin: '0 0 10px', letterSpacing: '-0.01em' }}>{title}</h2>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.60)', lineHeight: 1.75 }}>{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#08090C', color: '#F4F4F5', fontFamily: FONT, padding: '48px 24px 80px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          ← Back
        </Link>

        <div style={{ marginTop: 32, marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>Terms of Service</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Last updated: 29 April 2026</p>
        </div>

        <Section title="1. Acceptance of Terms">
          By accessing or using Brainbase ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. These terms apply to all users, administrators, and organisations using the platform.
        </Section>

        <Section title="2. Description of Service">
          Brainbase is a voice-first AI command centre for municipal council operations. The Service provides dashboards, data analysis, integrations, and AI-powered insights for operational data including waste management, fleet operations, and service delivery. Access is granted to verified organisations only.
        </Section>

        <Section title="3. Authorised Use">
          <p style={{ margin: '0 0 10px' }}>The Service is provided for authorised operational use within your organisation. You agree to:</p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Use the Service only for lawful purposes and in accordance with these Terms</li>
            <li>Maintain the confidentiality of login credentials and not share them with unauthorised persons</li>
            <li>Not attempt to access data belonging to other organisations</li>
            <li>Not use the Service to upload unlawful, harmful, or malicious content</li>
            <li>Not attempt to reverse-engineer, decompile, or circumvent security controls</li>
          </ul>
        </Section>

        <Section title="4. Data and Privacy">
          Operational data uploaded to the Service is stored securely and scoped to your organisation. We do not sell or share your operational data with third parties except as required by law or to provide the Service (including AI processing via Anthropic). Please review our <Link href="/privacy" style={{ color: '#A78BFA' }}>Privacy Policy</Link> for full details.
        </Section>

        <Section title="5. AI-Generated Content">
          The Service uses artificial intelligence to generate insights, summaries, and recommendations. AI-generated content is provided for informational purposes only and should not be relied upon as the sole basis for operational or financial decisions. You remain responsible for verifying AI-generated outputs against source data.
        </Section>

        <Section title="6. Intellectual Property">
          The Service, including its software, design, and proprietary algorithms, is owned by Brainbase and protected by applicable intellectual property laws. Uploading data to the Service does not transfer ownership of that data to Brainbase. You retain all rights to your operational data.
        </Section>

        <Section title="7. Service Availability">
          We aim to provide continuous availability but do not guarantee uninterrupted access. Scheduled maintenance, infrastructure updates, or circumstances beyond our control may cause downtime. We will communicate planned maintenance in advance where possible.
        </Section>

        <Section title="8. Limitation of Liability">
          To the fullest extent permitted by law, Brainbase shall not be liable for indirect, incidental, special, or consequential damages arising from your use of the Service, including reliance on AI-generated insights. Our total liability shall not exceed the fees paid by your organisation in the preceding three months.
        </Section>

        <Section title="9. Termination">
          We reserve the right to suspend or terminate access to the Service for any organisation that breaches these Terms, upon reasonable notice where practicable. You may terminate your organisation's access at any time by contacting us.
        </Section>

        <Section title="10. Changes to Terms">
          We may update these Terms from time to time. We will notify administrators of material changes by email or in-app notice. Continued use of the Service after changes take effect constitutes acceptance.
        </Section>

        <Section title="11. Governing Law">
          These Terms are governed by the laws of South Australia, Australia. Any disputes shall be subject to the exclusive jurisdiction of the courts of South Australia.
        </Section>

        <Section title="12. Contact">
          For questions about these Terms, contact us at <a href="mailto:legal@brainbase.app" style={{ color: '#A78BFA' }}>legal@brainbase.app</a>.
        </Section>

      </div>
    </div>
  );
}
