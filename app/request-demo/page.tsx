'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark';

const FONT =
  'var(--font-inter), "Inter", -apple-system, sans-serif';

const BG = '#07080B';

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

function Field({
  label,
  required,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 20,
      }}
    >
      <label
        style={{
          display: 'block',
          marginBottom: 7,
          fontSize: 11,
          fontWeight: 650,
          letterSpacing: '.025em',
          color:
            'rgba(226,232,240,.60)',
        }}
      >
        {label}

        {required && (
          <span
            style={{
              color: '#A78BFA',
              marginLeft: 3,
            }}
          >
            *
          </span>
        )}
      </label>

      {children}

      {helper && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            lineHeight: 1.5,
            color:
              'rgba(255,255,255,.24)',
          }}
        >
          {helper}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '11px 13px',
  borderRadius: 9,
  border:
    '1px solid rgba(255,255,255,.09)',
  background:
    'rgba(255,255,255,.035)',
  color: '#F1F5F9',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  transition:
    'border-color .15s, box-shadow .15s, background .15s',
};

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

  const [focusField, setFocusField] =
    useState<string | null>(null);

  const [submitting, setSubmitting] =
    useState(false);

  const [done, setDone] =
    useState(false);

  const [error, setError] =
    useState('');

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

  function focusStyle(
    name: string,
  ): React.CSSProperties {
    const active =
      focusField === name;

    return {
      ...inputStyle,
      borderColor: active
        ? 'rgba(138,77,255,.58)'
        : 'rgba(255,255,255,.09)',
      boxShadow: active
        ? '0 0 0 3px rgba(138,77,255,.09)'
        : 'none',
      background: active
        ? 'rgba(138,77,255,.035)'
        : 'rgba(255,255,255,.035)',
    };
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
        'Name, email and organisation name are required.',
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

  return (
    <main
      style={{
        minHeight: '100vh',
        background: BG,
        color: '#F5F7FA',
        fontFamily: FONT,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes bbPulse {
          0%, 100% {
            opacity: 1;
          }

          50% {
            opacity: .42;
          }
        }

        @keyframes bbFadeUp {
          from {
            opacity: 0;
            transform: translateY(14px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .bb-request-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .bb-request-input::placeholder,
        .bb-request-textarea::placeholder {
          color: rgba(255,255,255,.20);
        }

        .bb-request-select option {
          background: #121319;
          color: #F1F5F9;
        }

        @media (max-width: 680px) {
          .bb-request-grid {
            grid-template-columns: 1fr;
            gap: 0;
          }

          .bb-request-shell {
            padding-left: 18px !important;
            padding-right: 18px !important;
          }

          .bb-request-card {
            padding: 24px 20px !important;
          }

          .bb-request-hero {
            padding-top: 42px !important;
          }
        }
      `}</style>

      {/* Ambient background */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(
              ellipse 68% 42% at 50% -5%,
              rgba(138,77,255,.13) 0%,
              rgba(92,124,255,.035) 44%,
              transparent 72%
            )
          `,
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          width: 420,
          height: 420,
          right: '-180px',
          top: '28%',
          zIndex: 0,
          pointerEvents: 'none',
          borderRadius: '50%',
          background:
            'rgba(92,124,255,.035)',
          filter: 'blur(90px)',
        }}
      />

      <div
        className="bb-request-shell"
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '0 24px 96px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Back */}
        <div
          style={{
            paddingTop: 28,
          }}
        >
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color:
                'rgba(255,255,255,.34)',
              textDecoration: 'none',
              transition: 'color .15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color =
                'rgba(255,255,255,.65)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color =
                'rgba(255,255,255,.34)';
            }}
          >
            ← Back to BRΛINBΛSE
          </Link>
        </div>

        {done ? (
          <div
            style={{
              paddingTop: 86,
              textAlign: 'center',
              animation:
                'bbFadeUp .4s ease both',
            }}
          >
            <div
              style={{
                width: 260,
                maxWidth: '76vw',
                margin: '0 auto 34px',
              }}
            >
              <BrainBaseWordmark
                width={260}
                style={{ maxWidth: '100%' }}
              />
            </div>

            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                margin: '0 auto 25px',
                background:
                  'rgba(138,77,255,.10)',
                border:
                  '1px solid rgba(138,77,255,.28)',
                boxShadow:
                  '0 0 32px rgba(138,77,255,.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#C4B5FD',
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              ✓
            </div>

            <div
              style={{
                marginBottom: 10,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '.13em',
                textTransform: 'uppercase',
                color:
                  'rgba(167,139,250,.72)',
              }}
            >
              Request received
            </div>

            <h1
              style={{
                margin: '0 0 14px',
                fontSize:
                  'clamp(29px, 5vw, 40px)',
                fontWeight: 650,
                letterSpacing: '-.04em',
                lineHeight: 1.1,
                color: '#F5F7FA',
              }}
            >
              Thanks — we&apos;ve received
              your request.
            </h1>

            <p
              style={{
                margin:
                  '0 auto 32px',
                maxWidth: 460,
                fontSize: 14,
                lineHeight: 1.75,
                color:
                  'rgba(226,232,240,.52)',
              }}
            >
              We&apos;ll review what
              you&apos;re trying to
              improve and contact you to
              discuss where BRΛINBΛSE
              could fit.
            </p>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 9,
                flexWrap: 'wrap',
              }}
            >
              <Link
                href="/demo"
                style={{
                  minHeight: 41,
                  padding: '0 18px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 9,
                  background:
                    'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                  color: '#FFFFFF',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 650,
                }}
              >
                Explore the platform →
              </Link>

              <Link
                href="/"
                style={{
                  minHeight: 39,
                  padding: '0 18px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 9,
                  border:
                    '1px solid rgba(255,255,255,.09)',
                  background:
                    'rgba(255,255,255,.025)',
                  color:
                    'rgba(226,232,240,.58)',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 550,
                }}
              >
                Back to BRΛINBΛSE
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <section
              className="bb-request-hero"
              style={{
                padding: '56px 0 38px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 300,
                  maxWidth: '80vw',
                  margin: '0 auto 28px',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <BrainBaseWordmark
                  width={260}
                  style={{ maxWidth: '100%' }}
                />
              </div>

              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 11px',
                  borderRadius: 999,
                  marginBottom: 21,
                  background:
                    'rgba(138,77,255,.07)',
                  border:
                    '1px solid rgba(138,77,255,.18)',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#A78BFA',
                    boxShadow:
                      '0 0 7px rgba(167,139,250,.8)',
                    animation:
                      'bbPulse 2.5s ease-in-out infinite',
                  }}
                />

                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color:
                      'rgba(196,181,253,.84)',
                    letterSpacing: '.12em',
                    textTransform:
                      'uppercase',
                  }}
                >
                  Discuss your operation
                </span>
              </div>

              <h1
                style={{
                  margin: '0 auto 14px',
                  maxWidth: 650,
                  fontSize:
                    'clamp(31px, 5vw, 46px)',
                  fontWeight: 650,
                  letterSpacing: '-.04em',
                  lineHeight: 1.08,
                  color: '#F5F7FA',
                }}
              >
                Tell us what you&apos;re
                trying to improve.
              </h1>

              <p
                style={{
                  margin: '0 auto',
                  maxWidth: 570,
                  fontSize: 14,
                  lineHeight: 1.75,
                  color:
                    'rgba(226,232,240,.52)',
                }}
              >
                You don&apos;t need to know
                exactly how BRΛINBΛSE
                should be configured. Tell
                us where the friction is,
                what you use today and
                what you want to improve —
                we can help identify the
                right starting point.
              </p>
            </section>

            {/* How this works */}
            <div
              style={{
                marginBottom: 14,
                padding: '18px 20px',
                borderRadius: 13,
                background:
                  'rgba(138,77,255,.035)',
                border:
                  '1px solid rgba(138,77,255,.10)',
              }}
            >
              <div
                style={{
                  marginBottom: 12,
                  fontSize: 12,
                  fontWeight: 650,
                  color:
                    'rgba(245,247,250,.80)',
                }}
              >
                Start with the problem, not the software.
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: 7,
                  marginBottom: 12,
                }}
              >
                {[
                  "Tell us what's creating friction",
                  'Tell us what systems you already rely on',
                  "We'll discuss where BRΛINBΛSE could fit",
                  'Start focused, expand later if needed',
                ].map(point => (
                  <div
                    key={point}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background:
                          'rgba(167,139,250,.7)',
                      }}
                    />

                    <span
                      style={{
                        fontSize: 11,
                        lineHeight: 1.5,
                        color:
                          'rgba(226,232,240,.55)',
                      }}
                    >
                      {point}
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  fontSize: 10,
                  lineHeight: 1.5,
                  color:
                    'rgba(226,232,240,.35)',
                }}
              >
                BRΛINBΛSE can work alongside external
                systems where it makes sense.
              </div>
            </div>

            {/* Form */}
            <form
              onSubmit={submit}
              style={{
                animation:
                  'bbFadeUp .35s ease both',
              }}
            >
              <div
                className="bb-request-card"
                style={{
                  padding: '32px',
                  borderRadius: 17,
                  background:
                    'rgba(255,255,255,.022)',
                  border:
                    '1px solid rgba(255,255,255,.075)',
                  boxShadow:
                    '0 28px 80px rgba(0,0,0,.16)',
                }}
              >
                {/* Contact */}
                <SectionLabel>
                  Your details
                </SectionLabel>

                <div className="bb-request-grid">
                  <Field
                    label="Full name"
                    required
                  >
                    <input
                      className="bb-request-input"
                      autoComplete="name"
                      value={form.name}
                      onChange={set('name')}
                      placeholder="Jane Smith"
                      style={focusStyle('name')}
                      onFocus={() =>
                        setFocusField('name')
                      }
                      onBlur={() =>
                        setFocusField(null)
                      }
                    />
                  </Field>

                  <Field
                    label="Work email"
                    required
                  >
                    <input
                      className="bb-request-input"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={set('email')}
                      placeholder="jane@business.com.au"
                      style={focusStyle(
                        'email',
                      )}
                      onFocus={() =>
                        setFocusField(
                          'email',
                        )
                      }
                      onBlur={() =>
                        setFocusField(null)
                      }
                    />
                  </Field>
                </div>

                <Field label="Phone">
                  <input
                    className="bb-request-input"
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={set('phone')}
                    placeholder="+61 4xx xxx xxx"
                    style={focusStyle(
                      'phone',
                    )}
                    onFocus={() =>
                      setFocusField('phone')
                    }
                    onBlur={() =>
                      setFocusField(null)
                    }
                  />
                </Field>

                <Divider />

                {/* Organisation */}
                <SectionLabel>
                  Your organisation
                </SectionLabel>

                <div className="bb-request-grid">
                  <Field
                    label="Organisation / Business name"
                    required
                  >
                    <input
                      className="bb-request-input"
                      autoComplete="organization"
                      value={
                        form.business_name
                      }
                      onChange={set(
                        'business_name',
                      )}
                      placeholder="Your organisation"
                      style={focusStyle(
                        'business_name',
                      )}
                      onFocus={() =>
                        setFocusField(
                          'business_name',
                        )
                      }
                      onBlur={() =>
                        setFocusField(null)
                      }
                    />
                  </Field>

                  <Field label="Organisation type">
                    <select
                      className="bb-request-select"
                      value={
                        form.business_type
                      }
                      onChange={set(
                        'business_type',
                      )}
                      style={{
                        ...focusStyle(
                          'business_type',
                        ),
                        colorScheme: 'dark',
                        appearance: 'none',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(255,255,255,0.35)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                        backgroundRepeat:
                          'no-repeat',
                        backgroundPosition:
                          'right 13px center',
                        paddingRight: 38,
                        cursor: 'pointer',
                      }}
                      onFocus={() =>
                        setFocusField(
                          'business_type',
                        )
                      }
                      onBlur={() =>
                        setFocusField(null)
                      }
                    >
                      <option value="">
                        Select type…
                      </option>

                      {BUSINESS_TYPES.map(
                        type => (
                          <option
                            key={type}
                            value={type}
                          >
                            {type}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                </div>

                <Field
                  label="Tell us about your operation"
                  helper="A few sentences is enough. Include any systems or tools you currently rely on, if relevant."
                >
                  <textarea
                    className="bb-request-textarea"
                    value={
                      form.description
                    }
                    onChange={set(
                      'description',
                    )}
                    placeholder="What does your organisation do, and how are you managing the work today?"
                    rows={4}
                    style={{
                      ...focusStyle(
                        'description',
                      ),
                      resize: 'vertical',
                      lineHeight: 1.65,
                    }}
                    onFocus={() =>
                      setFocusField(
                        'description',
                      )
                    }
                    onBlur={() =>
                      setFocusField(null)
                    }
                  />
                </Field>

                <div className="bb-request-grid">
                  <Field label="Clients / Customers">
                    <select
                      className="bb-request-select"
                      value={
                        form.num_clients
                      }
                      onChange={set(
                        'num_clients',
                      )}
                      style={{
                        ...focusStyle(
                          'num_clients',
                        ),
                        colorScheme: 'dark',
                        appearance: 'none',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(255,255,255,0.35)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                        backgroundRepeat:
                          'no-repeat',
                        backgroundPosition:
                          'right 13px center',
                        paddingRight: 38,
                        cursor: 'pointer',
                      }}
                      onFocus={() =>
                        setFocusField(
                          'num_clients',
                        )
                      }
                      onBlur={() =>
                        setFocusField(null)
                      }
                    >
                      <option value="">
                        Select range…
                      </option>

                      {CLIENT_RANGES.map(
                        range => (
                          <option
                            key={range}
                            value={range}
                          >
                            {range}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>

                  <Field label="Team / Users">
                    <select
                      className="bb-request-select"
                      value={
                        form.num_users
                      }
                      onChange={set(
                        'num_users',
                      )}
                      style={{
                        ...focusStyle(
                          'num_users',
                        ),
                        colorScheme: 'dark',
                        appearance: 'none',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(255,255,255,0.35)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                        backgroundRepeat:
                          'no-repeat',
                        backgroundPosition:
                          'right 13px center',
                        paddingRight: 38,
                        cursor: 'pointer',
                      }}
                      onFocus={() =>
                        setFocusField(
                          'num_users',
                        )
                      }
                      onBlur={() =>
                        setFocusField(null)
                      }
                    >
                      <option value="">
                        Select size…
                      </option>

                      {TEAM_SIZES.map(
                        size => (
                          <option
                            key={size}
                            value={size}
                          >
                            {size}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                </div>

                <Divider />

                {/* Goals */}
                <SectionLabel>
                  Where would you like BRΛINBΛSE to help first?
                </SectionLabel>

                <Field
                  label="What would you most like to improve?"
                  helper="For example: lead follow-up, scheduling, client visibility, reporting, disconnected systems, website enquiries or manual admin."
                >
                  <textarea
                    className="bb-request-textarea"
                    value={form.goal}
                    onChange={set('goal')}
                    placeholder="Tell us where the current process is creating work, gaps or frustration."
                    rows={4}
                    style={{
                      ...focusStyle(
                        'goal',
                      ),
                      resize: 'vertical',
                      lineHeight: 1.65,
                    }}
                    onFocus={() =>
                      setFocusField('goal')
                    }
                    onBlur={() =>
                      setFocusField(null)
                    }
                  />
                </Field>

                <Field label="How did you hear about BRΛINBΛSE?">
                  <input
                    className="bb-request-input"
                    value={form.referral}
                    onChange={set(
                      'referral',
                    )}
                    placeholder="Google, referral, LinkedIn, word of mouth…"
                    style={focusStyle(
                      'referral',
                    )}
                    onFocus={() =>
                      setFocusField(
                        'referral',
                      )
                    }
                    onBlur={() =>
                      setFocusField(null)
                    }
                  />
                </Field>

                <div
                  style={{
                    marginBottom: 18,
                    padding: '12px 14px',
                    borderRadius: 9,
                    background:
                      'rgba(255,255,255,.018)',
                    border:
                      '1px solid rgba(255,255,255,.06)',
                    fontSize: 10.5,
                    lineHeight: 1.6,
                    color:
                      'rgba(226,232,240,.42)',
                  }}
                >
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
                  <Link
                    href="/privacy"
                    style={{
                      color:
                        'rgba(196,181,253,.75)',
                    }}
                  >
                    Privacy Policy
                  </Link>{' '}
                  for details.
                </div>

                {error && (
                  <div
                    role="alert"
                    style={{
                      padding: '11px 13px',
                      marginBottom: 20,
                      borderRadius: 9,
                      background:
                        'rgba(239,68,68,.07)',
                      border:
                        '1px solid rgba(239,68,68,.18)',
                      color: '#FCA5A5',
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    width: '100%',
                    minHeight: 47,
                    padding: '0 18px',
                    borderRadius: 10,
                    fontWeight: 650,
                    fontSize: 13,
                    letterSpacing: '.01em',
                    background:
                      submitting
                        ? 'rgba(138,77,255,.10)'
                        : 'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                    border:
                      submitting
                        ? '1px solid rgba(138,77,255,.16)'
                        : '1px solid rgba(167,139,250,.25)',
                    boxShadow:
                      submitting
                        ? 'none'
                        : '0 10px 30px rgba(106,61,255,.16)',
                    color:
                      submitting
                        ? 'rgba(245,247,250,.38)'
                        : '#FFFFFF',
                    cursor:
                      submitting
                        ? 'not-allowed'
                        : 'pointer',
                    transition:
                      'opacity .15s, transform .15s, box-shadow .15s',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => {
                    if (!submitting) {
                      e.currentTarget.style.opacity =
                        '0.92';

                      e.currentTarget.style.transform =
                        'translateY(-1px)';

                      e.currentTarget.style.boxShadow =
                        '0 14px 36px rgba(106,61,255,.22)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!submitting) {
                      e.currentTarget.style.opacity =
                        '1';

                      e.currentTarget.style.transform =
                        'translateY(0)';

                      e.currentTarget.style.boxShadow =
                        '0 10px 30px rgba(106,61,255,.16)';
                    }
                  }}
                >
                  {submitting
                    ? 'Sending…'
                    : 'Discuss my operation →'}
                </button>

                <p
                  style={{
                    margin: '14px 0 0',
                    textAlign: 'center',
                    fontSize: 10,
                    lineHeight: 1.55,
                    color:
                      'rgba(255,255,255,.24)',
                  }}
                >
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
              </div>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

function SectionLabel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 20,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '.13em',
        textTransform: 'uppercase',
        color:
          'rgba(167,139,250,.62)',
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        margin: '8px 0 25px',
        background:
          'rgba(255,255,255,.055)',
      }}
    />
  );
}