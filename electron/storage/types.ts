// Shared data-model types — mirror docs/design/review/data-model.json (PRD §12).
// These are the canonical row shapes used by every StorageAdapter.

export type CEFR = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

export interface Priority {
  listening: number;
  speaking: number;
  reading: number;
  writing: number;
}

// --- user_profile ---
export interface UserProfile {
  id: string;
  native_language: string; // default 'zh-CN'
  target_language: string; // default 'en'
  listening_level: CEFR;
  speaking_level: CEFR;
  daily_practice_minutes: 15 | 30 | 45 | 60;
  priority: Priority; // JSON in storage
  interests: string[]; // JSON in storage
  business_scenarios: string[]; // JSON in storage
  created_at: string; // ISO8601
  updated_at: string;
}

// --- practice_session ---
export type SessionMode = 'daily' | 'quick' | 'free_talk' | 'review';
export interface PracticeSession {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  planned_minutes: number;
  actual_minutes: number;
  speaking_minutes: number;
  listening_minutes: number;
  completed: boolean;
  topic?: string | null;
  mode: SessionMode;
  summary?: string | null;
  created_at: string;
}

// --- utterance ---
export type UtteranceType =
  | 'shadowing'
  | 'conversation'
  | 'retell'
  | 'sentence_substitution';
export interface Utterance {
  id: string;
  session_id: string;
  type: UtteranceType;
  prompt_text: string;
  user_transcript?: string | null;
  improved_text?: string | null;
  audio_path?: string | null;
  score_pronunciation?: number | null;
  score_fluency?: number | null;
  score_completeness?: number | null;
  score_naturalness?: number | null;
  score_confidence?: number | null;
  feedback?: string | null;
  created_at: string;
}

// --- mistake ---
export type MistakeCategory =
  | 'pronunciation'
  | 'grammar'
  | 'word_choice'
  | 'fluency'
  | 'missing_word';
export interface Mistake {
  id: string;
  user_id: string;
  utterance_id: string;
  category: MistakeCategory;
  original: string;
  correction: string;
  explanation?: string | null;
  review_count: number;
  mastered: boolean;
  created_at: string;
  updated_at: string;
}

// --- sentence_pattern ---
export interface SentencePattern {
  id: string;
  pattern: string;
  meaning_zh?: string | null;
  examples: string[]; // JSON in storage
  level: 'A1' | 'A2' | 'B1' | 'B2';
  scenario?: string | null;
  user_mastery_score: number;
}

// The full storage interface. Local + Supabase adapters both implement this.
export interface StorageAdapter {
  readonly backendName: string;
  init(): Promise<void>;

  // user_profile
  saveProfile(profile: UserProfile): Promise<UserProfile>;
  getProfile(): Promise<UserProfile | null>;

  // practice_session
  saveSession(session: PracticeSession): Promise<PracticeSession>;
  getSessions(userId: string): Promise<PracticeSession[]>;

  // utterance
  saveUtterance(utterance: Utterance): Promise<Utterance>;
  getUtterances(sessionId: string): Promise<Utterance[]>;

  // mistake
  saveMistake(mistake: Mistake): Promise<Mistake>;
  getMistakes(userId: string): Promise<Mistake[]>;

  // sentence_pattern
  saveSentencePattern(pattern: SentencePattern): Promise<SentencePattern>;
  getSentencePatterns(): Promise<SentencePattern[]>;

  // app settings (key/value bag — reminder, recording policy, key override, etc.)
  getSettings(): Promise<Record<string, unknown>>;
  saveSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
}
