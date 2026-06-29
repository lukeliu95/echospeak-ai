// Gemini Live session wrapper — runs in the Electron Main process (holds the API key).
// Mirrors the verified pattern in test-gemini-live.mjs, extended for streaming user audio in.
import { GoogleGenAI, Modality } from '@google/genai';
import type { Session } from '@google/genai';
import { AI_COACH_SYSTEM_INSTRUCTION } from './aiCoach';

export const LIVE_MODEL = 'models/gemini-3.1-flash-live-preview';

// Events the session emits back toward the renderer (via IPC) or a test harness.
export interface LiveSessionEvents {
  onOpen?: () => void;
  // AI audio chunk: base64 PCM + its mime (typically 24kHz). Renderer plays it.
  onAudio?: (base64Pcm: string, mimeType: string) => void;
  // AI's own speech, as text (outputAudioTranscription).
  onAiText?: (textChunk: string) => void;
  // The user's speech, recognized as text (inputAudioTranscription).
  onUserText?: (textChunk: string) => void;
  // A conversational turn finished.
  onTurnComplete?: () => void;
  onError?: (message: string) => void;
  onClose?: (reason: string) => void;
}

export interface LiveSessionHandle {
  // Push a chunk of user microphone audio (16kHz mono PCM16, base64-encoded).
  sendUserAudio: (base64Pcm16: string) => void;
  // Optional: send text (used by the roundtrip test as a fallback / kickoff).
  sendText: (text: string) => void;
  close: () => void;
}

export async function startLiveSession(
  apiKey: string,
  events: LiveSessionEvents,
): Promise<LiveSessionHandle> {
  const ai = new GoogleGenAI({ apiKey });

  const config = {
    responseModalities: [Modality.AUDIO],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
    // Both transcriptions on, so the UI can show both sides as chat bubbles.
    outputAudioTranscription: {},
    inputAudioTranscription: {},
    systemInstruction: { parts: [{ text: AI_COACH_SYSTEM_INSTRUCTION }] },
  };

  const session: Session = await ai.live.connect({
    model: LIVE_MODEL,
    config,
    callbacks: {
      onopen: () => events.onOpen?.(),
      onmessage: (msg: any) => {
        const sc = msg.serverContent;
        const parts = sc?.modelTurn?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            events.onAudio?.(part.inlineData.data, part.inlineData.mimeType || 'audio/pcm;rate=24000');
          }
        }
        const aiText = sc?.outputTranscription?.text;
        if (aiText) events.onAiText?.(aiText);
        const userText = sc?.inputTranscription?.text;
        if (userText) events.onUserText?.(userText);
        if (sc?.turnComplete) events.onTurnComplete?.();
      },
      onerror: (e: any) => events.onError?.(e?.message || String(e)),
      onclose: (e: any) => events.onClose?.(e?.reason || '(normal close)'),
    },
  });

  return {
    sendUserAudio: (base64Pcm16: string) => {
      session.sendRealtimeInput({
        audio: { data: base64Pcm16, mimeType: 'audio/pcm;rate=16000' },
      });
    },
    sendText: (text: string) => {
      session.sendClientContent({ turns: [text] });
    },
    close: () => session.close(),
  };
}
