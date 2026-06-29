// test-no-scroll.mjs — per-page vertical-overflow check.
// Boots the real built app headless (offscreen), forces the content area to the
// production size (1280×822 = window 1280×860 minus the 38px titlebar), seeds a
// mock profile via IPC so routes that need a profile render, then for each route
// sets location.hash, waits for render, and measures the page root's
// scrollHeight vs clientHeight. Asserts no full-page vertical overflow
// (scrollHeight <= clientHeight + 2px tolerance). Prints every page's numbers.
//
// Note: this measures the ACTUAL DOM, not the OS window, so we set the
// renderer content height to 822px deterministically regardless of platform
// chrome. The app-body is the scroll container the brief calls out.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const probe = join(__dirname, '.no-scroll-probe.cjs');

const TITLEBAR = 38;
const WIN_W = 1280;
const WIN_H = 860;
const BODY_H = WIN_H - TITLEBAR; // 822
const TOL = 2;

const ROUTES = ['home', 'onboarding', 'practice', 'report', 'review', 'settings', 'conversation'];

writeFileSync(probe, `
const { app, BrowserWindow } = require('electron');
require('./dist-electron/main.js');

const ROUTES = ${JSON.stringify(ROUTES)};
const WIN_W = ${WIN_W}, WIN_H = ${WIN_H}, BODY_H = ${BODY_H};

async function run() {
  // wait for the window the real main created
  let w = null;
  for (let i = 0; i < 100 && !w; i++) {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) w = wins[0];
    else await new Promise(r => setTimeout(r, 100));
  }
  if (!w) { console.log('NO_WINDOW'); app.exit(2); return; }

  // force exact content size: width 1280, height = window minus titlebar (822),
  // so .app-body clientHeight matches production.
  w.setContentSize(WIN_W, BODY_H + ${TITLEBAR});
  if (!w.webContents.isLoading()) {} else {
    await new Promise(r => w.webContents.once('did-finish-load', r));
  }
  await new Promise(r => setTimeout(r, 500));

  // seed a mock profile via the same IPC the renderer uses, so profile-gated
  // routes render real content.
  await w.webContents.executeJavaScript(\`(async () => {
    const now = new Date().toISOString();
    const profile = {
      id: 'test-profile-0001',
      native_language: 'zh-CN', target_language: 'en',
      listening_level: 'B1', speaking_level: 'B1',
      daily_practice_minutes: 30,
      priority: { listening: 0.55, speaking: 0.35, reading: 0.1, writing: 0 },
      interests: ['日常生活','工作沟通'],
      business_scenarios: ['日常生活','工作沟通'],
      created_at: now, updated_at: now,
    };
    await window.echo.store.saveProfile(profile);
    // seed a session + utterance + mistakes so report/review render populated (tallest) views
    const sess = { id: 'sess-ns-1', user_id: profile.id, date: now.slice(0,10),
      planned_minutes: 30, actual_minutes: 22, speaking_minutes: 9, listening_minutes: 13,
      completed: true, topic: '工作沟通', mode: 'daily', summary: 'seed', created_at: now };
    await window.echo.store.saveSession(sess);
    await window.echo.store.saveUtterance({ id: 'utt-ns-1', session_id: 'sess-ns-1', type: 'shadowing',
      prompt_text: 'Actually, the project is on track.', user_transcript: 'Actually the project is on track.',
      improved_text: null, audio_path: null, score_pronunciation: 82, score_fluency: 88,
      score_completeness: 71, score_naturalness: 79, score_confidence: 85, feedback: 'Good.', created_at: now });
    for (let i = 0; i < 5; i++) {
      await window.echo.store.saveMistake({ id: 'mis-ns-' + i, user_id: profile.id, utterance_id: 'utt-ns-1',
        category: ['grammar','pronunciation','word_choice','fluency','missing_word'][i],
        original: 'we need one more week for test ' + i, correction: 'we need one more week for testing ' + i,
        explanation: '动名词 -ing 漏用', review_count: 5 - i, mastered: false, created_at: now, updated_at: now });
    }
    // force a reload so useProfile picks it up cleanly
    return true;
  })()\`);
  w.webContents.reload();
  await new Promise(r => w.webContents.once('did-finish-load', r));
  await new Promise(r => setTimeout(r, 600));

  const results = [];
  for (const route of ROUTES) {
    await w.webContents.executeJavaScript(\`window.location.hash = '#/' + \${JSON.stringify(route)}\`);
    await new Promise(r => setTimeout(r, 700)); // allow React render + transitions
    const m = await w.webContents.executeJavaScript(\`(() => {
      const body = document.querySelector('.app-body');
      if (!body) return { error: 'no .app-body' };
      // also report document/window in case something escapes app-body
      const de = document.documentElement;
      return {
        bodyScroll: body.scrollHeight,
        bodyClient: body.clientHeight,
        docScroll: de.scrollHeight,
        docClient: de.clientHeight,
        winInner: window.innerHeight,
      };
    })()\`);
    results.push({ route, ...m });
  }

  console.log('NOSCROLL_RESULTS ' + JSON.stringify(results));
  app.exit(0);
}

app.whenReady().then(run).catch(e => { console.log('PROBE_ERROR ' + (e && e.message)); app.exit(3); });
`);

const electronBin = join(__dirname, 'node_modules', '.bin', 'electron');
const child = spawn(electronBin, [probe], {
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => { out += d.toString(); });
child.stderr.on('data', () => {}); // electron is noisy on stderr; ignore

child.on('exit', (code) => {
  try { rmSync(probe, { force: true }); } catch {}
  const m = out.match(/NOSCROLL_RESULTS (.+)/);
  if (!m) {
    console.log('FAILED to collect results. Raw output:\n', out);
    process.exit(2);
  }
  const results = JSON.parse(m[1]);
  console.log('\n===== PER-PAGE OVERFLOW (window ' + WIN_W + '×' + WIN_H + ', .app-body clientHeight≈' + BODY_H + ') =====');
  let bad = 0;
  for (const r of results) {
    const overflow = r.bodyScroll - r.bodyClient;
    const ok = overflow <= TOL;
    if (!ok) bad++;
    console.log(
      (ok ? 'PASS' : 'FAIL') +
      '  ' + r.route.padEnd(13) +
      ' app-body scrollHeight=' + r.bodyScroll +
      ' clientHeight=' + r.bodyClient +
      ' (overflow ' + overflow + 'px)'
    );
  }
  console.log('=====================================================');
  if (bad === 0) {
    console.log('✅ No full-page vertical overflow on any route (tolerance ' + TOL + 'px).');
    process.exit(0);
  } else {
    console.log('❌ ' + bad + ' route(s) overflow the viewport.');
    process.exit(1);
  }
});
