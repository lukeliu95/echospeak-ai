// LocalAdapter — development-tier persistence.
//
// Why JSON-file (lowdb-style) instead of better-sqlite3: better-sqlite3 ships a
// native binary that must be rebuilt against Electron's ABI (electron-rebuild),
// which is a common source of "module did not self-register" crashes. The cloud
// source of truth is Supabase Postgres; the local store only needs to be a stable
// dev fallback, so we use a single atomically-written JSON file in Electron's
// userData dir. No native compilation, zero rebuild risk.
//
// The on-disk shape mirrors the 5 tables of docs/design/review/data-model.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  StorageAdapter,
  UserProfile,
  PracticeSession,
  Utterance,
  Mistake,
  SentencePattern,
} from './types';

interface DbShape {
  schema_version: number;
  user_profile: UserProfile[];
  practice_session: PracticeSession[];
  utterance: Utterance[];
  mistake: Mistake[];
  sentence_pattern: SentencePattern[];
  settings: Record<string, unknown>;
}

const EMPTY_DB: DbShape = {
  schema_version: 1,
  user_profile: [],
  practice_session: [],
  utterance: [],
  mistake: [],
  sentence_pattern: [],
  settings: {},
};

export class LocalAdapter implements StorageAdapter {
  readonly backendName = 'local';
  private file: string;
  private db: DbShape = structuredClone(EMPTY_DB);

  // dataDir is Electron's app.getPath('userData') in production; a temp dir in tests.
  constructor(dataDir: string) {
    this.file = join(dataDir, 'echospeak-data.json');
  }

  async init(): Promise<void> {
    mkdirSync(dirname(this.file), { recursive: true });
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'));
        this.db = { ...structuredClone(EMPTY_DB), ...raw };
      } catch {
        // Corrupt file → start clean but keep a .bak so nothing is silently lost.
        try { renameSync(this.file, this.file + '.bak'); } catch { /* ignore */ }
        this.db = structuredClone(EMPTY_DB);
        this.flush();
      }
    } else {
      this.flush();
    }
  }

  // Atomic write: write to a temp file then rename (rename is atomic on same fs).
  private flush(): void {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }

  // Upsert by id into a table array.
  private upsert<T extends { id: string }>(table: T[], row: T): T {
    const i = table.findIndex((r) => r.id === row.id);
    if (i >= 0) table[i] = row;
    else table.push(row);
    return row;
  }

  // --- user_profile (single-user: keep newest, but store as array per data-model) ---
  async saveProfile(profile: UserProfile): Promise<UserProfile> {
    this.upsert(this.db.user_profile, profile);
    this.flush();
    return profile;
  }
  async getProfile(): Promise<UserProfile | null> {
    return this.db.user_profile[this.db.user_profile.length - 1] ?? null;
  }

  // --- practice_session ---
  async saveSession(session: PracticeSession): Promise<PracticeSession> {
    this.upsert(this.db.practice_session, session);
    this.flush();
    return session;
  }
  async getSessions(userId: string): Promise<PracticeSession[]> {
    return this.db.practice_session
      .filter((s) => s.user_id === userId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // --- utterance ---
  async saveUtterance(utterance: Utterance): Promise<Utterance> {
    this.upsert(this.db.utterance, utterance);
    this.flush();
    return utterance;
  }
  async getUtterances(sessionId: string): Promise<Utterance[]> {
    return this.db.utterance.filter((u) => u.session_id === sessionId);
  }

  // --- mistake ---
  async saveMistake(mistake: Mistake): Promise<Mistake> {
    this.upsert(this.db.mistake, mistake);
    this.flush();
    return mistake;
  }
  async getMistakes(userId: string): Promise<Mistake[]> {
    // Review-priority order: unmastered first, then by review_count desc (PRD §8).
    return this.db.mistake
      .filter((m) => m.user_id === userId)
      .sort((a, b) => {
        if (a.mastered !== b.mastered) return a.mastered ? 1 : -1;
        return b.review_count - a.review_count;
      });
  }

  // --- sentence_pattern ---
  async saveSentencePattern(pattern: SentencePattern): Promise<SentencePattern> {
    this.upsert(this.db.sentence_pattern, pattern);
    this.flush();
    return pattern;
  }
  async getSentencePatterns(): Promise<SentencePattern[]> {
    return this.db.sentence_pattern.slice();
  }

  // --- settings ---
  async getSettings(): Promise<Record<string, unknown>> {
    return { ...this.db.settings };
  }
  async saveSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.db.settings = { ...this.db.settings, ...patch };
    this.flush();
    return { ...this.db.settings };
  }
}
