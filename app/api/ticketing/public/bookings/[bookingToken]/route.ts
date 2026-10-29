import { handleTicketingBooking } from '@/lib/ticketing/publicApi';
// Server-to-server only (gate + no CORS); logic in lib/ticketing.
export async function GET(req: Request, { params }: { params: Promise<{ bookingToken: string }> }) { return handleTicketingBooking(req, (await params).bookingToken); }
