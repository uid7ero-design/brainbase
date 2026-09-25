'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';

import { isClarityAllowedRoute } from '@/lib/analyticsRoutes';
import { isThemedPublicRoute } from '@/components/public/routes';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
} from '@/lib/analyticsConsent';

// Presentation only: the consent prompt follows the public-site theme on
// routes converted to the --bb-* tokens and stays dark on the rest. The
// consent, storage and Clarity start/stop behaviour above is unchanged.
import styles from './ConsentBanner.module.css';

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
          className={`bb-public ${styles.banner} ${
            isThemedPublicRoute(pathname) ? '' : 'bb-scope-dark'
          }`}
        >
          <p className={styles.text}>
            We use limited analytics on our public pages to understand and
            improve BrainBase. See our{' '}
            <a href="/privacy" className={styles.link}>
              Privacy Policy
            </a>
            .
          </p>

          <div className={styles.actions}>
            <button
              onClick={() => choose('declined')}
              className={styles.decline}
            >
              Decline
            </button>

            <button
              onClick={() => choose('granted')}
              className={styles.allow}
            >
              Allow analytics
            </button>
          </div>
        </div>
      )}
    </>
  );
}
