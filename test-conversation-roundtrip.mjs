// EchoSpeak AI · Programmatic "audio-in → AI reply" roundtrip proof.
// Proves the full chain WITHOUT a human mic:
//   1. Synthesize a user sentence with Gemini TTS (gemini-2.5-flash-preview-tts, 24kHz)
//   2. Resample 24kHz -> 16kHz mono PCM16 (what Gemini Live input requires)
//   3. Stream it into a Gemini Live session via session.sendRealtimeInput({audio})
//      using the SAME config the Main-process wrapper uses (AI Coach systemInstruction,
//      input+output transcription)
//   4. Confirm a context-relevant AI voice reply (saved as wav) + transcript
//
// Run: GEMINI_API_KEY=... node test-conversation-roundtrip.mjs
import { GoogleGenAI, Modality } from '@google/genai';
import { writeFileSync, readFileSync, existsSync } from 'fs';

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

const USER_SENTENCE = 'Hi, yesterday I went to the park with my friend.';

// AI Coach systemInstruction — same as electron/aiCoach.ts (PRD §9).
const AI_COACH_SYSTEM_INSTRUCTION = `You are an English speaking coach for a Chinese native speaker. The user wants to improve listening and speaking, not writing. Your job is to make the user speak more, listen better, and build confidence through short, practical, repeated practice.

Behavior rules:
1. Use English as the main language.
2. Use simple English based on the user's level.
3. Ask one question at a time.
4. Keep each response under 3 sentences.
5. Do not over-explain grammar.
6. Correct only the most important 1-2 mistakes.
7. Let the user speak more than the AI.
8. If the user is stuck, give 2 options.
9. If the user answers in Chinese, help them say it in simple English.
10. Always end with a prompt that makes the user speak again.`;

const ai = new GoogleGenAI({ apiKey });

// ---------- wav helpers ----------
function parseMimeType(mimeType) {
  const [fileType, ...params] = (mimeType || '').split(';').map((s) => s.trim());
  const [, format] = fileType.split('/');
  const o = { numChannels: 1, bitsPerSample: 16, sampleRate: 24000 };
  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) o.bitsPerSample = bits;
  }
  for (const p of params) {
    const [k, v] = p.split('=').map((s) => s.trim());
    if (k === 'rate') o.sampleRate = parseInt(v, 10);
  }
  return o;
}
function wavHeader(dataLen, o) {
  const byteRate = o.sampleRate * o.numChannels * o.bitsPerSample / 8;
  const blockAlign = o.numChannels * o.bitsPerSample / 8;
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(o.numChannels, 22); b.writeUInt32LE(o.sampleRate, 24);
  b.writeUInt32LE(byteRate, 28); b.writeUInt16LE(blockAlign, 32);
  b.writeUInt16LE(o.bitsPerSample, 34); b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  return b;
}
function writeWav(path, pcm, o) {
  writeFileSync(path, Buffer.concat([wavHeader(pcm.length, o), pcm]));
}

// Resample 24kHz mono PCM16 -> 16kHz mono PCM16 (linear decimation 3:2).
function resample24to16(pcm24) {
  const inN = pcm24.length / 2;
  const outN = Math.floor(inN * 16000 / 24000);
  const out = Buffer.alloc(outN * 2);
  for (let i = 0; i < outN; i++) {
    const srcPos = (i * 24000) / 16000;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, inN - 1);
    const frac = srcPos - i0;
    const s0 = pcm24.readInt16LE(i0 * 2);
    const s1 = pcm24.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
  }
  return out;
}

// ---------- step 1: TTS the user sentence ----------
async function synthesizeUser() {
  console.log('--- Step 1: synthesize user audio via Gemini TTS ---');
  console.log('  user says:', JSON.stringify(USER_SENTENCE));
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: USER_SENTENCE }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error('TTS returned no audio');
  const mime = part.inlineData.mimeType;
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const o = parseMimeType(mime);
  console.log(`  ✓ TTS audio: ${(pcm.length / 1024).toFixed(1)} KB @ ${o.sampleRate}Hz (${mime})`);
  writeWav('roundtrip-user-input.wav', pcm, o);
  console.log('  ✓ saved roundtrip-user-input.wav');
  // Ensure 24kHz mono PCM16 before resampling.
  if (o.sampleRate !== 24000) throw new Error('unexpected TTS rate ' + o.sampleRate);
  const pcm16k = resample24to16(pcm);
  writeWav('roundtrip-user-input-16k.wav', pcm16k, { numChannels: 1, bitsPerSample: 16, sampleRate: 16000 });
  console.log(`  ✓ resampled to 16kHz: ${(pcm16k.length / 1024).toFixed(1)} KB`);
  return pcm16k;
}

