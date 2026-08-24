'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';

import { isClarityAllowedRoute } from '@/lib/analyticsRoutes';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
} from '@/lib/analyticsConsent';

const CLARITY_PROJECT_ID = 'wvg7lqjkde';

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

/**
 * Loads Microsoft Clarity only on genuinely public marketing pages, and
 * only after the visitor has explicitly granted analytics consent
 * (opt-in — Clarity never loads while consent is unset or declined).
 * Uses Clarity's own consent/stop/start API so that navigating from an
 * eligible page into an authenticated or sensitive route actively pauses
 * recording, rather than relying solely on the script not being
 * re-injected.
 *
 * See lib/analyticsRoutes.ts for the eligible-route allowlist and
 * lib/analyticsConsent.ts for the consent storage.
 */
export default function ClarityLoader() {
  const pathname = usePathname();
  const eligible = isClarityAllowedRoute(pathname);

  const [consent, setConsent] = useState(getAnalyticsConsent());
  const [scriptLoaded, setScriptLoaded] = useState(false);

  const shouldRun = eligible && consent === 'granted';

  // Once eligible, keep the script mounted for the rest of the session so
  // subsequent navigation can pause/resume it via stop()/start() instead of
  // re-fetching it. Setting state during render (not in an effect) is the
  // supported pattern for "remember this became true" — see
  // https://react.dev/learn/you-might-not-need-an-effect
  if (shouldRun && !scriptLoaded) {
    setScriptLoaded(true);
  }

  useEffect(() => {
    if (typeof window.clarity !== 'function') {
      return;
    }

    if (shouldRun) {
      window.clarity('consent', true);
      window.clarity('start');
    } else {
      window.clarity('consent', false);
      window.clarity('stop');
    }
  }, [shouldRun, pathname]);

  function choose(value: 'granted' | 'declined') {
    setAnalyticsConsent(value);
    setConsent(value);
  }

  return (
    <>
      {scriptLoaded && (
        <Script
          id="microsoft-clarity"
          strategy="afterInteractive"
        >
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){
                (c[a].q=c[a].q||[])
                  .push(arguments)
              };

              t=l.createElement(r);
              t.async=1;
              t.src=
                "https://www.clarity.ms/tag/"+i;

              y=l.getElementsByTagName(r)[0];

              y.parentNode.insertBefore(
                t,
                y
              );

            })(
              window,
              document,
              "clarity",
              "script",
              "${CLARITY_PROJECT_ID}"
            );
          `}
        </Script>
      )}

      {eligible && consent === null && (
        <div
          role="region"
          aria-label="Analytics preference"
          style={{
            position: 'fixed',
            left: 16,
            right: 16,
            bottom: 16,
            zIndex: 200,
            maxWidth: 460,
            margin: '0 auto',
            padding: '14px 16px',
            borderRadius: 12,
            background: 'rgba(12,13,17,.96)',
            border: '1px solid rgba(255,255,255,.10)',
            boxShadow: '0 20px 50px rgba(0,0,0,.35)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            fontFamily:
              'var(--font-inter), "Inter", -apple-system, sans-serif',
          }}
        >
          <p
            style={{
              margin: 0,
              flex: '1 1 240px',
              fontSize: 11.5,
              lineHeight: 1.55,
              color: 'rgba(226,232,240,.68)',
            }}
          >
            We use limited analytics on our public pages to understand and
            improve BRΛINBΛSE. See our{' '}
            <a
              href="/privacy"
              style={{ color: '#A78BFA' }}
            >
              Privacy Policy
            </a>
            .
          </p>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => choose('declined')}
              style={{
                height: 32,
                padding: '0 13px',
                borderRadius: 7,
                border: '1px solid rgba(255,255,255,.14)',
                background: 'rgba(255,255,255,.03)',
                color: 'rgba(245,247,250,.72)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Decline
            </button>

            <button
              onClick={() => choose('granted')}
              style={{
                height: 32,
                padding: '0 13px',
                borderRadius: 7,
                border: '1px solid rgba(167,139,250,.30)',
                background: 'rgba(138,77,255,.16)',
                color: '#C4B5FD',
                fontSize: 11,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Allow analytics
            </button>
          </div>
        </div>
      )}
    </>
  );
}
