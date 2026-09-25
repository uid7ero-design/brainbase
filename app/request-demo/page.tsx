'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';

import { BrainbaseLockup } from '@/components/public/BrainbaseLockup';
import { PublicFooter } from '@/components/public/PublicFooter';
import { ArrowIcon, ButtonLink } from '@/components/public/primitives';
import { FormField, SelectShell } from '@/components/public/request-demo/FormField';
import { Alert, LiveRegion } from '@/components/ui/semantic';
import publicStyles from '@/components/public/public.module.css';
import styles from '@/components/public/request-demo/requestDemo.module.css';

// Visual redesign only: the form's fields, values, validation, request
// (POST /api/request-demo with the whole form as JSON) and success/error
// handling are unchanged. Presentation moved to --bb-* tokens; labels are
// now programmatically associated, required fields are named in text, and
// the send / received transitions are announced politely.

const BUSINESS_TYPES = [
  'Professional Services',
  'Consulting',
  'Coaching & Training',
  'Health & Allied Health',
  'Fitness & Wellbeing',
  'Education & Tutoring',
  'Sport & Recreation',
  'Trades & Field Services',
  'Construction',
  'Transport & Logistics',
  'Waste & Environmental Services',
  'Local Government',
  'Facilities & Property',
  'Membership Organisation',
  'Other',
];

const TEAM_SIZES = [
  'Just me',
  '2–5',
  '6–15',
  '16–50',
  '51–100',
  '100+',
];

const CLIENT_RANGES = [
  'Under 25',
  '25–100',
  '101–500',
  '501–1,000',
  '1,000+',
  'Not applicable',
];

const STEPS = [
  "Tell us what's creating friction",
  'Tell us what systems you already rely on',
  "We'll discuss where BRΛINBΛSE could fit",
  'Start focused, expand later if needed',
];

const REQUIRED_MESSAGE = 'Name, email and organisation name are required.';

