import { handleTicketingLogin } from '@/lib/ticketing/login';

// Server-to-server only (see lib/ticketing/gate.ts). No CORS, no OPTIONS.
export const POST = (req: Request) => handleTicketingLogin(req);
