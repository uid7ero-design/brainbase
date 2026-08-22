'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function RouteScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    // Keep intentional anchor links working.
    if (window.location.hash) {
      return;
    }

    const scrollToTop = () => {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'auto',
      });

      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    scrollToTop();

    const frame1 = window.requestAnimationFrame(() => {
      scrollToTop();

      window.requestAnimationFrame(() => {
        scrollToTop();
      });
    });

    const timer1 = window.setTimeout(
      scrollToTop,
      50,
    );

    const timer2 = window.setTimeout(
      scrollToTop,
      150,
    );

    const timer3 = window.setTimeout(
      scrollToTop,
      300,
    );

    return () => {
      window.cancelAnimationFrame(frame1);
      window.clearTimeout(timer1);
      window.clearTimeout(timer2);
      window.clearTimeout(timer3);
    };
  }, [pathname]);

  return null;
}