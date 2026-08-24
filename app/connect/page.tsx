import Link from 'next/link';
import Image from 'next/image';

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
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(
              ellipse 72% 46% at 50% -6%,
              rgba(138,77,255,.14) 0%,
              rgba(86,119,255,.035) 42%,
              transparent 72%
            )
          `,
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 22px',
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
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 22,
            }}
          >
            <Image
              src="/Brand/brainbase-logo-dark.svg"
              alt="BRΛINBΛSE"
              width={500}
              height={114}
              priority
              style={{
                display: 'block',
                width: 220,
                maxWidth: '72vw',
                height: 'auto',
                transform: 'translateX(-3.5%)',
              }}
            />
          </div>

          {/* CONTEXT LINE */}

          <p
            style={{
              margin: '0 0 22px',
              fontSize: 11.5,
              lineHeight: 1.5,
              color: 'rgba(255,255,255,.32)',
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
              marginBottom: 20,
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
              margin: '0 0 16px',
              fontSize: 'clamp(30px, 8vw, 40px)',
              lineHeight: 1.08,
              letterSpacing: '-.04em',
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
              margin: '0 auto 28px',
              maxWidth: 360,
              fontSize: 14,
              lineHeight: 1.65,
              color: 'rgba(226,232,240,.60)',
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
              marginBottom: 26,
            }}
          >
            <Link
              href="/demo"
              style={{
                minHeight: 52,
                padding: '0 22px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 11,
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
              style={{
                minHeight: 50,
                padding: '0 22px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 11,
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
              marginBottom: 30,
            }}
          >
            <Link
              href="/client-operations"
              style={{
                minHeight: 44,
                padding: '0 12px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 9,
                border: '1px solid rgba(255,255,255,.07)',
                background: 'rgba(255,255,255,.018)',
                color: 'rgba(226,232,240,.62)',
                fontSize: 12,
                fontWeight: 550,
                textDecoration: 'none',
              }}
            >
              Client Operations
            </Link>

            <Link
              href="/web-systems"
              style={{
                minHeight: 44,
                padding: '0 12px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 9,
                border: '1px solid rgba(255,255,255,.07)',
                background: 'rgba(255,255,255,.018)',
                color: 'rgba(226,232,240,.62)',
                fontSize: 12,
                fontWeight: 550,
                textDecoration: 'none',
              }}
            >
              Web Systems
            </Link>
          </div>

          {/* CONTACT */}

          <a
            href="mailto:hello@thebrainbase.com.au"
            style={{
              display: 'inline-block',
              marginBottom: 22,
              fontSize: 13,
              fontWeight: 550,
              color: '#C4B5FD',
              textDecoration: 'none',
            }}
          >
            hello@thebrainbase.com.au
          </a>

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
              style={{ color: 'rgba(255,255,255,.28)', textDecoration: 'none' }}
            >
              Privacy
            </Link>

            <Link
              href="/terms"
              style={{ color: 'rgba(255,255,255,.28)', textDecoration: 'none' }}
            >
              Terms
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
