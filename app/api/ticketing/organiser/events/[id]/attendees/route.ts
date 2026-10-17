import { handleOrganiserAttendees } from '@/lib/ticketing/organiserApi';
// Server-to-server only (gate + no CORS); logic in lib/ticketing.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) { return handleOrganiserAttendees(req, (await params).id); }
