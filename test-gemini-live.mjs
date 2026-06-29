// EchoSpeak AI · Gemini Live 连通性真测试
// 目标:证明能连上 Gemini Live、收到 AI 真实语音 + 文字转录,存成 wav。
// 基于用户提供的 @google/genai Live 示例代码改写(WAV 转换沿用其实现)。
import { GoogleGenAI, Modality } from '@google/genai';
import { writeFileSync } from 'fs';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('✗ 缺 GEMINI_API_KEY'); process.exit(1); }

const model = 'models/gemini-3.1-flash-live-preview';
const audioChunks = [];
let aiText = '';
let turnDone = false;
let errored = null;

function parseMimeType(mimeType) {
  const [fileType, ...params] = (mimeType || '').split(';').map(s => s.trim());
  const [, format] = fileType.split('/');
  const options = { numChannels: 1, bitsPerSample: 16, sampleRate: 24000 };
  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) options.bitsPerSample = bits;
  }
  for (const p of params) {
    const [k, v] = p.split('=').map(s => s.trim());
    if (k === 'rate') options.sampleRate = parseInt(v, 10);
  }
  return options;
}
function createWavHeader(dataLength, o) {
  const byteRate = o.sampleRate * o.numChannels * o.bitsPerSample / 8;
  const blockAlign = o.numChannels * o.bitsPerSample / 8;
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLength, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(o.numChannels, 22); b.writeUInt32LE(o.sampleRate, 24);
  b.writeUInt32LE(byteRate, 28); b.writeUInt16LE(blockAlign, 32);
  b.writeUInt16LE(o.bitsPerSample, 34); b.write('data', 36); b.writeUInt32LE(dataLength, 40);
  return b;
}

const ai = new GoogleGenAI({ apiKey });

const config = {
  responseModalities: [Modality.AUDIO],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
  outputAudioTranscription: {}, // 让 Gemini 同时给出它说的话的文字
  systemInstruction: {
    parts: [{ text: 'You are a friendly English speaking coach for a Chinese learner. Keep replies under 2 short sentences.' }]
  },
};

console.log('--- 连接 Gemini Live (' + model + ') ---');
const session = await ai.live.connect({
  model,
  config,
  callbacks: {
    onopen: () => console.log('✓ 连接已打开'),
    onmessage: (msg) => {
      const parts = msg.serverContent?.modelTurn?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) audioChunks.push({ data: part.inlineData.data, mime: part.inlineData.mimeType });
      }
      const t = msg.serverContent?.outputTranscription?.text;
      if (t) aiText += t;
      if (msg.serverContent?.turnComplete) turnDone = true;
    },
    onerror: (e) => { errored = e.message || String(e); },
    onclose: (e) => console.log('· 连接关闭:', e?.reason || '(正常)'),
  },
});

session.sendClientContent({
  turns: ['Greet me and ask one simple question to start practicing English.'],
});

// 等 AI 说完(最多 30s)
const start = Date.now();
while (!turnDone && !errored && Date.now() - start < 30000) {
  await new Promise(r => setTimeout(r, 150));
}
session.close();

if (errored) { console.error('✗ 出错:', errored); process.exit(2); }

console.log('\n===== 真实结果 =====');
console.log('AI 说的话(文字转录):', aiText || '(无转录)');
console.log('收到语音块数:', audioChunks.length);

if (audioChunks.length) {
  const opts = parseMimeType(audioChunks[0].mime);
  const pcm = Buffer.concat(audioChunks.map(c => Buffer.from(c.data, 'base64')));
  const wav = Buffer.concat([createWavHeader(pcm.length, opts), pcm]);
  writeFileSync('gemini-live-test.wav', wav);
  console.log('✓ 已存语音文件 gemini-live-test.wav (' + (wav.length / 1024).toFixed(1) + ' KB, ' + opts.sampleRate + 'Hz)');
  console.log('\n✅ 证据成立:Gemini Live 真的能连、能说、能落地音频文件。');
} else {
  console.log('⚠ 没收到音频(连接成功但无音频返回,需排查)');
}
