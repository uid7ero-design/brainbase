import { LegalDocument, LegalLink, LegalList, LegalSection } from '@/components/public/legal/LegalDocument';

export const metadata = {
  title: 'Terms of Use',
  description:
    'The website terms of use for Brainbase (trading as BRΛINBΛSE), covering use of thebrainbase.com.au.',
};

// Section titles, in order — drives the in-page contents list. Each must
// match a <LegalSection title> below (tests/components/public/LegalPages.test.tsx).
const SECTIONS = [
  '1. Acceptance of terms',
  '2. About the website',
  '3. Information only / no guaranteed availability',
  '4. Intellectual property',
  '5. Acceptable use',
  '6. Third-party links and services',
  '7. Demo and example data',
  '8. AI-generated and demo content',
  '9. Website availability',
  '10. Liability',
  '11. Privacy',
  '12. Changes to the website and these terms',
  '13. Governing law',
  '14. Contact',
];

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Use" lastUpdated="24 August 2026" sections={SECTIONS}>
      <LegalSection title="1. Acceptance of terms">
        <p>
          By accessing or using thebrainbase.com.au (the
          &quot;Website&quot;), you agree to these website Terms of Use.
          If you do not agree, please do not use the Website.
        </p>
      </LegalSection>

      <LegalSection title="2. About the website">
        <p>
          This Website is operated by Brainbase (ABN 32 207 559 504),
          trading as BRΛINBΛSE (&quot;we&quot;, &quot;us&quot;,
          &quot;our&quot;). It provides information about BRΛINBΛSE, an
          operational platform, including example content, demonstration
          environments, pricing information and a way to get in touch
          with us.
        </p>

        <p>
          These website Terms of Use apply only to your use of this
          Website. They are not the contract for paid BRΛINBΛSE
          services. Access to and use of the BRΛINBΛSE platform by
          customers is governed separately by an agreed proposal, quote,
          order form, BRΛINBΛSE Service Agreement, or other commercial
          terms agreed directly with the customer.
        </p>
      </LegalSection>

      <LegalSection title="3. Information only / no guaranteed availability">
        <p>
          Content on this Website — including feature descriptions,
          example configurations, and pricing — is provided for general
          information purposes and does not constitute a binding offer.
          The availability of specific capabilities may vary by
          deployment, configuration, or over time. We may update or
          change Website content at any time.
        </p>
      </LegalSection>

      <LegalSection title="4. Intellectual property">
        <p>
          The Website, including its design, text, graphics, the
          BRΛINBΛSE and HLNΛ names and marks, and underlying software,
          is owned by or licensed to Brainbase and protected by
          applicable intellectual property laws. You may not copy,
          reproduce or reuse Website content beyond your own personal,
          non-commercial reference, without our permission.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>You agree not to:</p>

        <LegalList
          items={[
            'Misuse the Website or attempt to gain unauthorised access to it',
            'Interfere with the security, integrity or normal functioning of the Website',
            'Use automated tools to scrape or extract Website content beyond standard search engine indexing',
            'Submit unlawful, harmful or misleading content through any form on the Website',
            'Misrepresent your identity or authority when submitting an enquiry',
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Third-party links and services">
        <p>
          The Website may link to or reference third-party websites and
          services. We do not control, and are not responsible for, the
          content, policies or practices of third-party sites.
        </p>
      </LegalSection>

      <LegalSection title="7. Demo and example data">
        <p>
          Any platform demonstration, dashboard or example environment
          shown on the Website uses simulated or example data unless
          otherwise stated. It is provided to illustrate how BRΛINBΛSE
          could be configured, and does not represent live production
          data, real customers, or a guarantee of identical functionality
          in every deployment.
        </p>
      </LegalSection>

      <LegalSection title="8. AI-generated and demo content">
        <p>
          Some content or responses shown on the Website, including
          demonstration HLNΛ interactions, may be generated or assisted
          by artificial intelligence and are provided for illustrative
          purposes. They should not be relied upon as professional,
          financial, legal or operational advice.
        </p>
      </LegalSection>

      <LegalSection title="9. Website availability">
        <p>
          We aim to keep the Website available and functioning correctly
          but do not guarantee uninterrupted or error-free access. The
          Website may be unavailable at times for maintenance, updates,
          or reasons outside our control.
        </p>
      </LegalSection>

      <LegalSection title="10. Liability">
        <p>
          To the maximum extent permitted by law, we exclude all
          liability for loss or damage arising from your use of, or
          inability to use, the Website. Nothing in these terms excludes,
          restricts or modifies any consumer guarantee, right or remedy
          under the Australian Consumer Law, or any other right that
          cannot lawfully be excluded, restricted or modified.
        </p>
      </LegalSection>

      <LegalSection title="11. Privacy">
        <p>
          Our collection and handling of personal information through
          the Website is described in our{' '}
          <LegalLink href="/privacy">
            Privacy Policy
          </LegalLink>
          .
        </p>
      </LegalSection>

      <LegalSection title="12. Changes to the website and these terms">
        <p>
          We may update the Website or these Terms of Use from time to
          time. Changes take effect once published. Continued use of the
          Website after changes are published constitutes acceptance of
          the updated terms.
        </p>
      </LegalSection>

      <LegalSection title="13. Governing law">
        <p>
          These terms are governed by the laws of South Australia,
          Australia, and you submit to the non-exclusive jurisdiction of
          the courts of South Australia.
        </p>
      </LegalSection>

      <LegalSection title="14. Contact">
        <p>
          For questions about these terms, contact Brainbase (trading as
          BRΛINBΛSE) at{' '}
          <LegalLink href="mailto:hello@thebrainbase.com.au">
            hello@thebrainbase.com.au
          </LegalLink>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
