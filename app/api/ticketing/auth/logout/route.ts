import { handleTicketingLogout } from '@/lib/ticketing/login';

// Revokes the presented Eve session server-side (idempotent); the Eve server
// then drops its cookie. Server-to-server only.
export const POST = (req: Request) => handleTicketingLogout(req);
