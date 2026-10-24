import { handleOrganiserCheckIn } from '@/lib/ticketing/organiserApi';
// Server-to-server only (gate + no CORS); logic in lib/ticketing.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) { return handleOrganiserCheckIn(req, (await params).id, 'resolve'); }