// ---------- step 2+3: feed into Live, collect AI reply ----------
async function runLive(userPcm16k) {
  console.log('\n--- Step 2: open Gemini Live session (AI Coach config) ---');
  const audioChunks = [];
  let aiText = '';
  let userTranscript = '';
  let turnDone = false;
  let errored = null;

  const session = await ai.live.connect({
    model: 'models/gemini-3.1-flash-live-preview',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
      outputAudioTranscription: {},
      inputAudioTranscription: {},
      systemInstruction: { parts: [{ text: AI_COACH_SYSTEM_INSTRUCTION }] },
    },
    callbacks: {
      onopen: () => console.log('  ✓ Live connected'),
      onmessage: (msg) => {
        const sc = msg.serverContent;
        for (const p of sc?.modelTurn?.parts || []) {
          if (p.inlineData?.data) audioChunks.push({ data: p.inlineData.data, mime: p.inlineData.mimeType });
        }
        if (sc?.outputTranscription?.text) aiText += sc.outputTranscription.text;
        if (sc?.inputTranscription?.text) userTranscript += sc.inputTranscription.text;
        if (sc?.turnComplete) turnDone = true;
      },
      onerror: (e) => { errored = e?.message || String(e); },
      onclose: (e) => console.log('  · Live closed:', e?.reason || '(normal)'),
    },
  });

  console.log('\n--- Step 3: stream user audio into Live (sendRealtimeInput) ---');
  // Stream in ~100ms (3200 byte) chunks to mimic real mic flow.
  const CHUNK = 3200;
  for (let off = 0; off < userPcm16k.length; off += CHUNK) {
    const slice = userPcm16k.subarray(off, Math.min(off + CHUNK, userPcm16k.length));
    session.sendRealtimeInput({ audio: { data: slice.toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
    await new Promise((r) => setTimeout(r, 20));
  }
  // Signal end of user turn so the model responds.
  if (typeof session.sendRealtimeInput === 'function') {
    session.sendRealtimeInput({ audioStreamEnd: true });
  }
  console.log(`  ✓ streamed ${userPcm16k.length} bytes of 16kHz audio`);

  console.log('\n--- Step 4: wait for AI reply (max 35s) ---');
  const start = Date.now();
  while (!turnDone && !errored && Date.now() - start < 35000) {
    await new Promise((r) => setTimeout(r, 150));
  }
  session.close();
  if (errored) throw new Error('Live error: ' + errored);

  return { audioChunks, aiText, userTranscript };
}

// ---------- main ----------
try {
  const userPcm16k = await synthesizeUser();
  const { audioChunks, aiText, userTranscript } = await runLive(userPcm16k);

  console.log('\n===== ROUNDTRIP RESULT =====');
  console.log('User transcript (Gemini heard):', userTranscript || '(none)');
  console.log('AI reply transcript:', aiText || '(none)');
  console.log('AI audio chunks received:', audioChunks.length);

  if (audioChunks.length) {
    const o = parseMimeType(audioChunks[0].mime);
    const pcm = Buffer.concat(audioChunks.map((c) => Buffer.from(c.data, 'base64')));
    writeWav('roundtrip-ai-reply.wav', pcm, o);
    console.log(`✓ saved roundtrip-ai-reply.wav (${(pcm.length / 1024).toFixed(1)} KB @ ${o.sampleRate}Hz)`);
  }

  const ok = audioChunks.length > 0 && aiText.trim().length > 0;
  console.log(ok
    ? '\n✅ PROOF: user audio → AI voice reply roundtrip works end-to-end.'
    : '\n⚠ INCOMPLETE: connected but missing audio or transcript.');
  process.exit(ok ? 0 : 2);
} catch (e) {
  console.error('\n✗ roundtrip failed:', e.message);
  process.exit(3);
}
