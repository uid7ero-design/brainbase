'use client';

import { useEffect } from 'react';

/**
 * Preserved from the previous homepage: on a fresh load without a #hash,
 * pin the page to the top (the browser's scroll restoration otherwise lands
 * mid-page). A no-op when arriving via an anchor such as /#product.
 */
export function ScrollToTopOnLoad() {
  useEffect(() => {
    if (window.location.hash) return;
    const scrollToTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    scrollToTop();
    const frame = window.requestAnimationFrame(scrollToTop);
    const timer = window.setTimeout(scrollToTop, 50);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
