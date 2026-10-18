import { handleOrganiserPayment } from '@/lib/ticketing/organiserApi';
// Server-to-server only (gate + no CORS); logic in lib/ticketing. READ-ONLY: GET is the only method.
export async function GET(req: Request, { params }: { params: Promise<{ orderId: string }> }) { return handleOrganiserPayment(req, (await params).orderId); }
