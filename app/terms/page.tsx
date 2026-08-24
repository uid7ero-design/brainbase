import Link from 'next/link';

export const metadata = {
  title: 'Terms of Use',
  description:
    'The website terms of use for Brainbase (trading as BRΛINBΛSE), covering use of thebrainbase.com.au.',
};

const FONT =
  'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 34 }}>
      <h2
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: '#F5F7FA',
          margin: '0 0 10px',
          letterSpacing: '-.01em',
        }}
      >
        {title}
      </h2>

      <div
        style={{
          fontSize: 13.5,
          color: 'rgba(226,232,240,.62)',
          lineHeight: 1.75,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul
      style={{
        margin: '10px 0 0',
        paddingLeft: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

const linkStyle = { color: '#A78BFA' };

export default function TermsPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#07080B',
        color: '#F5F7FA',
        fontFamily: FONT,
        padding: '48px 24px 90px',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Link
          href="/"
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,.34)',
            textDecoration: 'none',
          }}
        >
          ← Back to BRΛINBΛSE
        </Link>

        <div style={{ marginTop: 30, marginBottom: 40 }}>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 700,
              margin: '0 0 8px',
              letterSpacing: '-.03em',
            }}
          >
            Terms of Use
          </h1>

          <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,.35)' }}>
            Last updated: 24 August 2026
          </p>
        </div>

        <Section title="1. Acceptance of terms">
          <p style={{ margin: 0 }}>
            By accessing or using thebrainbase.com.au (the
            &quot;Website&quot;), you agree to these website Terms of Use.
            If you do not agree, please do not use the Website.
          </p>
        </Section>

        <Section title="2. About the website">
          <p style={{ margin: 0 }}>
            This Website is operated by Brainbase (ABN 32 207 559 504),
            trading as BRΛINBΛSE (&quot;we&quot;, &quot;us&quot;,
            &quot;our&quot;). It provides information about BRΛINBΛSE, an
            operational platform, including example content, demonstration
            environments, pricing information and a way to get in touch
            with us.
          </p>

          <p style={{ margin: '10px 0 0' }}>
            These website Terms of Use apply only to your use of this
            Website. They are not the contract for paid BRΛINBΛSE
            services. Access to and use of the BRΛINBΛSE platform by
            customers is governed separately by an agreed proposal, quote,
            order form, BRΛINBΛSE Service Agreement, or other commercial
            terms agreed directly with the customer.
          </p>
        </Section>

        <Section title="3. Information only / no guaranteed availability">
          <p style={{ margin: 0 }}>
            Content on this Website — including feature descriptions,
            example configurations, and pricing — is provided for general
            information purposes and does not constitute a binding offer.
            The availability of specific capabilities may vary by
            deployment, configuration, or over time. We may update or
            change Website content at any time.
          </p>
        </Section>

        <Section title="4. Intellectual property">
          <p style={{ margin: 0 }}>
            The Website, including its design, text, graphics, the
            BRΛINBΛSE and HLNΛ names and marks, and underlying software,
            is owned by or licensed to Brainbase and protected by
            applicable intellectual property laws. You may not copy,
            reproduce or reuse Website content beyond your own personal,
            non-commercial reference, without our permission.
          </p>
        </Section>

        <Section title="5. Acceptable use">
          <p style={{ margin: 0 }}>You agree not to:</p>

          <List
            items={[
              'Misuse the Website or attempt to gain unauthorised access to it',
              'Interfere with the security, integrity or normal functioning of the Website',
              'Use automated tools to scrape or extract Website content beyond standard search engine indexing',
              'Submit unlawful, harmful or misleading content through any form on the Website',
              'Misrepresent your identity or authority when submitting an enquiry',
            ]}
          />
        </Section>

        <Section title="6. Third-party links and services">
          <p style={{ margin: 0 }}>
            The Website may link to or reference third-party websites and
            services. We do not control, and are not responsible for, the
            content, policies or practices of third-party sites.
          </p>
        </Section>

        <Section title="7. Demo and example data">
          <p style={{ margin: 0 }}>
            Any platform demonstration, dashboard or example environment
            shown on the Website uses simulated or example data unless
            otherwise stated. It is provided to illustrate how BRΛINBΛSE
            could be configured, and does not represent live production
            data, real customers, or a guarantee of identical functionality
            in every deployment.
          </p>
        </Section>

        <Section title="8. AI-generated and demo content">
          <p style={{ margin: 0 }}>
            Some content or responses shown on the Website, including
            demonstration HLNΛ interactions, may be generated or assisted
            by artificial intelligence and are provided for illustrative
            purposes. They should not be relied upon as professional,
            financial, legal or operational advice.
          </p>
        </Section>

        <Section title="9. Website availability">
          <p style={{ margin: 0 }}>
            We aim to keep the Website available and functioning correctly
            but do not guarantee uninterrupted or error-free access. The
            Website may be unavailable at times for maintenance, updates,
            or reasons outside our control.
          </p>
        </Section>

        <Section title="10. Liability">
          <p style={{ margin: 0 }}>
            To the maximum extent permitted by law, we exclude all
            liability for loss or damage arising from your use of, or
            inability to use, the Website. Nothing in these terms excludes,
            restricts or modifies any consumer guarantee, right or remedy
            under the Australian Consumer Law, or any other right that
            cannot lawfully be excluded, restricted or modified.
          </p>
        </Section>

        <Section title="11. Privacy">
          <p style={{ margin: 0 }}>
            Our collection and handling of personal information through
            the Website is described in our{' '}
            <Link href="/privacy" style={linkStyle}>
              Privacy Policy
            </Link>
            .
          </p>
        </Section>

        <Section title="12. Changes to the website and these terms">
          <p style={{ margin: 0 }}>
            We may update the Website or these Terms of Use from time to
            time. Changes take effect once published. Continued use of the
            Website after changes are published constitutes acceptance of
            the updated terms.
          </p>
        </Section>

        <Section title="13. Governing law">
          <p style={{ margin: 0 }}>
            These terms are governed by the laws of South Australia,
            Australia, and you submit to the non-exclusive jurisdiction of
            the courts of South Australia.
          </p>
        </Section>

        <Section title="14. Contact">
          <p style={{ margin: 0 }}>
            For questions about these terms, contact Brainbase (trading as
            BRΛINBΛSE) at{' '}
            <a href="mailto:hello@thebrainbase.com.au" style={linkStyle}>
              hello@thebrainbase.com.au
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
