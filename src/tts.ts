import { spawn } from 'child_process';

/**
 * Synthesize speech from text using MiniMax T2A v2.
 * Returns an OGG Opus buffer ready to send as a WhatsApp PTT voice note.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY is not set');

  const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'speech-02-turbo',
      text,
      stream: false,
      voice_setting: { voice_id: 'Podcast_male_en', speed: 1.0, vol: 1.0, pitch: 0 },
      audio_setting: { sample_rate: 24000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`MiniMax TTS error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    data: { audio: string };
    base_resp: { status_code: number; status_msg: string };
  };

  if (data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax TTS failed: ${data.base_resp.status_msg}`);
  }

  const mp3Buffer = Buffer.from(data.data.audio, 'hex');
  return convertToOggOpus(mp3Buffer);
}

function convertToOggOpus(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-f', 'ogg',
      'pipe:1',
    ]);

    const chunks: Buffer[] = [];
    ff.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ff.stderr.on('data', () => {}); // suppress ffmpeg progress output
    ff.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ff.on('error', reject);
    ff.stdin.write(input);
    ff.stdin.end();
  });
}
