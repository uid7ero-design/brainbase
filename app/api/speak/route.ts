import { NextRequest } from 'next/server';

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID!;
const API_KEY  = process.env.ELEVENLABS_API_KEY!;

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text?.trim()) return new Response('No text', { status: 400 });

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.85,
          style: 0.40,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return new Response(err, { status: res.status });
  }

  return new Response(res.body, {
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}
