import { notFound } from 'next/navigation';
import { HelenaOrbitalShowcase } from './HelenaOrbitalShowcase';

// Development-only design-QA route for the Hybrid Orbit HelenaOrbital visual
// (Phase B). Not linked from any production navigation. Also excluded from
// the Vercel deploy entirely via .vercelignore (app/dev), matching this
// repo's existing convention for WIP routes (see app/api/ops). This
// in-app guard is defense-in-depth in case that build step is ever bypassed.
export default function HelenaOrbitalDevPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <HelenaOrbitalShowcase />;
}
