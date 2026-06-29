import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { startLiveSession, type LiveSessionHandle } from './liveSession';
import { evaluateUtterance } from './scoring';
import { synthesizeSentenceCached } from './tts';
import { createStorage } from './storage/factory';
import type { StorageAdapter } from './storage/types';
import { scheduleReminder } from './reminder';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- API key: read in Main process only. NEVER expose to renderer. ---
// Resolution order (see getEffectiveKey): in-app Settings override → GEMINI_API_KEY
// env var → a local .env file in the project root (gitignored; dev convenience).
function readKeyFromFile(): string | null {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envCandidates = [
    join(process.cwd(), '.env'),
    join(__dirname, '../.env'),
    join(__dirname, '../../.env'),
  ];
  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      const txt = readFileSync(envPath, 'utf8');
      const m = txt.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
let win: BrowserWindow | null = null;
let live: LiveSessionHandle | null = null;
// Storage adapter (Main owns all data access; renderer reaches it via IPC).
let storage: StorageAdapter | null = null;
// Always-local adapter that holds backend-selection config (dataBackend / supabaseUrl
// / supabaseKey), so the bootstrap can find it next launch even when storage=supabase.
let localConfigStore: StorageAdapter | null = null;
let keyOverride: string | null = null;

// Keys that must be mirrored to the local config store regardless of active backend.
const LOCAL_CONFIG_KEYS = ['dataBackend', 'supabaseUrl', 'supabaseKey', 'geminiKeyOverride'];

function send(channel: string, ...args: unknown[]) {
  win?.webContents.send(channel, ...args);
}

// Bring the window forward (used when the user clicks a reminder notification).
function focusWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// (Re)arm the daily reminder from the current settings bag.
function applyReminder(settings: Record<string, unknown>) {
  scheduleReminder(
    {
      enabled: settings.reminderEnabled !== false, // default on
      time: typeof settings.reminderTime === 'string' ? settings.reminderTime : '20:00',
    },
    focusWindow,
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#F7F8F7',
    // Hide the native title bar but keep the macOS traffic lights, inset into
    // our own titlebar — one unified bar instead of two stacked ones.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 13 },
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'));
  }
}

// ---------------- Storage IPC (data access lives only in Main) ----------------
async function initStorage() {
  const dataDir = app.getPath('userData');
  // Bootstrap: the backend choice itself lives in the LOCAL settings bag. Read it
  // from a local adapter first, then create the real backend.
  const bootstrap = await createStorage({ backend: 'local', dataDir });
  localConfigStore = bootstrap;
  const cfg = await bootstrap.getSettings();

  const wantSupabase = cfg.dataBackend === 'supabase';
  const url = (cfg.supabaseUrl as string) || process.env.SUPABASE_URL || '';
  const key = (cfg.supabaseKey as string) || process.env.SUPABASE_KEY || '';

  if (wantSupabase && url && key) {
    try {
      storage = await createStorage({ backend: 'supabase', dataDir, supabase: { url, key } });
    } catch (e: any) {
      // Fall back to local so the app still runs; surface via console for diagnosis.
      console.error('[storage] Supabase init failed, falling back to local:', e?.message || e);
      storage = bootstrap;
    }
  } else {
    storage = bootstrap;
  }

  // Hydrate the key override from persisted settings.
  const s = await storage.getSettings();
  keyOverride = (s.geminiKeyOverride as string) || null;
  // Arm the daily reminder from persisted settings.
  applyReminder(s);
}

function registerStorageIpc() {
  ipcMain.handle('store:getProfile', () => storage!.getProfile());
  ipcMain.handle('store:saveProfile', (_e, p) => storage!.saveProfile(p));
  ipcMain.handle('store:getSessions', (_e, userId: string) => storage!.getSessions(userId));
  ipcMain.handle('store:saveSession', (_e, s) => storage!.saveSession(s));
  ipcMain.handle('store:getUtterances', (_e, sessionId: string) => storage!.getUtterances(sessionId));
  ipcMain.handle('store:saveUtterance', (_e, u) => storage!.saveUtterance(u));
  ipcMain.handle('store:getMistakes', (_e, userId: string) => storage!.getMistakes(userId));
  ipcMain.handle('store:saveMistake', (_e, m) => storage!.saveMistake(m));
  ipcMain.handle('store:getSentencePatterns', () => storage!.getSentencePatterns());
  ipcMain.handle('store:saveSentencePattern', (_e, p) => storage!.saveSentencePattern(p));
  ipcMain.handle('store:getSettings', () => storage!.getSettings());
  ipcMain.handle('store:saveSettings', async (_e, patch) => {
    const next = await storage!.saveSettings(patch);
    // Mirror backend-selection + key-override config to the always-local store so the
    // next-launch bootstrap can read it even when the active backend is Supabase.
    if (localConfigStore && localConfigStore !== storage) {
      const mirror: Record<string, unknown> = {};
      for (const k of LOCAL_CONFIG_KEYS) if (k in patch) mirror[k] = patch[k];
      if (Object.keys(mirror).length) await localConfigStore.saveSettings(mirror);
    }
    if ('geminiKeyOverride' in patch) keyOverride = (next.geminiKeyOverride as string) || null;
    // Re-arm the reminder if its config changed.
    if ('reminderEnabled' in patch || 'reminderTime' in patch) applyReminder(next);
    return next;
  });

  // AI connection status for the Settings page. NEVER returns the key itself.
  ipcMain.handle('ai:status', () => {
    const ov = keyOverride && keyOverride.trim() ? keyOverride.trim() : null;
    const backend = storage?.backendName ?? 'local';
    if (ov) return { connected: true, source: 'override', backend };
    if (process.env.GEMINI_API_KEY) return { connected: true, source: 'env', backend };
    const f = readKeyFromFile();
    if (f) return { connected: true, source: 'file', backend };
    return { connected: false, source: 'none', backend };
  });
}

// Resolve key with override priority (override -> env -> file).
function getEffectiveKey(): string | null {
  if (keyOverride && keyOverride.trim()) return keyOverride.trim();
  return readKeyFromFile();
}

// --- IPC: conversation lifecycle. Renderer never sees the key. ---
ipcMain.handle('live:start', async (_e: IpcMainInvokeEvent) => {
  const key = getEffectiveKey();
  if (!key) return { ok: false, error: 'GEMINI_API_KEY not found (env, api-keys.env, or settings override)' };
  if (live) { try { live.close(); } catch { /* ignore */ } live = null; }

  try {
    live = await startLiveSession(key, {
      onOpen: () => send('live:open'),
      onAudio: (b64, mime) => send('live:audio', { data: b64, mimeType: mime }),
      onAiText: (t) => send('live:aiText', t),
      onUserText: (t) => send('live:userText', t),
      onTurnComplete: () => send('live:turnComplete'),
      onError: (m) => send('live:error', m),
      onClose: (r) => send('live:closed', r),
    });
    // Kick the coach off so the user hears a greeting first.
    live.sendText('Greet me warmly and ask one simple question to start practicing English.');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// Renderer pushes 16kHz mono PCM16 mic audio (base64) -> Gemini.
ipcMain.on('live:userAudio', (_e, base64Pcm16: string) => {
  if (live) live.sendUserAudio(base64Pcm16);
});

ipcMain.handle('live:stop', async () => {
  if (live) { try { live.close(); } catch { /* ignore */ } live = null; }
  return { ok: true };
});

// --- IPC: pronunciation scoring (single multimodal request, not Live). ---
// Renderer sends recorded audio + target text; gets back the structured rubric.
ipcMain.handle('ai:evaluateUtterance', async (_e, payload: { audioBase64: string; targetText: string; mimeType?: string }) => {
  const key = getEffectiveKey();
  if (!key) return { ok: false, error: 'GEMINI_API_KEY not found (env, api-keys.env, or settings override)' };
  try {
    const result = await evaluateUtterance(key, {
      userAudioBase64: payload.audioBase64,
      targetText: payload.targetText,
      mimeType: payload.mimeType,
    });
    return { ok: true, result };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// --- IPC: synthesize the target sentence so the learner can hear it. ---
ipcMain.handle('ai:speakSentence', async (_e, payload: { text: string; voiceName?: string }) => {
  const key = getEffectiveKey();
  if (!key) return { ok: false, error: 'GEMINI_API_KEY not found (env, api-keys.env, or settings override)' };
  try {
    const cacheDir = join(app.getPath('userData'), 'tts-cache');
    const tts = await synthesizeSentenceCached(key, payload.text, cacheDir, payload.voiceName);
    return { ok: true, ...tts }; // tts.cached === true means served from disk, no model call
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// Resolve the Dock icon PNG. In dev the build/ folder sits next to electron/;
// once packaged the OS uses the bundled .icns, so a missing PNG here is harmless.
function resolveDockIcon(): string | null {
  const candidates = [
    join(__dirname, '../build/icon.png'),       // dev: dist-electron/ -> ../build
    join(__dirname, '../../build/icon.png'),     // fallback layout
    join(process.cwd(), 'build/icon.png'),       // run from app root
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

app.whenReady().then(async () => {
  // macOS: set the Dock icon immediately so dev runs show the brand mark
  // (packaged builds use build/icon.icns via electron-builder).
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = resolveDockIcon();
    if (iconPath) {
      try { app.dock.setIcon(iconPath); } catch { /* non-fatal */ }
    }
  }
  await initStorage();
  registerStorageIpc();
  createWindow();
});
app.on('window-all-closed', () => {
  if (live) { try { live.close(); } catch { /* ignore */ } }
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