export default function RequestDemoPage() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    business_name: '',
    business_type: '',
    description: '',
    num_clients: '',
    num_users: '',
    goal: '',
    referral: '',
  });

  const [submitting, setSubmitting] =
    useState(false);

  const [done, setDone] =
    useState(false);

  const [error, setError] =
    useState('');

  const errorId = useId();
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the confirmation heading when the form is replaced.
  useEffect(() => {
    if (done) doneHeadingRef.current?.focus();
  }, [done]);

  function set(
    key: keyof typeof form,
  ) {
    return (
      e: React.ChangeEvent<
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
      >,
    ) =>
      setForm(current => ({
        ...current,
        [key]: e.target.value,
      }));
  }

  async function submit(
    e: React.FormEvent,
  ) {
    e.preventDefault();
    setError('');

    if (
      !form.name.trim() ||
      !form.email.trim() ||
      !form.business_name.trim()
    ) {
      setError(
        REQUIRED_MESSAGE,
      );

      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(
        '/api/request-demo',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify(form),
        },
      );

      if (!res.ok) {
        const result = await res
          .json()
          .catch(() => ({}));

        throw new Error(
          result.error ||
            'Something went wrong.',
        );
      }

      setDone(true);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Which required fields to flag while the "required" message is showing.
  const missing = error === REQUIRED_MESSAGE;
  const invalid = {
    name: missing && !form.name.trim(),
    email: missing && !form.email.trim(),
    business_name: missing && !form.business_name.trim(),
  };

  // Validation failures are routine, user-correctable feedback: announced
  // politely through the persistent live region (a region inserted together
  // with its text is not reliably read). A failed send is the one genuinely
  // critical state and keeps the interrupting alert below.
  const announcement = done
    ? 'Request received'
    : submitting
      ? 'Sending your request'
      : missing
        ? `Your request wasn't sent. ${error}`
        : '';

  return (
    <main className={`bb-public ${publicStyles.page}`}>
      <LiveRegion message={announcement} />

      <div className={styles.stage}>
        <div className={`${styles.backdrop} bb-grid-bg`} aria-hidden="true" />

        <div className={styles.shell}>
          <Link href="/" className={styles.back}>
            ← Back to BRΛINBΛSE
          </Link>

          {done ? (
            <section className={styles.done} aria-labelledby="request-done-title">
              <BrainbaseLockup idPrefix="bb-request-done-lockup" width={220} className={styles.lockupCentred} />

              <span className={styles.doneMark} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                  <path d="m5 12.5 4.2 4L19 7" />
                </svg>
              </span>

              <p className="bb-eyebrow">Request received</p>

              <h1
                id="request-done-title"
                ref={doneHeadingRef}
                tabIndex={-1}
                className={styles.doneTitle}
              >
                Thanks — we&apos;ve received
                your request.
              </h1>

              <p className={styles.doneBody}>
                We&apos;ll review what
                you&apos;re trying to
                improve and contact you to
                discuss where BRΛINBΛSE
                could fit.
              </p>

              <div className={styles.doneActions}>
                <ButtonLink href="/demo">Explore the platform</ButtonLink>
                <ButtonLink href="/" variant="secondary">
                  Back to BRΛINBΛSE
                </ButtonLink>
              </div>
            </section>
          ) : (
            <div className={styles.layout}>
              {/* Header */}
              <header className={styles.intro}>
                <BrainbaseLockup idPrefix="bb-request-lockup" width={200} className={styles.lockup} />

                <p className={`bb-eyebrow ${styles.eyebrow}`}>
                  <span className={styles.eyebrowDot} aria-hidden="true" />
                  Discuss your operation
                </p>

                <h1 className={styles.title}>
                  Tell us what you&apos;re
                  trying to improve.
                </h1>

                <p className={styles.lede}>
                  You don&apos;t need to know
                  exactly how BRΛINBΛSE
                  should be configured. Tell
                  us where the friction is,
                  what you use today and
                  what you want to improve —
                  we can help identify the
                  right starting point.
                </p>

                {/* How this works */}
                <div className={styles.how}>
                  <h2 className={styles.howTitle}>
                    Start with the problem, not the software.
                  </h2>

                  <ol className={styles.steps}>
                    {STEPS.map((point, index) => (
                      <li key={point} className={styles.step}>
                        <span className={styles.stepIndex} aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ol>

                  <p className={styles.howNote}>
                    BRΛINBΛSE can work alongside external
                    systems where it makes sense.
                  </p>
                </div>
              </header>

              {/* Form */}
              <form onSubmit={submit} className={styles.form} aria-label="Demo request">
                {/* Contact */}
                <fieldset className={styles.group}>
                  <legend className={`bb-eyebrow ${styles.legend}`}>
                    Your details
                  </legend>

                  <div className={styles.grid}>
                    <FormField label="Full name" required invalid={invalid.name} errorId={errorId}>
                      {control => (
                        <input
                          {...control}
                          className={styles.input}
                          autoComplete="name"
                          value={form.name}
                          onChange={set('name')}
                          placeholder="Jane Smith"
                        />
                      )}
                    </FormField>

                    <FormField label="Work email" required invalid={invalid.email} errorId={errorId}>
                      {control => (
                        <input
                          {...control}
                          className={styles.input}
                          type="email"
                          autoComplete="email"
                          value={form.email}
                          onChange={set('email')}
                          placeholder="jane@business.com.au"
                        />
                      )}
                    </FormField>
                  </div>

                  <FormField label="Phone">
                    {control => (
                      <input
                        {...control}
                        className={styles.input}
                        type="tel"
                        autoComplete="tel"
                        value={form.phone}
                        onChange={set('phone')}
                        placeholder="+61 4xx xxx xxx"
                      />
                    )}
                  </FormField>
                </fieldset>

                {/* Organisation */}
                <fieldset className={styles.group}>
                  <legend className={`bb-eyebrow ${styles.legend}`}>
                    Your organisation
                  </legend>

                  <div className={styles.grid}>
                    <FormField
                      label="Organisation / Business name"
                      required
                      invalid={invalid.business_name}
                      errorId={errorId}
                    >
                      {control => (
                        <input
                          {...control}
                          className={styles.input}
                          autoComplete="organization"
                          value={form.business_name}
                          onChange={set('business_name')}
                          placeholder="Your organisation"
                        />
                      )}
                    </FormField>

                    <FormField label="Organisation type">
                      {control => (
                        <SelectShell>
                          <select
                            {...control}
                            className={styles.select}
                            value={form.business_type}
                            onChange={set('business_type')}
                          >
                            <option value="">
                              Select type…
                            </option>

                            {BUSINESS_TYPES.map(type => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </SelectShell>
                      )}
                    </FormField>
                  </div>

                  <FormField
                    label="Tell us about your operation"
                    helper="A few sentences is enough. Include any systems or tools you currently rely on, if relevant."
                  >
                    {control => (
                      <textarea
                        {...control}
                        className={styles.textarea}
                        value={form.description}
                        onChange={set('description')}
                        placeholder="What does your organisation do, and how are you managing the work today?"
                        rows={4}
                      />
                    )}
                  </FormField>

                  <div className={styles.grid}>
                    <FormField label="Clients / Customers">
                      {control => (
                        <SelectShell>
                          <select
                            {...control}
                            className={styles.select}
                            value={form.num_clients}
                            onChange={set('num_clients')}
                          >
                            <option value="">
                              Select range…
                            </option>

                            {CLIENT_RANGES.map(range => (
                              <option key={range} value={range}>
                                {range}
                              </option>
                            ))}
                          </select>
                        </SelectShell>
                      )}
                    </FormField>

                    <FormField label="Team / Users">
                      {control => (
                        <SelectShell>
                          <select
                            {...control}
                            className={styles.select}
                            value={form.num_users}
                            onChange={set('num_users')}
                          >
                            <option value="">
                              Select size…
                            </option>

                            {TEAM_SIZES.map(size => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                        </SelectShell>
                      )}
                    </FormField>
                  </div>
                </fieldset>

                {/* Goals */}
                <fieldset className={styles.group}>
                  <legend className={`bb-eyebrow ${styles.legend}`}>
                    Where would you like BRΛINBΛSE to help first?
                  </legend>

                  <FormField
                    label="What would you most like to improve?"
                    helper="For example: lead follow-up, scheduling, client visibility, reporting, disconnected systems, website enquiries or manual admin."
                  >
                    {control => (
                      <textarea
                        {...control}
                        className={styles.textarea}
                        value={form.goal}
                        onChange={set('goal')}
                        placeholder="Tell us where the current process is creating work, gaps or frustration."
                        rows={4}
                      />
                    )}
                  </FormField>

                  <FormField label="How did you hear about BRΛINBΛSE?">
                    {control => (
                      <input
                        {...control}
                        className={styles.input}
                        value={form.referral}
                        onChange={set('referral')}
                        placeholder="Google, referral, LinkedIn, word of mouth…"
                      />
                    )}
                  </FormField>
                </fieldset>

                <p className={styles.privacy}>
                  Brainbase (ABN 32 207 559 504),
                  trading as BRΛINBΛSE, collects
                  the information in this form so we
                  can review your enquiry, contact
                  you and discuss where BRΛINBΛSE
                  may fit your operation. We may use
                  service providers to host and
                  process this information. Enquiry
                  information may be retained for up
                  to 24 months unless it becomes
                  part of an ongoing customer
                  relationship or is required for
                  another lawful purpose. Submitting
                  this form does not subscribe you
                  to marketing. See our{' '}
                  <Link href="/privacy" className={styles.inlineLink}>
                    Privacy Policy
                  </Link>{' '}
                  for details.
                </p>

                {error && (
                  <Alert
                    state="error"
                    urgency={missing ? 'static' : 'critical'}
                    title="Your request wasn't sent"
                    className={styles.error}
                  >
                    <span id={errorId}>{error}</span>
                  </Alert>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className={styles.submit}
                >
                  {submitting ? (
                    'Sending…'
                  ) : (
                    <>
                      Discuss my operation
                      <ArrowIcon className={styles.submitArrow} />
                    </>
                  )}
                </button>

                <p className={styles.reassure}>
                  You don&apos;t need the whole
                  platform on day one — BRΛINBΛSE
                  can begin with the part of the
                  operation that matters most and
                  expand as requirements grow.
                  <br />
                  No obligation. We&apos;ll
                  review your request and
                  contact you to discuss the
                  right next step.
                </p>
              </form>
            </div>
          )}
        </div>
      </div>

      <PublicFooter />
    </main>
  );
}
