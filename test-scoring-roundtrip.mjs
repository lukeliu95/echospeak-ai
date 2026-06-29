// EchoSpeak AI · Programmatic pronunciation-scoring roundtrip proof (NO human mic).
// Proves electron/scoring.ts can score a real audio read and catch a real error:
//   1. Synthesize a DELIBERATELY-FLAWED "user read" with Gemini TTS — we drop a word
//      ("for testing" -> "for test") so the engine has something concrete to catch.
//   2. Wrap the 24kHz PCM as a WAV (what the renderer's MicRecorder produces).
//   3. Feed it through evaluateUtterance() — the SAME function the Main process IPC uses.
//   4. Print the real 5-dim JSON + feedback and assert the engine flagged the omission.
//
// Run: GEMINI_API_KEY=... node test-scoring-roundtrip.mjs
import { GoogleGenAI } from '@google/genai';
import { build } from 'esbuild';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// --- key (env, else a local .env in the project root) ---
let apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  const f = '.env';
  if (existsSync(f)) {
    const m = readFileSync(f, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) apiKey = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!apiKey) { console.error('✗ missing GEMINI_API_KEY'); process.exit(1); }

const TARGET = 'Actually, the project is on track, but we need one more week for testing.';
// The "user" deliberately drops the -ing: says "test" instead of "testing".
const FLAWED_READ = 'Actually, the project is on track, but we need one more week for test.';

const ai = new GoogleGenAI({ apiKey });

// ---- load the real scoring engine (transpile TS on the fly) ----
async function loadScoring() {
  // Emit into the project dir so the external @google/genai resolves from node_modules.
  const out = join(process.cwd(), '.scoring-bundle.tmp.mjs');
  // Keep node builtins + the SDK external so they load as real CJS at runtime
  // (bundling them turns require('child_process') into a broken dynamic require).
  await build({ entryPoints: ['electron/scoring.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', packages: 'external' });
  const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
  return mod.evaluateUtterance;
}

// ---- WAV wrapper for 24kHz mono PCM16 ----
function wavHeader(dataLen, sampleRate) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  return b;
}

async function synthesizeFlawedRead() {
  console.log('--- Step 1: synthesize a flawed "user read" via Gemini TTS ---');
  console.log('  target   :', JSON.stringify(TARGET));
  console.log('  user says:', JSON.stringify(FLAWED_READ), '(dropped "-ing": testing -> test)');
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: FLAWED_READ }] }],
    config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error('TTS returned no audio');
  const mime = part.inlineData.mimeType || '';
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000;
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const wav = Buffer.concat([wavHeader(pcm.length, rate), pcm]);
  writeFileSync('scoring-user-read.wav', wav);
  console.log(`  ✓ TTS ${(pcm.length / 1024).toFixed(1)} KB @ ${rate}Hz → scoring-user-read.wav`);
  return wav.toString('base64');
}

try {
  const evaluateUtterance = await loadScoring();
  const wavBase64 = await synthesizeFlawedRead();

  console.log('\n--- Step 2: score it through evaluateUtterance() (Gemini multimodal) ---');
  const result = await evaluateUtterance(apiKey, { userAudioBase64: wavBase64, targetText: TARGET, mimeType: 'audio/wav' });

  console.log('\n===== REAL SCORING RESULT (JSON) =====');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n===== ASSERTIONS =====');
  const s = result.scores;
  const dimsOk = ['pronunciation', 'fluency', 'completeness', 'naturalness', 'confidence']
    .every((k) => Number.isInteger(s[k]) && s[k] >= 0 && s[k] <= 100);
  const hasFeedback = Array.isArray(result.feedback) && result.feedback.length >= 1;
  const transcribed = (result.transcript || '').toLowerCase();
  // Engine should hear "test" (the flaw), not "testing".
  const heardFlaw = /\btest\b/.test(transcribed) && !/\btesting\b/.test(transcribed);
  // ...and flag it somewhere (mistakes list mentioning testing, OR better text restoring -ing).
  const mistakeStr = JSON.stringify(result.mistakes).toLowerCase();
  const flaggedFix = /testing/.test(mistakeStr) || /testing/.test((result.better || '').toLowerCase());

  const pass = (cond, msg) => console.log(cond ? '  ✓ ' + msg : '  ✗ ' + msg, cond ? '' : '<-- FAIL');
  pass(dimsOk, 'all 5 dimensions are integers in 0-100');
  pass(hasFeedback, `feedback present (${result.feedback.length} line(s))`);
  pass(heardFlaw, `transcript reflects the flaw ("test" not "testing"): "${result.transcript}"`);
  pass(flaggedFix, 'engine pointed back to "testing" (in mistakes or better)');

  const ok = dimsOk && hasFeedback && (heardFlaw || flaggedFix);
  console.log(ok
    ? '\n✅ PROOF: scoring engine produces structured 5-dim scores + feedback AND catches a real error.'
    : '\n⚠ INCOMPLETE: engine ran but did not clearly catch the planted error (see above).');
  process.exit(ok ? 0 : 2);
} catch (e) {
  console.error('\n✗ scoring roundtrip failed:', e.message);
  process.exit(3);
}
