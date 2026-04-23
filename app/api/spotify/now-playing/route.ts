import { NextResponse } from 'next/server';
import { getValidAccessToken } from '../../../../lib/spotify/tokens';

const API_BASE = 'https://api.spotify.com/v1';

export async function GET() {
  const token = await getValidAccessToken();
  if (!token) return NextResponse.json({ connected: false });

  const res = await fetch(`${API_BASE}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 204 || res.status === 202) {
    return NextResponse.json({ connected: true, isPlaying: false, track: null });
  }

  if (!res.ok) {
    return NextResponse.json({ connected: true, isPlaying: false, track: null });
  }

  const data = await res.json();
  if (!data?.item) return NextResponse.json({ connected: true, isPlaying: false, track: null });

  return NextResponse.json({
    connected: true,
    isPlaying: data.is_playing,
    track: {
      id:       data.item.id,
      name:     data.item.name,
      artist:   data.item.artists.map((a: { name: string }) => a.name).join(', '),
      album:    data.item.album.name,
      albumArt: data.item.album.images[0]?.url ?? null,
      duration: data.item.duration_ms,
      progress: data.progress_ms,
      uri:      data.item.uri,
    },
  });
}
