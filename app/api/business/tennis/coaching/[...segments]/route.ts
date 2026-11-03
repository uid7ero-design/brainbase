import { NextRequest } from 'next/server';
import { handleCoaching } from '@/lib/tennisBusiness/coachingTransport';
type Context = { params: Promise<{ segments: string[] }> };
async function dispatch(request: NextRequest, context: Context) {
  return handleCoaching(request, (await context.params).segments);
}
export { dispatch as GET, dispatch as POST, dispatch as PATCH, dispatch as DELETE };
