import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken } from '../../../../lib/spotify/tokens';

const API_BASE = 'https://api.spotify.com/v1';

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ tracks: [] });

  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const url = `${API_BASE}/search?${new URLSearchParams({ q, type: 'track', limit: '6', market: 'from_token' })}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) return NextResponse.json({ tracks: [] });

  const data = await res.json();
  const tracks = (data.tracks?.items ?? []).map((item: {
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string; images: Array<{ url: string }> };
    uri: string;
    duration_ms: number;
  }) => ({
    id:       item.id,
    name:     item.name,
    artist:   item.artists.map(a => a.name).join(', '),
    album:    item.album.name,
    albumArt: item.album.images[1]?.url ?? item.album.images[0]?.url ?? null,
    uri:      item.uri,
    duration: item.duration_ms,
  }));

  return NextResponse.json({ tracks });
}
