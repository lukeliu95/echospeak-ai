import { contextBridge, ipcRenderer } from 'electron';

// Safe, minimal surface exposed to the renderer. No API key ever crosses here.
contextBridge.exposeInMainWorld('echo', {
  // --- conversation (Live) ---
  startConversation: () => ipcRenderer.invoke('live:start'),
  stopConversation: () => ipcRenderer.invoke('live:stop'),
  // Push a base64 chunk of 16kHz mono PCM16 mic audio to Main.
  sendUserAudio: (base64Pcm16: string) => ipcRenderer.send('live:userAudio', base64Pcm16),

  // Subscriptions (each returns an unsubscribe fn).
  onOpen: (cb: () => void) => sub('live:open', () => cb()),
  onAudio: (cb: (chunk: { data: string; mimeType: string }) => void) =>
    sub('live:audio', (_e, chunk) => cb(chunk)),
  onAiText: (cb: (text: string) => void) => sub('live:aiText', (_e, t) => cb(t)),
  onUserText: (cb: (text: string) => void) => sub('live:userText', (_e, t) => cb(t)),
  onTurnComplete: (cb: () => void) => sub('live:turnComplete', () => cb()),
  onError: (cb: (msg: string) => void) => sub('live:error', (_e, m) => cb(m)),
  onClosed: (cb: (reason: string) => void) => sub('live:closed', (_e, r) => cb(r)),

  // --- storage (all data access goes through Main) ---
  store: {
    getProfile: () => ipcRenderer.invoke('store:getProfile'),
    saveProfile: (p: unknown) => ipcRenderer.invoke('store:saveProfile', p),
    getSessions: (userId: string) => ipcRenderer.invoke('store:getSessions', userId),
    saveSession: (s: unknown) => ipcRenderer.invoke('store:saveSession', s),
    getUtterances: (sessionId: string) => ipcRenderer.invoke('store:getUtterances', sessionId),
    saveUtterance: (u: unknown) => ipcRenderer.invoke('store:saveUtterance', u),
    getMistakes: (userId: string) => ipcRenderer.invoke('store:getMistakes', userId),
    saveMistake: (m: unknown) => ipcRenderer.invoke('store:saveMistake', m),
    getSentencePatterns: () => ipcRenderer.invoke('store:getSentencePatterns'),
    saveSentencePattern: (p: unknown) => ipcRenderer.invoke('store:saveSentencePattern', p),
    getSettings: () => ipcRenderer.invoke('store:getSettings'),
    saveSettings: (patch: unknown) => ipcRenderer.invoke('store:saveSettings', patch),
  },

  // --- AI connection status (never returns the key) ---
  aiStatus: () => ipcRenderer.invoke('ai:status'),

  // --- pronunciation scoring (single multimodal request) ---
  evaluateUtterance: (audioBase64: string, targetText: string, mimeType?: string) =>
    ipcRenderer.invoke('ai:evaluateUtterance', { audioBase64, targetText, mimeType }),

  // --- end-of-conversation summary (single JSON request) ---
  summarizeConversation: (payload: { messages: Array<{ role: 'ai' | 'user'; text: string }>; durationSec: number; userTalkSec: number }) =>
    ipcRenderer.invoke('ai:summarizeConversation', payload),

  // --- target-sentence TTS (returns base64 PCM the renderer plays) ---
  speakSentence: (text: string, voiceName?: string) =>
    ipcRenderer.invoke('ai:speakSentence', { text, voiceName }),
});

function sub(channel: string, handler: (...a: any[]) => void) {
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
