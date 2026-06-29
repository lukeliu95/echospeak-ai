// EchoSpeak AI · Wave 2 data-closure smoke test (no Electron, no GUI, no mic).
// Proves the training page's data loop makes Home stats go from 0 -> non-zero:
//   1. Take a realistic scoring result (shape of evaluateUtterance output).
//   2. Write utterance (5-dim) + mistake + a completed practice_session through the
//      SAME LocalAdapter the Main process uses (PracticePage.persistTake/finishSet logic).
//   3. Read everything back through a FRESH adapter (real disk round-trip).
//   4. Run the SAME derived stat functions Home uses (computeStreak / weekSpeakingMinutes)
//      and assert they are now > 0.
//
// computeStreak / weekSpeakingMinutes are bundled from src/lib/useProfile.ts (the real
// source) with packages external, so React is not pulled in.
//
// Run: node test-practice-data-closure.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function assert(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); process.exit(1); }
  console.log('  ✓', msg);
}

async function bundle(entry, outName) {
  const out = join(process.cwd(), outName);
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', packages: 'external' });
  const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
  return { mod, out };
}

const dataDir = mkdtempSync(join(tmpdir(), 'echospeak-closure-'));
const tmpFiles = [];
console.log('--- Practice data-closure smoke test ---');
console.log('  data dir:', dataDir);

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

try {
  const a = await bundle('electron/storage/factory.ts', '.closure-store.tmp.mjs'); tmpFiles.push(a.out);
  const b = await bundle('src/lib/useProfile.ts', '.closure-stats.tmp.mjs'); tmpFiles.push(b.out);
  const createStorage = a.mod.createStorage;
  const { computeStreak, weekSpeakingMinutes } = b.mod;

  const store = await createStorage({ backend: 'local', dataDir });
  const now = new Date().toISOString();
  const userId = 'user-closure-1';
  const sessionId = 'sess-closure-1';

  // profile (Home needs profile.id to load sessions)
  await store.saveProfile({
    id: userId, native_language: 'zh-CN', target_language: 'en',
    listening_level: 'B1', speaking_level: 'B1', daily_practice_minutes: 30,
    priority: { listening: 0.5, speaking: 0.4, reading: 0.1, writing: 0 },
    interests: ['工作沟通'], business_scenarios: ['工作沟通'],
    created_at: now, updated_at: now,
  });

  // Realistic scoring result (matches evaluateUtterance output shape).
  const scoreResult = {
    transcript: 'Actually, the project is on track, but we need one more week for test.',
    scores: { pronunciation: 78, fluency: 88, completeness: 90, naturalness: 85, confidence: 90 },
    feedback: ["Great rhythm!", "Try the full word 'testing'."],
    better: 'Actually, the project is on track, but we need one more week for testing.',
    mistakes: [{ category: 'pronunciation', original: 'test', correction: 'testing', explanation: "say -ing" }],
    mastered_phrases: ['on track', 'one more week'],
  };

  // --- persistTake: utterance + mistake (mirrors PracticePage) ---
  const utteranceId = 'utt-closure-1';
  await store.saveUtterance({
    id: utteranceId, session_id: sessionId, type: 'shadowing',
    prompt_text: 'Actually, the project is on track, but we need one more week for testing.',
    user_transcript: scoreResult.transcript, improved_text: scoreResult.better, audio_path: null,
    score_pronunciation: scoreResult.scores.pronunciation,
    score_fluency: scoreResult.scores.fluency,
    score_completeness: scoreResult.scores.completeness,
    score_naturalness: scoreResult.scores.naturalness,
    score_confidence: scoreResult.scores.confidence,
    feedback: scoreResult.feedback.join(' '), created_at: now,
  });
  for (const m of scoreResult.mistakes) {
    await store.saveMistake({
      id: 'mis-closure-1', user_id: userId, utterance_id: utteranceId,
      category: m.category, original: m.original, correction: m.correction,
      explanation: m.explanation, review_count: 0, mastered: false,
      created_at: now, updated_at: now,
    });
  }

  // --- finishSet: completed session with speaking minutes (mirrors PracticePage) ---
  await store.saveSession({
    id: sessionId, user_id: userId, date: todayStr(),
    planned_minutes: 30, actual_minutes: 12, speaking_minutes: 6, listening_minutes: 6,
    completed: true, topic: '工作沟通', mode: 'daily',
    summary: '跟读 5/5 句 · 工作沟通', created_at: now,
  });

  // --- read back through a FRESH adapter (real disk persistence) ---
  const store2 = await createStorage({ backend: 'local', dataDir });
  const sessions = await store2.getSessions(userId);
  const utts = await store2.getUtterances(sessionId);
  const mistakes = await store2.getMistakes(userId);

  assert(sessions.length === 1 && sessions[0].completed, 'completed practice_session round-trips');
  assert(utts.length === 1 && utts[0].score_fluency === 88, 'utterance with 5-dim score round-trips');
  assert(mistakes.length === 1 && mistakes[0].correction === 'testing', 'mistake round-trips with correction');

  // --- the payoff: Home stats derive NON-ZERO from this data ---
  const streak = computeStreak(sessions);
  const weekMin = weekSpeakingMinutes(sessions);
  console.log('  → computeStreak(sessions)        =', streak);
  console.log('  → weekSpeakingMinutes(sessions)  =', weekMin);
  assert(streak >= 1, 'Home 连续天数 (streak) is non-zero (was 0 before practice)');
  assert(weekMin >= 1, 'Home 本周开口分钟 (weekly speaking minutes) is non-zero');

  const file = join(dataDir, 'echospeak-data.json');
  assert(existsSync(file), 'on-disk JSON file written');

  console.log('\n✅ PROOF: score → utterance/mistake/session → read-back → Home stats compute NON-ZERO.');
  process.exit(0);
} catch (e) {
  console.error('\n✗ data-closure test crashed:', e);
  process.exit(1);
} finally {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  for (const f of tmpFiles) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
}
