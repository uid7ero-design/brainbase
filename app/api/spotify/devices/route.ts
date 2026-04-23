import { NextResponse } from 'next/server';
import { getValidAccessToken } from '../../../../lib/spotify/tokens';

export async function GET() {
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
