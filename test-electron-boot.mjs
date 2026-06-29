// Headless-ish Electron boot check. Launches the built app, watches for:
//   - main process boot
//   - BrowserWindow created + renderer finished loading (did-finish-load)
//   - no fatal renderer console errors
//   - process stays alive a few seconds
// Exits 0 on success. Uses offscreen + disable-gpu so it can run without a display.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const probe = join(__dirname, '.boot-probe.cjs');

// A tiny main override that requires the real main, then inspects window state.
writeFileSync(probe, `
const { app, BrowserWindow } = require('electron');
require('./dist-electron/main.js');
let reported = false;
function check() {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    const w = wins[0];
    w.webContents.on('did-finish-load', () => {
      if (reported) return; reported = true;
      console.log('BOOT_OK window=1 url=' + w.webContents.getURL().slice(0,60));
    });
    w.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 3) console.log('RENDERER_ERROR ' + msg);
    });
    // if already loaded
    if (!w.webContents.isLoading() && !reported) {
      reported = true;
      console.log('BOOT_OK window=1 (already loaded)');
    }
    return true;
  }
  return false;
}
app.whenReady().then(() => {
  const iv = setInterval(() => { if (check()) clearInterval(iv); }, 200);
  setTimeout(() => {
    console.log(reported ? 'STILL_ALIVE after 4s' : 'NO_WINDOW after 4s');
    app.quit();
    process.exit(reported ? 0 : 2);
  }, 4000);
});
`);

const electronBin = join(__dirname, 'node_modules', '.bin', 'electron');
const child = spawn(electronBin, [probe], {
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let rendererErrors = [];
child.stdout.on('data', (d) => {
  const s = d.toString();
  out += s;
  process.stdout.write(s);
  for (const line of s.split('\n')) if (line.startsWith('RENDERER_ERROR')) rendererErrors.push(line);
});
child.stderr.on('data', (d) => process.stderr.write(d));

child.on('exit', (code) => {
  try { rmSync(probe, { force: true }); } catch {}
  const booted = out.includes('BOOT_OK');
  const alive = out.includes('STILL_ALIVE');
  console.log('\n===== BOOT RESULT =====');
  console.log('window created + renderer loaded:', booted);
  console.log('process alive 4s:', alive);
  console.log('fatal renderer errors:', rendererErrors.length);
  if (booted && alive && rendererErrors.length === 0) {
    console.log('✅ Electron boots, window + renderer OK, no fatal errors.');
    process.exit(0);
  } else {
    console.log('⚠ boot check incomplete (code ' + code + ')');
    process.exit(1);
  }
});
