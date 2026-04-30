import { NextRequest } from 'next/server';

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID!;
const API_KEY  = process.env.ELEVENLABS_API_KEY!;

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text?.trim()) return new Response('No text', { status: 400 });

  if (!API_KEY || !VOICE_ID) {
    console.error('[/api/speak] Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID');
    return new Response('ElevenLabs not configured', { status: 503 });
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key':   API_KEY,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability:         0.35,
            similarity_boost:  0.85,
            style:             0.40,
            use_speaker_boost: false, // disabling reduces generation latency
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (err) {
    console.error('[/api/speak] ElevenLabs fetch failed:', (err as Error).message);
    return new Response('TTS request failed', { status: 502 });
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[/api/speak] ElevenLabs error', res.status, errBody.slice(0, 400));
    return new Response(errBody || 'ElevenLabs error', { status: res.status });
  }

  // Pipe the stream directly — client starts receiving audio before generation is complete
  return new Response(res.body, {
    headers: {
      'Content-Type':  'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
