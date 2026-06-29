// Sentence TTS — runs in the Electron Main process. Synthesizes the target sentence
// so the learner can hear the original before shadowing it. Uses the dedicated TTS
// model (not Live). Returns 24kHz mono PCM16 (base64) which the renderer plays via the
// existing AudioQueue. Failure is non-fatal: the page degrades to "no playback".
import { GoogleGenAI } from '@google/genai';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

export interface TtsResult {
  // base64 PCM16. mimeType carries the sample rate, e.g. audio/L16;rate=24000.
  audioBase64: string;
  mimeType: string;
}

export async function synthesizeSentence(
  apiKey: string,
  text: string,
  voiceName = 'Kore',
): Promise<TtsResult> {
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error('TTS returned no audio');
  return {
    audioBase64: part.inlineData.data,
    mimeType: part.inlineData.mimeType || 'audio/L16;rate=24000',
  };
}

// Cached synthesis: TTS is generative, so re-synthesizing the same sentence wastes an
// API call AND yields a slightly different voice each time. We hash (model|voice|text)
// and persist the audio on disk; replays read from disk and never hit the model again.
export async function synthesizeSentenceCached(
  apiKey: string,
  text: string,
  cacheDir: string,
  voiceName = 'Kore',
): Promise<TtsResult & { cached: boolean }> {
  const hash = createHash('sha1').update(`${TTS_MODEL}|${voiceName}|${text}`).digest('hex');
  const file = join(cacheDir, `${hash}.json`);
  if (existsSync(file)) {
    try {
      const hit = JSON.parse(readFileSync(file, 'utf8')) as TtsResult;
      if (hit.audioBase64) return { ...hit, cached: true };
    } catch { /* corrupt cache entry → fall through and regenerate */ }
  }
  const fresh = await synthesizeSentence(apiKey, text, voiceName);
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(fresh));
  } catch { /* cache write failure is non-fatal; playback still works */ }
  return { ...fresh, cached: false };
}
