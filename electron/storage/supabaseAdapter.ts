// SupabaseAdapter — cloud backend (Supabase Postgres).
//
// Drop-in StorageAdapter over @supabase/supabase-js. Single-user / anonymous:
// the app is a personal desktop tool, so there is no auth — the anon key + RLS
// (or an open dev table) is the trust boundary. Schema = the 5 tables of
// docs/design/review/data-model.json plus an app_settings key/value table.
//
// ⚠ NOT YET TESTED AGAINST A REAL SUPABASE PROJECT (the user has not provisioned
// one). Code is complete, typechecks, and aligns with the StorageAdapter interface;
// end-to-end verification is pending a live instance. The expected SQL schema lives
// in README ("Switching to Supabase") and supabase-schema.sql.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  StorageAdapter,
  UserProfile,
  PracticeSession,
  Utterance,
  Mistake,
  SentencePattern,
} from './types';

export interface SupabaseConfig {
  url: string;
  key: string; // anon (or service) key
}

// A single settings row keyed by this id (single-user app).
const SETTINGS_ROW_ID = 'singleton';

export class SupabaseAdapter implements StorageAdapter {
  readonly backendName = 'supabase';
  readonly config: SupabaseConfig;
  private client: SupabaseClient;

  constructor(config?: SupabaseConfig) {
    if (!config?.url || !config?.key) {
      throw new Error(
        'SupabaseAdapter requires { url, key }. Provide them in Settings → 数据后端 (or env SUPABASE_URL / SUPABASE_KEY).',
      );
    }
    this.config = config;
    this.client = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async init(): Promise<void> {
    // Connectivity probe: a trivial select. Surfaces auth/URL errors loudly at
    // startup instead of on first write. A missing-table error here means the
    // migrations (supabase-schema.sql) have not been applied yet.
    const { error } = await this.client.from('user_profile').select('id').limit(1);
    if (error && !/relation .* does not exist|does not exist/i.test(error.message)) {
      throw new Error(`Supabase connectivity failed: ${error.message}`);
    }
  }

  private throwIf(error: { message: string } | null, op: string): void {
    if (error) throw new Error(`Supabase ${op} failed: ${error.message}`);
  }

  // --- user_profile (single-user: upsert by id, read newest) ---
  async saveProfile(profile: UserProfile): Promise<UserProfile> {
    const { error } = await this.client.from('user_profile').upsert(profile, { onConflict: 'id' });
    this.throwIf(error, 'saveProfile');
    return profile;
  }
  async getProfile(): Promise<UserProfile | null> {
    const { data, error } = await this.client
      .from('user_profile')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1);
    this.throwIf(error, 'getProfile');
    return (data?.[0] as UserProfile) ?? null;
  }

  // --- practice_session ---
  async saveSession(session: PracticeSession): Promise<PracticeSession> {
    const { error } = await this.client.from('practice_session').upsert(session, { onConflict: 'id' });
    this.throwIf(error, 'saveSession');
    return session;
  }
  async getSessions(userId: string): Promise<PracticeSession[]> {
    const { data, error } = await this.client
      .from('practice_session')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true });
    this.throwIf(error, 'getSessions');
    return (data as PracticeSession[]) ?? [];
  }

  // --- utterance ---
  async saveUtterance(utterance: Utterance): Promise<Utterance> {
    const { error } = await this.client.from('utterance').upsert(utterance, { onConflict: 'id' });
    this.throwIf(error, 'saveUtterance');
    return utterance;
  }
  async getUtterances(sessionId: string): Promise<Utterance[]> {
    const { data, error } = await this.client
      .from('utterance')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    this.throwIf(error, 'getUtterances');
    return (data as Utterance[]) ?? [];
  }

  // --- mistake (review-priority order: unmastered first, then review_count desc) ---
  async saveMistake(mistake: Mistake): Promise<Mistake> {
    const { error } = await this.client.from('mistake').upsert(mistake, { onConflict: 'id' });
    this.throwIf(error, 'saveMistake');
    return mistake;
  }
  async getMistakes(userId: string): Promise<Mistake[]> {
    const { data, error } = await this.client
      .from('mistake')
      .select('*')
      .eq('user_id', userId)
      .order('mastered', { ascending: true })
      .order('review_count', { ascending: false });
    this.throwIf(error, 'getMistakes');
    return (data as Mistake[]) ?? [];
  }

  // --- sentence_pattern ---
  async saveSentencePattern(pattern: SentencePattern): Promise<SentencePattern> {
    const { error } = await this.client.from('sentence_pattern').upsert(pattern, { onConflict: 'id' });
    this.throwIf(error, 'saveSentencePattern');
    return pattern;
  }
  async getSentencePatterns(): Promise<SentencePattern[]> {
    const { data, error } = await this.client.from('sentence_pattern').select('*');
    this.throwIf(error, 'getSentencePatterns');
    return (data as SentencePattern[]) ?? [];
  }

  // --- settings (single key/value row, merged client-side) ---
  async getSettings(): Promise<Record<string, unknown>> {
    const { data, error } = await this.client
      .from('app_settings')
      .select('data')
      .eq('id', SETTINGS_ROW_ID)
      .limit(1);
    this.throwIf(error, 'getSettings');
    return (data?.[0]?.data as Record<string, unknown>) ?? {};
  }
  async saveSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const current = await this.getSettings();
    const merged = { ...current, ...patch };
    const { error } = await this.client
      .from('app_settings')
      .upsert({ id: SETTINGS_ROW_ID, data: merged }, { onConflict: 'id' });
    this.throwIf(error, 'saveSettings');
    return merged;
  }
}
