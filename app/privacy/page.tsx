import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy',
  description:
    'How Brainbase (trading as BRΛINBΛSE) collects, uses and protects information across our website and platform.',
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

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>

          <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,.35)' }}>
            Last updated: 24 August 2026
          </p>
        </div>

        <Section title="1. About this policy">
          <p style={{ margin: 0 }}>
            This Privacy Policy explains how Brainbase (ABN 32 207 559 504),
            trading as BRΛINBΛSE (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;),
            collects, uses, stores and protects information in connection
            with our website and the BRΛINBΛSE platform. It applies to
            visitors to our website, people who submit enquiries, and
            organisations and individuals who use BRΛINBΛSE. We are
            committed to responsible privacy handling and apply privacy
            practices designed around the Australian Privacy Principles and
            applicable privacy law.
          </p>
        </Section>

        <Section title="2. What information we may collect">
          <p style={{ margin: 0 }}>
            Depending on the services or configuration used, we may
            collect information including:
          </p>

          <List
            items={[
              'Name, email address and phone number',
              'Organisation or business details and role/job information',
              'Client or customer records held within a BRΛINBΛSE deployment',
              'Appointment or booking information',
              'Addresses',
              'Employee or workforce information',
              'Business, financial or operational information',
              'Uploaded files or spreadsheets',
              'IP address, device, browser and security/log information',
              'Connected account or integration information',
              'Communications you send to us',
              'Information submitted through website forms',
              <span key="minors">
                In some customer configurations, limited information
                relating to minors — see &quot;Children and minors&quot;
                below
              </span>,
            ]}
          />

          <p style={{ margin: '10px 0 0' }}>
            Not every category applies to every visitor, enquiry or
            customer. The information we actually collect depends on how
            you interact with our website, and which BRΛINBΛSE
            capabilities and configuration your organisation uses.
          </p>
        </Section>

        <Section title="3. How we collect information">
          <List
            items={[
              'Directly from you — for example through website forms, account setup, or when you contact us',
              'Automatically through your use of our website or platform, such as technical and log information',
              "From your organisation's authorised users, where BRΛINBΛSE is used to manage information about clients, customers or workforce",
              'From third-party systems your organisation chooses to connect to BRΛINBΛSE',
            ]}
          />
        </Section>

        <Section title="4. Why we use information">
          <List
            items={[
              'To provide, operate, support and improve BRΛINBΛSE',
              'To respond to enquiries and provide customer support',
              'To authenticate users and maintain access controls',
              'To communicate with you about your account or enquiry',
              'To meet legal, security and regulatory obligations',
              'To detect, investigate and help prevent misuse, fraud or security incidents',
            ]}
          />
        </Section>

        <Section title="5. Customer Data">
          <p style={{ margin: 0 }}>
            Where an organisation uses BRΛINBΛSE, the information that
            organisation or its authorised users submit, upload or generate
            while using the platform (&quot;Customer Data&quot;) belongs to
            the customer. BRΛINBΛSE receives only the rights necessary to
            host and process Customer Data as reasonably necessary to
            provide the service. We do not claim ownership of Customer
            Data.
          </p>
        </Section>

        <Section title="6. AI-assisted features">
          <List
            items={[
              'Approved AI service providers may process information where required to provide AI-assisted features',
              'Customer Data is not used by BRΛINBΛSE to train general-purpose AI models unless the customer explicitly agrees',
              'AI-assisted features may involve information being processed by third-party and/or overseas service providers',
              'We recommend sensitive information is not unnecessarily submitted to AI features',
              'AI-assisted features are intended to support and inform decisions, not replace human judgement',
            ]}
          />
        </Section>

        <Section title="7. Third-party service providers">
          <p style={{ margin: 0 }}>
            We use a limited set of service providers to help us operate
            our website and the BRΛINBΛSE platform, which may process
            information on our behalf, including:
          </p>

          <List
            items={[
              'Vercel — website and application hosting',
              'Neon — database hosting',
              'Microsoft 365 — business email and productivity tools',
              'Resend — transactional email delivery',
              'Google — supporting services where used',
              'Approved AI service providers — to power AI-assisted features',
              'Other infrastructure providers, such as AWS and domain/DNS providers, where applicable',
            ]}
          />

          <p style={{ margin: '10px 0 0' }}>
            Each provider processes information under their own applicable
            terms. We have not independently verified every specific
            processing region or contractual safeguard used by each
            provider, and we do not represent that this list is exhaustive
            or that it will not change over time.
          </p>
        </Section>

        <Section title="8. Overseas processing">
          <p style={{ margin: 0 }}>
            Some of our service providers, including cloud hosting, email
            and AI service providers, may store or process information
            outside Australia. Where this occurs, we work with providers we
            consider reputable, but we do not guarantee that all
            processing occurs within Australia, and we do not claim that
            external AI providers never receive customer information —
            they may receive information reasonably necessary to deliver
            the AI-assisted feature being used.
          </p>
        </Section>

        <Section title="9. Website enquiries and marketing">
          <p style={{ margin: 0 }}>
            Information submitted through our Request Demo form or other
            enquiry channels is used to review and respond to your
            enquiry. Enquiry information may generally be retained for up
            to 24 months unless it becomes part of an ongoing customer
            relationship, longer retention is legally required, or you
            request earlier deletion where applicable.
          </p>

          <p style={{ margin: '10px 0 0' }}>
            Submitting an enquiry does not automatically subscribe you to
            newsletters, sales mailing lists, SMS marketing, or
            product-marketing lists. If we introduce marketing
            communications in future, they will have their own consent and
            unsubscribe process.
          </p>
        </Section>

        <Section title="10. Children and minors">
          <p style={{ margin: 0 }}>
            In some customer configurations, BRΛINBΛSE may hold limited
            information relating to minors — for example, a child or
            player&apos;s name and age (such as in a coaching or club
            deployment). Other contact and account information should
            ordinarily relate to the parent or legal guardian rather than
            the minor.
          </p>

          <p style={{ margin: '10px 0 0' }}>
            BRΛINBΛSE is not designed to store medical records, sensitive
            child-protection records, health records, education records,
            biometric data or government identifiers, and we do not hold
            or claim any specialised child-safety or healthcare compliance
            certification.
          </p>
        </Section>

        <Section title="11. Security">
          <p style={{ margin: 0 }}>
            We apply a number of security measures designed to protect
            information, including:
          </p>

          <List
            items={[
              'HTTPS/TLS encryption for data in transit',
              'Password hashing using bcrypt',
              'Multi-tenant organisation separation',
              'Role-based access controls',
              'Server-side authentication and authorisation controls',
              "Neon's point-in-time database recovery capability",
            ]}
          />

          <p style={{ margin: '10px 0 0' }}>
            We continue to strengthen additional controls over time,
            including broader server-side capability enforcement and audit
            logging. No method of transmission or storage is completely
            secure, and we cannot guarantee absolute security.
          </p>
        </Section>

        <Section title="12. Data retention">
          <p style={{ margin: 0 }}>
            Where a customer&apos;s account or service is terminated, the
            customer may request an export of Customer Data before
            termination. Customer Data may then be retained for up to 30
            days after termination to support export, recovery, transition
            or account closure, and is then deleted or de-identified,
            unless legal, security, dispute or regulatory obligations
            require it to be retained for longer. Backups may persist for
            their normal lifecycle before expiring or being deleted.
          </p>

          <p style={{ margin: '10px 0 0' }}>
            Website enquiry and demo request information is retained as
            described in &quot;Website enquiries and marketing&quot; above.
          </p>
        </Section>

        <Section title="13. Access, correction and deletion requests">
          <p style={{ margin: 0 }}>
            Regardless of the specific legal thresholds that may apply to
            our business at a given time, we aim to support reasonable
            requests to:
          </p>

          <List
            items={[
              'Access the personal information we hold about you',
              'Request correction of inaccurate information',
              'Request deletion of your personal information, subject to the retention obligations described above',
              'Ask questions about how your information is handled',
            ]}
          />

          <p style={{ margin: '10px 0 0' }}>
            To make a request, contact us at{' '}
            <a href="mailto:hello@thebrainbase.com.au" style={linkStyle}>
              hello@thebrainbase.com.au
            </a>
            . If you are not satisfied with our response, you may lodge a
            complaint with the Office of the Australian Information
            Commissioner (OAIC).
          </p>
        </Section>

        <Section title="14. Data breaches and security incidents">
          <p style={{ margin: 0 }}>
            We have processes in place to help us identify, assess and
            respond to suspected data breaches or security incidents,
            including containment and, where required by law, notifying
            affected individuals and/or the OAIC.
          </p>
        </Section>

        <Section title="15. Cookies and analytics">
          <p style={{ margin: 0 }}>
            Our website may use essential technical and session cookies
            necessary for core functionality, such as keeping you signed
            in. We currently use Microsoft Clarity, a session-analytics
            tool, to help us understand how our website is used and to
            improve it; Clarity may set cookies or use similar
            technologies and may process technical usage information. Our
            hosting and security providers may also process technical
            metadata as part of operating our website. We do not currently
            rely on a dedicated marketing or advertising analytics
            platform, though this may change in future, in which case
            this policy will be updated.
          </p>
        </Section>

        <Section title="16. Changes to this policy">
          <p style={{ margin: 0 }}>
            We may update this Privacy Policy from time to time. Material
            changes will be reflected by an updated &quot;Last
            updated&quot; date above. Continued use of our website or the
            BRΛINBΛSE platform after changes take effect constitutes
            acceptance of the updated policy.
          </p>
        </Section>

        <Section title="17. Contact">
          <p style={{ margin: 0 }}>
            For privacy enquiries, contact Brainbase (trading as
            BRΛINBΛSE) at{' '}
            <a href="mailto:hello@thebrainbase.com.au" style={linkStyle}>
              hello@thebrainbase.com.au
            </a>
            . Brainbase is based in South Australia, Australia.
          </p>
        </Section>
      </div>
    </div>
  );
}
