import { handleTicketingCheckoutStatus } from '@/lib/ticketing/publicApi';
// Server-to-server only (gate + no CORS); logic in lib/ticketing.
type Ctx = { params: Promise<{ organisationSlug: string; eventSlug: string }> };
export async function GET(req: Request, { params }: Ctx) { return handleTicketingCheckoutStatus(req, await params); }
