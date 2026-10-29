import { handleOrganiserSummary } from '@/lib/ticketing/organiserApi';
// Server-to-server only (gate + no CORS); logic in lib/ticketing.
export const GET = (req: Request) => handleOrganiserSummary(req);
