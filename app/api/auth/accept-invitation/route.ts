import { NextRequest, NextResponse } from 'next/server';
import { acceptOrganisationInvitation, UserAdministrationError } from '@/lib/organisationUsers/service';
import { checkRateLimit } from '@/lib/rateLimit';
export async function POST(req: NextRequest) {
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown';
  if(!checkRateLimit(`accept-invitation:${ip}`,10,15*60_000)) return NextResponse.json({error:'Too many attempts. Try again later.'},{status:429,headers});
  if(Number(req.headers.get('content-length')??0)>16384) return NextResponse.json({error:'Request too large.'},{status:413,headers});
  try {
    const body=await req.json();
    if(typeof body.token!=='string'||typeof body.password!=='string') return NextResponse.json({error:'Invitation and password required.'},{status:400,headers});
    return NextResponse.json(await acceptOrganisationInvitation(body.token,body.password),{headers});
  } catch(e) { return NextResponse.json({error:e instanceof UserAdministrationError?e.message:'Unable to accept invitation. Try signing in before requesting a new link.'},{status:e instanceof UserAdministrationError?e.status:503,headers}); }
}
