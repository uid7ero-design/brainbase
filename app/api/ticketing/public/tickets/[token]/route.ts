import { handleTicketingTicket } from '@/lib/ticketing/publicApi';
// Server-to-server only (gate + no CORS); logic in lib/ticketing.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) { return handleTicketingTicket(req, (await params).token); }
