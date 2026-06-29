import type {
  UserProfile,
  PracticeSession,
  Utterance,
  Mistake,
  SentencePattern,
} from '../electron/storage/types';

export interface StoreApi {
  getProfile: () => Promise<UserProfile | null>;
  saveProfile: (p: UserProfile) => Promise<UserProfile>;
  getSessions: (userId: string) => Promise<PracticeSession[]>;
  saveSession: (s: PracticeSession) => Promise<PracticeSession>;
  getUtterances: (sessionId: string) => Promise<Utterance[]>;
  saveUtterance: (u: Utterance) => Promise<Utterance>;
  getMistakes: (userId: string) => Promise<Mistake[]>;
  saveMistake: (m: Mistake) => Promise<Mistake>;
  getSentencePatterns: () => Promise<SentencePattern[]>;
  saveSentencePattern: (p: SentencePattern) => Promise<SentencePattern>;
  getSettings: () => Promise<Record<string, unknown>>;
  saveSettings: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface AiStatus {
  connected: boolean;
  source: 'override' | 'env' | 'file' | 'none';
  backend: string;
}

// Result of the pronunciation scoring engine (electron/scoring.ts).
export interface ScoredMistake {
  category: 'pronunciation' | 'grammar' | 'word_choice' | 'fluency' | 'missing_word';
  original: string;
  correction: string;
  explanation?: string;
}
export interface ScoreResult {
  transcript: string;
  scores: {
    pronunciation: number;
    fluency: number;
    completeness: number;
    naturalness: number;
    confidence: number;
  };
  feedback: string[];
  better: string;
  mistakes: ScoredMistake[];
  mastered_phrases: string[];
}
export type EvaluateResult =
  | { ok: true; result: ScoreResult }
  | { ok: false; error: string };
export type SpeakResult =
  | { ok: true; audioBase64: string; mimeType: string }
  | { ok: false; error: string };

export interface EchoApi {
  startConversation: () => Promise<{ ok: boolean; error?: string }>;
  stopConversation: () => Promise<{ ok: boolean }>;
  sendUserAudio: (base64Pcm16: string) => void;
  onOpen: (cb: () => void) => () => void;
  onAudio: (cb: (chunk: { data: string; mimeType: string }) => void) => () => void;
  onAiText: (cb: (text: string) => void) => () => void;
  onUserText: (cb: (text: string) => void) => () => void;
  onTurnComplete: (cb: () => void) => () => void;
  onError: (cb: (msg: string) => void) => () => void;
  onClosed: (cb: (reason: string) => void) => () => void;
  store: StoreApi;
  aiStatus: () => Promise<AiStatus>;
  evaluateUtterance: (audioBase64: string, targetText: string, mimeType?: string) => Promise<EvaluateResult>;
  speakSentence: (text: string, voiceName?: string) => Promise<SpeakResult>;
}

declare global {
  interface Window {
    echo: EchoApi;
  }
}
