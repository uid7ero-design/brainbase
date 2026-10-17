import { defineProductConfig } from '@ticketing/core';

// The single place where this product's identity is declared. The shared
// ticketing core never reads these values itself — they are handed to it
// (link builders, email identity) by this application.
//
// Environment: EVE_PUBLIC_BASE_URL / EVE_SUPPORT_EMAIL / EVE_EMAIL_FROM are
// optional in Phase 1 (no email is sent and no link is minted yet); the
// defaults below are placeholders for local and Preview builds and must be
// replaced before any live deployment (see apps/eve/README.md).
export const product = defineProductConfig({
  name: 'Eve',
  tagline: 'Events made easy',
  publicBaseUrl: process.env.NEXT_PUBLIC_EVE_BASE_URL ?? process.env.EVE_PUBLIC_BASE_URL ?? 'http://localhost:3100',
  supportEmail: process.env.EVE_SUPPORT_EMAIL ?? 'support@eve.invalid',
  emailFrom: process.env.EVE_EMAIL_FROM ?? 'Eve <no-reply@eve.invalid>',
  defaultTheme: 'light',
  features: {
    // Nothing below is wired in Phase 1. Each switch is read by the shell
    // to decide between a working surface and an explicit "not available"
    // panel — never to show sample data.
    public_event_pages: false,
    tickets: false,
    booking_wallet: false,
    organiser_console: false,
    payments: false,
    check_in: false,
  },
});

export type EveProduct = typeof product;
