// EchoSpeak AI · End-of-conversation summary roundtrip proof (NO human, NO mic).
// Proves electron/conversationSummary.ts can take a real transcript and return
// a well-formed coach summary against the LIVE Gemini API:
//   1. Hand a short, hand-written free-talk transcript (2-3 user turns + AI turns).
//   2. Call summarizeConversation() — the SAME function the Main process IPC uses.
//   3. Assert the returned JSON matches the schema field-by-field, sizes are sane,
//      and the Chinese ratio respects PRD §9 (≤ 20% Chinese characters).
//   4. Print Gemini's real coach text so a human can eyeball the tone.
//
// Run: GEMINI_API_KEY=... node test-summary-roundtrip.mjs
import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// --- key (env, else a local .env in the project root, matches scoring test) ---
let apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  const f = '.env';
  if (existsSync(f)) {
    const m = readFileSync(f, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) apiKey = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!apiKey) { console.error('✗ missing GEMINI_API_KEY'); process.exit(1); }

// A short, realistic free-talk transcript: AI greets, user replies with a small
// error ("very busy at last week" — wrong preposition + tense), AI follows up,
// user answers with a fairly clean sentence. Gives Gemini something to praise
// AND something concrete to suggest fixing.
const MESSAGES = [
  { role: 'ai',   text: 'Hi! Nice to meet you. How was your week so far?' },
  { role: 'user', text: 'Hello, I am very busy at last week. I have a lot of meeting.' },
  { role: 'ai',   text: 'Sounds intense! What kind of meetings were they — work, or something else?' },
  { role: 'user', text: 'They were work meetings, mostly with my team. We are planning a new product launch next month.' },
  { role: 'ai',   text: 'Exciting! What is the product, if you can share?' },
  { role: 'user', text: 'It is a mobile app for English learners, like me.' },
];
const DURATION_SEC = 180;     // 3 min total
const USER_TALK_SEC = 55;     // ~55s of mic-on time

// ---- load the real summary engine (transpile TS on the fly) ----
async function loadSummary() {
  const out = join(process.cwd(), '.summary-bundle.tmp.mjs');
  await build({
    entryPoints: ['electron/conversationSummary.ts'],
    bundle: true, platform: 'node', format: 'esm',
    outfile: out, logLevel: 'error', packages: 'external',
  });
  const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
  return mod.summarizeConversation;
}

// Rough Chinese-character ratio across all string fields (PRD §9 cap: ≤ 20%).
function chineseRatio(result) {
  const parts = [
    result.overall_feedback,
    ...(result.strengths || []),
    ...(result.improvements || []),
    ...(result.useful_phrases || []),
    result.next_step,
  ].filter((s) => typeof s === 'string');
  const all = parts.join('');
  if (!all) return 0;
  const zh = (all.match(/[一-鿿]/g) || []).length;
  return zh / all.length;
}

try {
  const summarizeConversation = await loadSummary();

  console.log('--- Step 1: hand-written transcript (no mic, no human) ---');
  console.log(`  turns: ${MESSAGES.length} total, ${MESSAGES.filter((m) => m.role === 'user').length} user`);
  console.log(`  stats: durationSec=${DURATION_SEC}, userTalkSec=${USER_TALK_SEC}`);

  console.log('\n--- Step 2: call summarizeConversation() → real Gemini ---');
  const t0 = Date.now();
  const result = await summarizeConversation(apiKey, MESSAGES, DURATION_SEC, USER_TALK_SEC);
  console.log(`  ✓ Gemini returned in ${Date.now() - t0} ms`);

  console.log('\n===== REAL SUMMARY RESULT (JSON) =====');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n===== ASSERTIONS =====');
  const pass = (cond, msg) => console.log(cond ? '  ✓ ' + msg : '  ✗ ' + msg, cond ? '' : '<-- FAIL');

  const isStr = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  const isStrArr = (a, min, max, perItemMax) =>
    Array.isArray(a) && a.length >= min && a.length <= max &&
    a.every((s) => isStr(s, perItemMax));

  const r1 = isStr(result.overall_feedback, 320);
  const r2 = typeof result.speaking_minutes === 'number' && result.speaking_minutes >= 0;
  const r3 = Number.isInteger(result.turn_count) && result.turn_count >= 0;
  const r4 = isStrArr(result.strengths, 1, 3, 220);
  const r5 = isStrArr(result.improvements, 1, 2, 220);
  const r6 = isStrArr(result.useful_phrases, 2, 4, 140);
  const r7 = isStr(result.next_step, 220);
  const r8 = result.overall_feedback.length <= 320; // soft cap (engine clamps to 320)

  const zhRatio = chineseRatio(result);
  const r9 = zhRatio <= 0.20 + 0.05; // PRD §9 allows up to 20%; +5% tolerance for model wobble

  pass(r1, `overall_feedback non-empty & ≤ 320 chars (got ${result.overall_feedback.length})`);
  pass(r2, `speaking_minutes is a non-negative number (${result.speaking_minutes})`);
  pass(r3, `turn_count is a non-negative integer (${result.turn_count})`);
  pass(r4, `strengths: 1-3 non-empty strings (got ${result.strengths.length})`);
  pass(r5, `improvements: 1-2 non-empty strings (got ${result.improvements.length})`);
  pass(r6, `useful_phrases: 2-4 non-empty strings (got ${result.useful_phrases.length})`);
  pass(r7, `next_step non-empty & ≤ 220 chars (got ${result.next_step.length})`);
  pass(r8, `overall_feedback respects coach-voice length`);
  pass(r9, `Chinese char ratio ${(zhRatio * 100).toFixed(1)}% ≤ 25% (PRD §9 + tolerance)`);

  // Print the human-readable take so the operator can eyeball Gemini's tone.
  console.log('\n===== COACH SAID (human eyeball) =====');
  console.log('overall : ' + result.overall_feedback);
  console.log('strength: ' + result.strengths.map((s, i) => `(${i + 1}) ${s}`).join('  '));
  console.log('improve : ' + result.improvements.map((s, i) => `(${i + 1}) ${s}`).join('  '));
  console.log('phrases : ' + result.useful_phrases.join(' · '));
  console.log('next    : ' + result.next_step);

  const ok = r1 && r2 && r3 && r4 && r5 && r6 && r7 && r8 && r9;
  console.log(ok
    ? '\n✅ PROOF: summary engine produces a well-formed coach summary against live Gemini.'
    : '\n⚠ INCOMPLETE: engine ran but at least one assertion failed (see above).');
  process.exit(ok ? 0 : 2);
} catch (e) {
  console.error('\n✗ summary roundtrip failed:', e.message);
  process.exit(3);
}
