// Renderer-side audio: mic capture -> 16kHz mono PCM16 (base64), and 24kHz AI playback.

// ---------- base64 helpers ----------
export function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

// Downsample a Float32 buffer from inputRate to 16000 Hz and convert to PCM16.
function floatTo16kPcm(input: Float32Array, inputRate: number): Int16Array {
  const targetRate = 16000;
  if (inputRate === targetRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inputRate / targetRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// ---------- Mic capture ----------
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;

  async start(onChunk: (base64Pcm16: string) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new AudioContext();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but maximally compatible for a working slice.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const inputRate = this.ctx.sampleRate;
    this.node.onaudioprocess = (ev) => {
      const pcm = floatTo16kPcm(ev.inputBuffer.getChannelData(0), inputRate);
      if (pcm.length) onChunk(int16ToBase64(pcm));
    };
    this.src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  async stop() {
    this.node?.disconnect();
    this.src?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = this.stream = this.node = this.src = null;
  }
}

// ---------- Full-utterance recorder (for shadowing scoring) ----------
// Reuses MicCapture's 16kHz PCM16 stream but accumulates the whole take, then packages
// it as a base64 WAV that the scoring engine (Gemini multimodal) can read directly.
export class MicRecorder {
  private cap = new MicCapture();
  private chunks: Int16Array[] = [];
  private total = 0;

  async start() {
    this.chunks = [];
    this.total = 0;
    await this.cap.start((b64) => {
      const pcm = base64ToInt16(b64);
      this.chunks.push(pcm);
      this.total += pcm.length;
    });
  }

  // Stop recording; returns { wavBase64, samples, durationSec } at 16kHz mono.
  async stop(): Promise<{ wavBase64: string; samples: number; durationSec: number }> {
    await this.cap.stop();
    const merged = new Int16Array(this.total);
    let off = 0;
    for (const c of this.chunks) { merged.set(c, off); off += c.length; }
    const wav = pcm16ToWavBytes(merged, 16000);
    return {
      wavBase64: bytesToBase64(wav),
      samples: this.total,
      durationSec: this.total / 16000,
    };
  }
}

// Build a 44-byte WAV header + PCM16 data for mono audio.
function pcm16ToWavBytes(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataLen = pcm.byteLength;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  const byteRate = sampleRate * 2; // mono * 16bit
  wstr(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, 'data'); dv.setUint32(40, dataLen, true);
  new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer, pcm.byteOffset, dataLen));
  return new Uint8Array(buf);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ---------- AI audio playback (24kHz PCM16 stream, gap-free queue) ----------
export class AudioQueue {
  private ctx: AudioContext;
  private nextStart = 0;
  private sampleRate: number;
  onPlaying?: (active: boolean) => void;
  private active = 0;

  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    this.ctx = new AudioContext({ sampleRate });
  }

  enqueue(pcm16: Int16Array) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const buf = this.ctx.createBuffer(1, pcm16.length, this.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) ch[i] = pcm16[i] / 0x8000;
    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    const startAt = Math.max(now, this.nextStart);
    node.start(startAt);
    this.nextStart = startAt + buf.duration;
    this.active++;
    this.onPlaying?.(true);
    node.onended = () => {
      this.active--;
      if (this.active <= 0) this.onPlaying?.(false);
    };
  }

  reset() {
    this.nextStart = 0;
  }

  // Release the underlying AudioContext. Call from a page's useEffect cleanup
  // so re-entering the page doesn't accrete idle contexts (browsers cap ~6 per page).
  async close(): Promise<void> {
    try { await this.ctx.close(); } catch { /* already closed / non-fatal */ }
  }
}
