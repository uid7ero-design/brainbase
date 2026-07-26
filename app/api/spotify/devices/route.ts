import { NextResponse } from 'next/server';
import { getValidAccessToken } from '../../../../lib/spotify/tokens';
import { requireGlobalIntegrationAccess, integrationAccessErrorStatus } from '../../../../lib/globalIntegrationAccess';

export async function GET() {
  try {
    await requireGlobalIntegrationAccess('SPOTIFY_OWNER_ORG_ID', 'viewer');
  } catch (err) {
    return NextResponse.json({ error: 'Forbidden' }, { status: integrationAccessErrorStatus(err) });
  }

  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ devices: [] });

  const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) return NextResponse.json({ devices: [] });

  const data = await res.json();
  return NextResponse.json({ devices: data.devices ?? [] });
}
