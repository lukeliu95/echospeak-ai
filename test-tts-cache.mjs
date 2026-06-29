// Proves electron/tts.ts caches synthesized audio on disk:
//   1st call  → hits Gemini TTS (cached=false), writes a cache file
//   2nd call  → served from disk (cached=true), IDENTICAL bytes, no model call
// Run: GEMINI_API_KEY=... node test-tts-cache.mjs
import { build } from 'esbuild';
import { existsSync, readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
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

// NOTE: bundle must live in the project dir so `@google/genai` (external) resolves
// against ./node_modules — esbuild output in tmpdir can't find it. (.tmp.mjs is gitignored)
const out = join(process.cwd(), `.tts-cache-test-${Date.now()}.tmp.mjs`);
await build({ entryPoints: ['electron/tts.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', packages: 'external' });
const { synthesizeSentenceCached } = await import(pathToFileURL(out).href);

const cacheDir = mkdtempSync(join(tmpdir(), 'tts-cache-'));
const sentence = "I've been working on improving our onboarding flow.";

let pass = true;
const assert = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) pass = false; };

console.log('--- 1st call (should hit Gemini) ---');
const t1 = Date.now();
const a = await synthesizeSentenceCached(apiKey, sentence, cacheDir);
console.log(`  took ${Date.now() - t1}ms · cached=${a.cached} · audio ${(a.audioBase64.length / 1024).toFixed(0)}KB`);
assert(a.cached === false, '第一次 cached=false(真调了模型)');
assert(a.audioBase64.length > 1000, '第一次拿到音频');
assert(readdirSync(cacheDir).length === 1, '缓存文件已写盘');

console.log('--- 2nd call, same sentence (should be cached) ---');
const t2 = Date.now();
const b = await synthesizeSentenceCached(apiKey, sentence, cacheDir);
console.log(`  took ${Date.now() - t2}ms · cached=${b.cached}`);
assert(b.cached === true, '第二次 cached=true(没调模型)');
assert(b.audioBase64 === a.audioBase64, '第二次音频与第一次逐字节完全一致(声音不再变)');
assert((Date.now() - t2) < 200, '第二次几乎瞬时(读盘,非网络)');

rmSync(cacheDir, { recursive: true, force: true });
rmSync(out, { force: true });
console.log(pass ? '\n✅ PROOF: TTS 缓存生效 — 重放读盘、不调模型、声音稳定一致。' : '\n❌ FAIL');
process.exit(pass ? 0 : 1);
