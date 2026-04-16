import { NextResponse } from 'next/server';
import { z } from 'zod';
import textToSpeech from '@google-cloud/text-to-speech';

/**
 * /api/tts/google — Google Cloud Text-to-Speech proxy.
 *
 * Synthesizes `text` with a Neural2 voice and returns MP3 bytes. Credentials
 * stay on the server (service-account JSON at GOOGLE_APPLICATION_CREDENTIALS).
 * The client player fetches the blob and plays it through an HTMLAudioElement.
 */

const bodySchema = z.object({
  text: z.string().min(1).max(5000),
  voiceName: z.string().optional(),
  languageCode: z.string().optional(),
  speed: z.number().min(0.25).max(4).optional(),
  pitch: z.number().min(-20).max(20).optional(),
});

let cachedClient: InstanceType<typeof textToSpeech.TextToSpeechClient> | null = null;
function getClient() {
  if (!cachedClient) cachedClient = new textToSpeech.TextToSpeechClient();
  return cachedClient;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid body', detail: (e as Error).message },
      { status: 400 },
    );
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return NextResponse.json(
      {
        error: 'NOT_CONFIGURED',
        detail: 'GOOGLE_APPLICATION_CREDENTIALS is not set on the server.',
      },
      { status: 503 },
    );
  }

  const languageCode = parsed.languageCode ?? 'en-US';
  const voiceName = parsed.voiceName ?? 'en-US-Neural2-F';

  try {
    const [response] = await getClient().synthesizeSpeech({
      input: { text: parsed.text },
      voice: { languageCode, name: voiceName },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: parsed.speed ?? 1.0,
        pitch: parsed.pitch ?? 0,
      },
    });

    const audio = response.audioContent;
    if (!audio) {
      return NextResponse.json(
        { error: 'EMPTY_AUDIO', detail: 'Google returned no audioContent.' },
        { status: 502 },
      );
    }

    const bytes = audio instanceof Uint8Array ? audio : Buffer.from(audio, 'base64');
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[/api/tts/google] synth error:', e);
    return NextResponse.json(
      { error: 'SYNTH_FAILED', detail: (e as Error).message },
      { status: 502 },
    );
  }
}
