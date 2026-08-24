/**
 * Lightweight local analytics-preference storage.
 *
 * Deliberately not a full consent-management platform — a single
 * localStorage flag, following the same pattern already used for the
 * theme preference (`bb-theme`) in app/layout.tsx.
 *
 * Opt-in: while no value is stored (undecided), analytics must not run.
 * Clarity only loads once the visitor explicitly grants consent via the
 * preference bar; declining, or simply never choosing, both result in
 * Clarity never loading.
 */

const STORAGE_KEY = 'bb-analytics-consent';

export type AnalyticsConsent = 'granted' | 'declined' | null;

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);

    if (value === 'granted' || value === 'declined') {
      return value;
    }

    return null;
  } catch {
    return null;
  }
}

export function setAnalyticsConsent(consent: 'granted' | 'declined'): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, consent);
  } catch {
    /* localStorage may be unavailable (private browsing, blocked storage) — fail silently. */
  }
}
