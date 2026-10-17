import { handleOrganisationList, handleOrganisationSwitch } from '@/lib/ticketing/login';

// super_admin only. GET lists Events-entitled organisations; POST re-issues
// the ticketing session for one of them. Server-to-server only.
export const GET = (req: Request) => handleOrganisationList(req);
export const POST = (req: Request) => handleOrganisationSwitch(req);
