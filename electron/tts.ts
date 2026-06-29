// Sentence TTS — runs in the Electron Main process. Synthesizes the target sentence
// so the learner can hear the original before shadowing it. Uses the dedicated TTS
// model (not Live). Returns 24kHz mono PCM16 (base64) which the renderer plays via the
// existing AudioQueue. Failure is non-fatal: the page degrades to "no playback".
import { GoogleGenAI } from '@google/genai';

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
