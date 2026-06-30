// Conversation summary engine — runs in the Electron Main process (holds the API key).
//
// When the learner taps "End & summarize" on the Free-Practice conversation page, we
// hand the full transcript (alternating AI / user turns) + the talk-time stats to
// Gemini and ask it to play "English coach" and return a structured JSON rubric for
// the whole session. Mirrors scoring.ts (single multimodal-style request, JSON schema
// pinned with responseMimeType + responseSchema) so the renderer never has to parse
// free text.
//
// The same summarizeConversation() is imported by test-summary-roundtrip.mjs so the
// proof exercises the exact code path the app uses.
import { GoogleGenAI, Type } from '@google/genai';

export const SUMMARY_MODEL = 'gemini-2.5-flash';

export type SummaryRole = 'ai' | 'user';
export interface SummaryMessage {
  role: SummaryRole;
  text: string;
}

// What the renderer's summary card displays. Fields chosen to satisfy PRD §9
// (AI Coach voice: praise first, ≤1-2 fixes, Chinese ≤ 20%) plus the metrics the
// session card needs (spoken minutes + turn count).
export interface ConversationSummary {
  overall_feedback: string;     // 1-2 sentences: warm overall take + the single most worthwhile fix
  speaking_minutes: number;     // user open-mouth minutes (echoed from caller stats, model may round)
  turn_count: number;           // number of user turns in this session
  strengths: string[];          // 1-3 concrete wins (mention the exact expression/sentence pattern used)
  improvements: string[];       // 1-2 most worthwhile fixes (point at a specific word/phrase)
  useful_phrases: string[];     // 2-4 short English phrases worth remembering from this session
  next_step: string;            // 1 sentence on what to try next, encouraging
}

// JSON schema Gemini must fill. Keeps the renderer free of parsing logic.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overall_feedback: { type: Type.STRING },
    speaking_minutes: { type: Type.NUMBER },
    turn_count: { type: Type.INTEGER },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
    useful_phrases: { type: Type.ARRAY, items: { type: Type.STRING } },
    next_step: { type: Type.STRING },
  },
  required: [
    'overall_feedback',
    'speaking_minutes',
    'turn_count',
    'strengths',
    'improvements',
    'useful_phrases',
    'next_step',
  ],
};

// Format the transcript so Gemini sees an unambiguous, ordered turn list.
function formatTranscript(messages: SummaryMessage[]): string {
  return messages
    .filter((m) => m && typeof m.text === 'string' && m.text.trim().length > 0)
    .map((m, i) => `[${i + 1}] ${m.role === 'ai' ? 'AI Coach' : 'Learner'}: ${m.text.trim()}`)
    .join('\n');
}

function buildPrompt(
  messages: SummaryMessage[],
  durationSec: number,
  userTalkSec: number,
): string {
  const transcript = formatTranscript(messages);
  const userTurns = messages.filter((m) => m.role === 'user' && m.text.trim().length > 0).length;
  const spokenMin = Math.max(0, Math.round((userTalkSec / 60) * 10) / 10);
  const totalMin = Math.max(0, Math.round((durationSec / 60) * 10) / 10);

  return `You are an encouraging English-speaking coach for a Chinese native speaker who just finished a free-talk practice session.

SESSION STATS (already measured, do not re-estimate):
- Total session duration: ~${totalMin} minutes
- Learner's mic-on speaking time: ~${spokenMin} minutes
- Learner turn count: ${userTurns}

TRANSCRIPT (chronological, "AI Coach" = the model, "Learner" = the user; some lines may be empty or short — that's fine):
${transcript || '(no transcript)'}

Return ONLY JSON matching the schema.

Rules (PRD §9 AI Coach voice — follow strictly):
1. overall_feedback: 1-2 sentences. ALWAYS start with genuine, specific praise (cite something the learner actually said). Then name AT MOST ONE most-worthwhile fix. Warm, never lecturing. Mostly English; a touch of Chinese for the human moment is fine (≤ 20% Chinese characters by length).
2. speaking_minutes: echo ${spokenMin} (you may round to one decimal). Do not invent a different number.
3. turn_count: echo ${userTurns}. Do not invent.
4. strengths: 1-3 concrete wins. Each item must point at a specific phrase or grammar choice the learner actually used (quote it). Keep each item short. Mostly English.
5. improvements: 1-2 items MAX. Each item must point at a specific word/phrase the learner could improve, and give the better version. Encouraging tone, never "wrong/错". If the learner said almost nothing, write a single supportive item suggesting they try one full sentence next time.
6. useful_phrases: 2-4 short English expressions worth remembering from THIS conversation (preferably ones the AI Coach used or the learner attempted). English only, no translation, no punctuation lists.
7. next_step: 1 sentence on what to practice next time. Mostly English, optional light Chinese.
8. Hard limits: overall_feedback ≤ 240 characters. Each strengths/improvements item ≤ 140 characters. next_step ≤ 140 characters. Total Chinese characters across all fields ≤ 20% of total length.

If the transcript is empty or only has 1 short line, still return valid JSON: keep fields short, encourage the learner to try again.

Return JSON only.`;
}

// Core: hand the transcript + stats to Gemini, get the structured summary back.
export async function summarizeConversation(
  apiKey: string,
  messages: SummaryMessage[],
  durationSec: number,
  userTalkSec: number,
): Promise<ConversationSummary> {
  const ai = new GoogleGenAI({ apiKey });

  const res = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    contents: [
      {
        parts: [{ text: buildPrompt(messages, durationSec, userTalkSec) }],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Low temperature → steady, repeatable coaching tone.
      temperature: 0.3,
    },
  });

  const text = res.text;
  if (!text) throw new Error('summary returned empty response');
  let parsed: ConversationSummary;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('summary returned non-JSON: ' + text.slice(0, 200));
  }

  // Normalize / clamp so a model slip can never corrupt the UI.
  const trim = (s: unknown, max: number) =>
    typeof s === 'string' ? s.trim().slice(0, max) : '';
  const arr = (a: unknown, max: number, perItem: number) =>
    Array.isArray(a) ? a.slice(0, max).map((s) => trim(s, perItem)).filter(Boolean) : [];

  parsed.overall_feedback = trim(parsed.overall_feedback, 320);
  parsed.speaking_minutes = Math.max(0, Math.round((Number(parsed.speaking_minutes) || 0) * 10) / 10);
  parsed.turn_count = Math.max(0, Math.round(Number(parsed.turn_count) || 0));
  parsed.strengths = arr(parsed.strengths, 3, 200);
  parsed.improvements = arr(parsed.improvements, 2, 200);
  parsed.useful_phrases = arr(parsed.useful_phrases, 4, 120);
  parsed.next_step = trim(parsed.next_step, 200);
  return parsed;
}
