// test-reminder.mjs — programmatic check of the daily-reminder scheduling math
// (electron/reminder.ts). Real notification DELIVERY needs a real machine reaching
// the set time — that is NOT tested here (未实测触发). What we prove:
//   1. parseTime accepts valid HH:MM, rejects garbage.
//   2. msUntilNext returns the correct delay to the next occurrence (today vs tomorrow).
//   3. scheduleReminder + cancelReminder run without throwing (Notification is stubbed
//      so we don't need a display server).
//
// Run: node test-reminder.mjs
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = join(tmpdir(), 'echospeak-reminder-bundle.mjs');
// Stub the `electron` import (Notification) so the module loads headless.
await build({
  entryPoints: ['electron/reminder.ts'],
  bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  plugins: [{
    name: 'stub-electron',
    setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron-stub', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const Notification = { isSupported: () => false };',
        loader: 'js',
      }));
    },
  }],
});
const { parseTime, msUntilNext, scheduleReminder, cancelReminder } = await import(pathToFileURL(out).href + `?t=${Date.now()}`);

let fails = 0;
const assert = (c, m, got) => c ? console.log('  ✓', m) : (console.error('  ✗ FAIL:', m, '— got:', JSON.stringify(got)), fails++);

console.log('--- Reminder scheduling test ---');

// parseTime
assert(JSON.stringify(parseTime('20:00')) === JSON.stringify({ h: 20, m: 0 }), 'parseTime("20:00") → 20:00');
assert(JSON.stringify(parseTime('7:05')) === JSON.stringify({ h: 7, m: 5 }), 'parseTime("7:05") → 7:05');
assert(parseTime('99:99') === null, 'parseTime rejects out-of-range', parseTime('99:99'));
assert(parseTime('abc') === null, 'parseTime rejects garbage', parseTime('abc'));

// msUntilNext: from 10:00, reminder at 20:00 today → 10h ahead.
const from = new Date('2026-06-29T10:00:00');
const tenHours = 10 * 3600 * 1000;
assert(msUntilNext(20, 0, from) === tenHours, 'msUntilNext(20:00) from 10:00 = 10h', msUntilNext(20,0,from));
// from 22:00, reminder at 20:00 → already passed → tomorrow (22h ahead).
const late = new Date('2026-06-29T22:00:00');
assert(msUntilNext(20, 0, late) === 22 * 3600 * 1000, 'msUntilNext rolls to tomorrow when time passed', msUntilNext(20,0,late));
// exactly-now also rolls to tomorrow (>= guard).
const exact = new Date('2026-06-29T20:00:00');
assert(msUntilNext(20, 0, exact) === 24 * 3600 * 1000, 'msUntilNext at exact time → +24h', msUntilNext(20,0,exact));

// scheduleReminder / cancelReminder run without throwing.
let threw = false;
try {
  scheduleReminder({ enabled: true, time: '20:00' }, () => {});
  scheduleReminder({ enabled: false, time: '20:00' }, () => {}); // disabling cancels
  scheduleReminder({ enabled: true, time: 'garbage' }, () => {}); // malformed → no-op
  cancelReminder();
} catch (e) { threw = true; console.error('   threw:', e.message); }
assert(!threw, 'scheduleReminder/cancelReminder execute without exceptions');

console.log('\nNOTE: real notification delivery is 未实测触发 (needs a real machine + the clock reaching the set time).');
if (fails === 0) { console.log('\n✅ PROOF: reminder scheduling math + lifecycle are correct and exception-free.'); process.exit(0); }
else { console.log(`\n❌ ${fails} assertion(s) failed.`); process.exit(1); }
