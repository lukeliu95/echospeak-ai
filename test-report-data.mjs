// test-report-data.mjs — proves the Report page aggregation + review selection
// (src/lib/reportData.ts) compute correct days / minutes / mistake ordering from
// seeded session/utterance/mistake rows. No Electron, no GUI.
//
// Run: node test-report-data.mjs
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = join(tmpdir(), 'echospeak-reportdata-bundle.mjs');
await build({ entryPoints: ['src/lib/reportData.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const lib = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
const { computeKpis, dailySpeakingBars, topMistakes, selectReviewMistakes } = lib;

let fails = 0;
function assert(cond, msg, got) {
  if (cond) { console.log('  ✓', msg); }
  else { console.error('  ✗ FAIL:', msg, '— got:', JSON.stringify(got)); fails++; }
}

// Fix "now" so the trailing-7-day window is deterministic.
const NOW = new Date('2026-06-29T12:00:00');
const todayStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dayBack = (n) => { const d = new Date(NOW); d.setDate(NOW.getDate()-n); return todayStr(d); };

console.log('--- Report aggregation test (fixed now = 2026-06-29) ---');

// 3 distinct days in-window (0,2,5 back), 1 day OUTSIDE window (10 back, should be ignored).
const sessions = [
  { id: 's0', user_id: 'u1', date: dayBack(0), speaking_minutes: 12, completed: true },
  { id: 's2', user_id: 'u1', date: dayBack(2), speaking_minutes: 8,  completed: true },
  { id: 's5', user_id: 'u1', date: dayBack(5), speaking_minutes: 5,  completed: true },
  { id: 'sOld', user_id: 'u1', date: dayBack(10), speaking_minutes: 99, completed: true }, // out of week
];
const utterances = [
  { id: 'u-a', session_id: 's0', type: 'shadowing', score_pronunciation: 90, score_completeness: 88 }, // mastered (avg 89)
  { id: 'u-b', session_id: 's0', type: 'shadowing', score_pronunciation: 60, score_completeness: 70 }, // not
  { id: 'u-c', session_id: 's2', type: 'shadowing', score_pronunciation: 50, score_completeness: 55 },
  { id: 'u-d', session_id: 'sOld', type: 'shadowing', score_pronunciation: 99, score_completeness: 99 }, // out of week
  { id: 'u-e', session_id: 's5', type: 'conversation', score_pronunciation: 95, score_completeness: 95 }, // not shadowing
];

const kpis = computeKpis(sessions, utterances, NOW);
console.log('\n[KPIs]', JSON.stringify(kpis));
assert(kpis.practiceDays === 3, 'practiceDays counts 3 distinct in-window completed days (excludes 10-day-old)', kpis.practiceDays);
assert(kpis.speakingMinutes === 25, 'speakingMinutes = 12+8+5 = 25 (excludes out-of-window 99)', kpis.speakingMinutes);
assert(kpis.shadowCount === 3, 'shadowCount counts 3 in-window shadowing utterances (excludes conversation + old)', kpis.shadowCount);
assert(kpis.masteredCount === 1, 'masteredCount = 1 (only the avg>=85 in-window shadowing take)', kpis.masteredCount);

// --- daily bars: 7 entries, today bucket = 12 min and pct 100 (it is the max) ---
const bars = dailySpeakingBars(sessions, NOW);
console.log('\n[bars minutes]', bars.map(b => b.minutes).join(','));
assert(bars.length === 7, 'exactly 7 day bars', bars.length);
assert(bars[6].minutes === 12 && bars[6].today === true, 'last bar is today with 12 min', bars[6]);
assert(bars[6].pct === 100, 'today (the max) scales to pct 100 — no NaN', bars[6].pct);
const emptyBars = dailySpeakingBars([], NOW);
assert(emptyBars.every(b => b.pct === 0 && !Number.isNaN(b.pct)), 'empty data → all pct 0, no NaN', emptyBars.map(b=>b.pct));

// --- topMistakes: group by (category+original), sort by occurrence count desc ---
const mk = (id, original, rc, mastered=false) => ({
  id, user_id: 'u1', utterance_id: 'x', category: 'grammar',
  original, correction: original.replace('test','testing'), explanation: null,
  review_count: rc, mastered, created_at: 'c', updated_at: '2026-06-2'+id,
});
const mistakes = [
  mk('1', 'for test', 0), mk('2', 'for test', 1), mk('3', 'for test', 0), // "for test" x3
  mk('4', 'a the', 2), mk('5', 'a the', 0),                                // "a the" x2
  mk('6', 'third person', 5),                                              // x1 but high review_count
  mk('7', 'mastered one', 9, true),                                        // mastered → excluded
];
const top = topMistakes(mistakes, 5);
console.log('\n[topMistakes]', top.map(t => `${t.label}=${t.count}`).join(', '));
assert(top[0].label === 'for test' && top[0].count === 3, 'most frequent ("for test"×3) ranked first', top[0]);
assert(top[1].label === 'a the' && top[1].count === 2, '"a the"×2 ranked second', top[1]);
assert(top.every(t => t.label !== 'mastered one'), 'mastered mistakes excluded from review list', top.map(t=>t.label));
assert(top[0].pct === 100, 'top bucket bar pct = 100', top[0].pct);

// --- selectReviewMistakes: unmastered, highest review_count first ---
const sel = selectReviewMistakes(mistakes, 8);
console.log('[review order review_count]', sel.map(m => m.review_count).join(','));
assert(sel.every(m => !m.mastered), 'review queue excludes mastered', sel.map(m=>m.mastered));
assert(sel[0].review_count === 5, 'highest review_count (5) drilled first (PRD §8)', sel[0].review_count);
assert(sel.length === 6, 'all 6 unmastered mistakes selected (limit 8)', sel.length);

rmSync(out, { force: true });
if (fails === 0) { console.log('\n✅ PROOF: report aggregation + review selection compute correctly.'); process.exit(0); }
else { console.log(`\n❌ ${fails} assertion(s) failed.`); process.exit(1); }
