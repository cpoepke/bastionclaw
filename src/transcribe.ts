export async function transcribeAudio(buffer: Buffer): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-large-v3-turbo');

  const response = await fetch(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Groq API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}
