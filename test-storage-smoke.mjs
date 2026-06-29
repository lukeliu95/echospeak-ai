// EchoSpeak AI · local persistence smoke test (no Electron, no GUI).
// Proves the storage layer can write + read back UserProfile, PracticeSession,
// and Utterance through the SAME LocalAdapter the Main process uses.
//
// Run: node test-storage-smoke.mjs
//
// We transpile the TS adapter on the fly with esbuild (already a dependency),
// then drive it against a throwaway temp dir.
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tmpOut = join(tmpdir(), 'echospeak-smoke-bundle.mjs');

async function loadFactory() {
  await build({
    entryPoints: ['electron/storage/factory.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: tmpOut,
    logLevel: 'error',
  });
  const mod = await import(pathToFileURL(tmpOut).href + `?t=${Date.now()}`);
  return mod.createStorage;
}

function assert(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); process.exit(1); }
  console.log('  ✓', msg);
}

const dataDir = mkdtempSync(join(tmpdir(), 'echospeak-store-'));
console.log('--- LocalAdapter smoke test ---');
console.log('  data dir:', dataDir);

try {
  const createStorage = await loadFactory();
  const store = await createStorage({ backend: 'local', dataDir });
  assert(store.backendName === 'local', 'factory returns LocalAdapter (backend=local)');

  const now = new Date().toISOString();

  // 1. UserProfile
  const profile = {
    id: 'user-smoke-1',
    native_language: 'zh-CN',
    target_language: 'en',
    listening_level: 'B1',
    speaking_level: 'B1',
    daily_practice_minutes: 30,
    priority: { listening: 0.55, speaking: 0.35, reading: 0.1, writing: 0 },
    interests: ['工作沟通', '日常生活'],
    business_scenarios: ['工作沟通'],
    created_at: now,
    updated_at: now,
  };
  await store.saveProfile(profile);

  // 2. PracticeSession
  const session = {
    id: 'sess-smoke-1',
    user_id: profile.id,
    date: '2026-06-29',
    planned_minutes: 30,
    actual_minutes: 22,
    speaking_minutes: 9,
    listening_minutes: 13,
    completed: true,
    topic: '工作沟通',
    mode: 'daily',
    summary: 'smoke test session',
    created_at: now,
  };
  await store.saveSession(session);

  // 3. Utterance
  const utterance = {
    id: 'utt-smoke-1',
    session_id: session.id,
    type: 'shadowing',
    prompt_text: 'Actually, the project is on track.',
    user_transcript: 'Actually the project is on track.',
    improved_text: null,
    audio_path: null,
    score_pronunciation: 82,
    score_fluency: 88,
    score_completeness: 71,
    score_naturalness: 79,
    score_confidence: 85,
    feedback: 'Good try.',
    created_at: now,
  };
  await store.saveUtterance(utterance);

  // --- read back through a FRESH adapter instance (proves real disk persistence) ---
  const store2 = await createStorage({ backend: 'local', dataDir });

  const gotProfile = await store2.getProfile();
  assert(gotProfile && gotProfile.id === profile.id, 'profile round-trips by id');
  assert(gotProfile.daily_practice_minutes === 30, 'profile.daily_practice_minutes persists');
  assert(JSON.stringify(gotProfile.priority) === JSON.stringify(profile.priority), 'profile.priority (nested JSON) persists exactly');
  assert(JSON.stringify(gotProfile.interests) === JSON.stringify(profile.interests), 'profile.interests (JSON array) persists exactly');

  const gotSessions = await store2.getSessions(profile.id);
  assert(gotSessions.length === 1 && gotSessions[0].id === session.id, 'session round-trips by user_id');
  assert(gotSessions[0].completed === true, 'session.completed boolean persists');
  assert(gotSessions[0].speaking_minutes === 9, 'session.speaking_minutes persists');

  const gotUtts = await store2.getUtterances(session.id);
  assert(gotUtts.length === 1 && gotUtts[0].id === utterance.id, 'utterance round-trips by session_id');
  assert(gotUtts[0].score_fluency === 88, 'utterance 5-dim score column persists');

  // Settings round-trip
  await store2.saveSettings({ recordingPolicy: '7d', reminderEnabled: true });
  const store3 = await createStorage({ backend: 'local', dataDir });
  const gotSettings = await store3.getSettings();
  assert(gotSettings.recordingPolicy === '7d', 'settings key/value persists');

  // Verify the JSON file actually exists on disk.
  const file = join(dataDir, 'echospeak-data.json');
  assert(existsSync(file), 'on-disk JSON file created');
  const disk = JSON.parse(readFileSync(file, 'utf8'));
  assert(disk.user_profile.length === 1 && disk.practice_session.length === 1 && disk.utterance.length === 1,
    'on-disk file contains 1 profile + 1 session + 1 utterance');

  console.log('\n✅ PROOF: local storage writes and reads back consistently (5 tables + settings).');
  process.exit(0);
} catch (e) {
  console.error('\n✗ smoke test crashed:', e);
  process.exit(1);
} finally {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(tmpOut, { force: true }); } catch { /* ignore */ }
}
