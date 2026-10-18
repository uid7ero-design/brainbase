import { handleOrganiserSettings } from '@/lib/ticketing/organiserApi';
// Server-to-server only (gate + no CORS); logic in lib/ticketing. READ-ONLY: GET is the only method.
export const GET = (req: Request) => handleOrganiserSettings(req);
