import Link from 'next/link';
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark';
import { OrbitalBackground } from '@/components/brand/OrbitalBackground';

export const metadata = {
  title: 'Connect',
  description:
    'Explore BRΛINBΛSE, see the platform in action or discuss how it could fit your operation.',
};

const FONT =
  'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const BG = '#07080B';

export default function ConnectPage() {
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
        @keyframes bbConnectGlow {
          0%, 100% { opacity: .38; }
          50% { opacity: .62; }
        }

        .bb-connect-primary,
        .bb-connect-secondary,
        .bb-connect-path {
          transition: transform .15s ease, box-shadow .15s ease,
            background .15s ease, border-color .15s ease;
        }

        .bb-connect-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 36px rgba(106,61,255,.30);
        }

        .bb-connect-primary:active {
          transform: translateY(0);
        }

        .bb-connect-secondary:hover {
          background: rgba(255,255,255,.055);
          border-color: rgba(255,255,255,.16);
        }

        .bb-connect-path:hover {
          transform: translateY(-1px);
          background: rgba(255,255,255,.032);
          border-color: rgba(255,255,255,.12);
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-connect-glow {
            animation: none !important;
          }
        }
      `}</style>

      {/* Hybrid Orbit atmosphere — Phase D.3. 'veil' (nebula wash only, no
          rings/asset/animation surface): this is a minimal, single-purpose
          card page — the fuller 'field' treatment would overdesign it.
          Replaces the old bespoke fixed radial-gradient wash. The separate
          .bb-connect-glow pulse behind the wordmark below is left as-is —
          it's a deliberate, page-specific accent framing the logo, not
          atmospheric background. */}
      <OrbitalBackground
        variant="veil"
        intensity="low"
        placement="center"
        style={{ position: 'fixed' }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding:
            '24px 20px max(24px, env(safe-area-inset-bottom))',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          {/* BRAND */}

          <div
            style={{
              position: 'relative',
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <div
              aria-hidden="true"
              className="bb-connect-glow"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 260,
                height: 260,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(138,77,255,.22) 0%, rgba(86,119,255,.10) 42%, transparent 72%)',
                filter: 'blur(26px)',
                animation: 'bbConnectGlow 6s ease-in-out infinite',
              }}
            />

            <BrainBaseWordmark
              width={250}
              style={{
                position: 'relative',
                maxWidth: '76vw',
              }}
            />
          </div>

          {/* CONTEXT LINE */}

          <p
            style={{
              margin: '0 0 18px',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'rgba(226,232,240,.40)',
              fontStyle: 'italic',
            }}
          >
            Scanned from a BRΛINBΛSE card? You&apos;re in the right place.
          </p>

          {/* EYEBROW */}

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 11px',
              marginBottom: 18,
              borderRadius: 999,
              background: 'rgba(138,77,255,.07)',
              border: '1px solid rgba(138,77,255,.18)',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: '#22C55E',
                boxShadow: '0 0 7px rgba(34,197,94,.8)',
              }}
            />

            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: 'rgba(196,181,253,.84)',
              }}
            >
              Connected operational platform
            </span>
          </div>

          {/* HEADLINE */}

          <h1
            style={{
              margin: '0 0 14px',
              fontSize: 'clamp(29px, 7.6vw, 38px)',
              lineHeight: 1.1,
              letterSpacing: '-.038em',
              fontWeight: 650,
              color: '#F5F7FA',
            }}
          >
            One platform.
            <br />
            <span
              style={{
                background:
                  'linear-gradient(100deg, #8A4DFF 0%, #A78BFA 46%, #5C7CFF 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Built around how your business works.
            </span>
          </h1>

          {/* SUPPORTING COPY */}

          <p
            style={{
              margin: '0 auto 24px',
              maxWidth: 340,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: 'rgba(226,232,240,.58)',
            }}
          >
            Start with the capabilities you need, connect the systems you
            already use, and expand as your operation grows.
          </p>

          {/* PRIMARY ACTIONS */}

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginBottom: 20,
            }}
          >
            <Link
              href="/demo"
              className="bb-connect-primary"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                minHeight: 52,
                padding: '0 22px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                background:
                  'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                color: '#FFFFFF',
                fontSize: 15,
                fontWeight: 650,
                textDecoration: 'none',
                boxShadow: '0 10px 30px rgba(106,61,255,.22)',
              }}
            >
              Explore BRΛINBΛSE →
            </Link>

            <Link
              href="/request-demo"
              className="bb-connect-secondary"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                minHeight: 50,
                padding: '0 22px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,.10)',
                background: 'rgba(255,255,255,.03)',
                color: 'rgba(245,247,250,.76)',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Discuss your operation
            </Link>
          </div>

          {/* SECONDARY PATHS */}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 8,
              marginBottom: 26,
            }}
          >
            <Link
              href="/client-operations"
              className="bb-connect-path"
              style={{
                minHeight: 44,
                padding: '0 10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 9,
                border: '1px solid rgba(255,255,255,.07)',
                background: 'rgba(255,255,255,.016)',
                color: 'rgba(226,232,240,.58)',
                fontSize: 11.5,
                fontWeight: 550,
                textDecoration: 'none',
              }}
            >
              Client Operations
            </Link>

            <Link
              href="/web-systems"
              className="bb-connect-path"
              style={{
                minHeight: 44,
                padding: '0 10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 9,
                border: '1px solid rgba(255,255,255,.07)',
                background: 'rgba(255,255,255,.016)',
                color: 'rgba(226,232,240,.58)',
                fontSize: 11.5,
                fontWeight: 550,
                textDecoration: 'none',
              }}
            >
              Web Systems
            </Link>
          </div>

          {/* CONTACT */}

          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                marginBottom: 5,
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: '.11em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,.24)',
              }}
            >
              Email BRΛINBΛSE
            </div>

            <a
              href="mailto:hello@thebrainbase.com.au"
              style={{
                display: 'inline-block',
                fontSize: 13,
                fontWeight: 550,
                color: '#C4B5FD',
                textDecoration: 'none',
              }}
            >
              hello@thebrainbase.com.au
            </a>
          </div>

          {/* LEGAL */}

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 14,
              fontSize: 10,
            }}
          >
            <Link
              href="/privacy"
              style={{ color: 'rgba(255,255,255,.26)', textDecoration: 'none' }}
            >
              Privacy
            </Link>

            <Link
              href="/terms"
              style={{ color: 'rgba(255,255,255,.26)', textDecoration: 'none' }}
            >
              Terms
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
