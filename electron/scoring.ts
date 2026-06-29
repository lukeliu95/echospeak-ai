// Pronunciation scoring engine — runs in the Electron Main process (holds the API key).
//
// Unlike the conversation feature (Gemini Live), shadowing scoring is a single
// multimodal request: we hand Gemini the user's recorded audio + the target text and
// ask for a structured rubric back. responseMimeType:application/json + responseSchema
// forces a parseable result so the renderer never has to parse free text.
//
// The same evaluateUtterance() is imported by test-scoring-roundtrip.mjs so the proof
// exercises the exact code path the app uses.
import { GoogleGenAI, Type } from '@google/genai';

export const SCORING_MODEL = 'gemini-2.5-flash';

// One mistake the user made on this sentence.
export interface ScoredMistake {
  // 'missing_word' = dropped a word; 'pronunciation' = said a word wrong; etc.
  category: 'pronunciation' | 'grammar' | 'word_choice' | 'fluency' | 'missing_word';
  original: string;   // what the user said (or "—" if a word was omitted)
  correction: string; // what it should have been
  explanation?: string;
}

export interface ScoreResult {
  transcript: string; // what Gemini heard the user actually say
  scores: {
    pronunciation: number; // 0-100
    fluency: number;
    completeness: number;
    naturalness: number;
    confidence: number;
  };
  // 1-2 short, encouraging coaching lines (AI Coach voice: praise first, then the
  // single most important fix, naming the exact word/sound). Chinese kept light.
  feedback: string[];
  // "Better:" rewrite of the target if the user diverged; else echoes the target.
  better: string;
  mistakes: ScoredMistake[];
  // short expressions worth remembering from this sentence (right rail tags).
  mastered_phrases: string[];
}

// JSON schema Gemini must fill. Keeps the renderer free of free-text parsing.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING },
    scores: {
      type: Type.OBJECT,
      properties: {
        pronunciation: { type: Type.INTEGER },
        fluency: { type: Type.INTEGER },
        completeness: { type: Type.INTEGER },
        naturalness: { type: Type.INTEGER },
        confidence: { type: Type.INTEGER },
      },
      required: ['pronunciation', 'fluency', 'completeness', 'naturalness', 'confidence'],
    },
    feedback: { type: Type.ARRAY, items: { type: Type.STRING } },
    better: { type: Type.STRING },
    mistakes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          original: { type: Type.STRING },
          correction: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ['category', 'original', 'correction'],
      },
    },
    mastered_phrases: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['transcript', 'scores', 'feedback', 'better', 'mistakes', 'mastered_phrases'],
};

// The rubric prompt. Voice mirrors aiCoach.ts: praise first, only the 1-2 most
// important fixes, name the exact word/sound, never lecture, keep Chinese light.
function buildPrompt(targetText: string): string {
  return `You are an encouraging English pronunciation coach for a Chinese native speaker doing a shadowing (跟读) exercise.

The TARGET sentence the learner was asked to repeat is:
"${targetText}"

Listen to the attached audio (the learner repeating the sentence) and return ONLY JSON matching the schema.

Rules:
1. transcript: write what the learner ACTUALLY said, word for word (even if wrong or incomplete). Do NOT copy the target — transcribe the real audio.
2. scores: rate 0-100 on five dimensions. Be fair but honest — a near-perfect read is 85-95, a read with a clear error is 60-80, a poor read is below 55.
   - pronunciation: clarity of individual sounds/words
   - fluency: rhythm, pace, smoothness, pauses
   - completeness: how much of the target was actually said (drop words → lower)
   - naturalness: intonation and stress sounding native-like
   - confidence: steadiness, no excessive hesitation
3. feedback: 1-2 short lines. ALWAYS start by praising something real. Then point out at most ONE most-important fix, naming the exact word or sound. Encouraging, never a grammar lecture. A little Chinese is fine (<30%).
4. better: the corrected/target sentence the learner should aim for next time.
5. mistakes: list each missed or mispronounced word. category is one of pronunciation|grammar|word_choice|fluency|missing_word. For a dropped word use category "missing_word", original "—", correction the missing word. Empty array if the read was clean.
6. mastered_phrases: 1-3 short useful expressions from the target the learner handled well (for a "today's expressions" list).

Return JSON only.`;
}

export interface EvaluateInput {
  userAudioBase64: string; // base64-encoded audio bytes (wav or raw pcm)
  targetText: string;
  // mime for the inline audio. Default audio/wav. For raw 16k PCM use
  // 'audio/pcm;rate=16000' (Gemini accepts L16 pcm with a rate hint).
  mimeType?: string;
}

// Core: hand audio + target to Gemini, get the structured rubric back.
export async function evaluateUtterance(
  apiKey: string,
  input: EvaluateInput,
): Promise<ScoreResult> {
  const ai = new GoogleGenAI({ apiKey });
  const mimeType = input.mimeType || 'audio/wav';

  const res = await ai.models.generateContent({
    model: SCORING_MODEL,
    contents: [
      {
        parts: [
          { text: buildPrompt(input.targetText) },
          { inlineData: { mimeType, data: input.userAudioBase64 } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Low temperature → stable, repeatable scoring.
      temperature: 0.2,
    },
  });

  const text = res.text;
  if (!text) throw new Error('scoring returned empty response');
  let parsed: ScoreResult;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('scoring returned non-JSON: ' + text.slice(0, 200));
  }
  // Clamp scores into 0-100 so a model slip can never corrupt stored stats.
  const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  parsed.scores = {
    pronunciation: clamp(parsed.scores?.pronunciation),
    fluency: clamp(parsed.scores?.fluency),
    completeness: clamp(parsed.scores?.completeness),
    naturalness: clamp(parsed.scores?.naturalness),
    confidence: clamp(parsed.scores?.confidence),
  };
  parsed.feedback = Array.isArray(parsed.feedback) ? parsed.feedback : [];
  parsed.mistakes = Array.isArray(parsed.mistakes) ? parsed.mistakes : [];
  parsed.mastered_phrases = Array.isArray(parsed.mastered_phrases) ? parsed.mastered_phrases : [];
  return parsed;
}
