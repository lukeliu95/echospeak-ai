import { useEffect, useRef, useState } from 'react';
import { MicCapture, AudioQueue, base64ToInt16 } from './lib/audio';

type Role = 'ai' | 'user';
interface Msg { role: Role; text: string; }
type Status = 'idle' | 'ai' | 'user' | 'analyzing' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  idle: 'Tap the mic to start talking',
  ai: 'AI speaking…  AI 在说',
  user: 'User speaking…  我在听你说',
  analyzing: 'Analyzing…  分析中',
  error: 'Connection error  连接出错',
};

export function ConversationPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [recording, setRecording] = useState(false);
  const [started, setStarted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [userSeconds, setUserSeconds] = useState(0);

  const mic = useRef<MicCapture | null>(null);
  const queue = useRef<AudioQueue | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const recordStart = useRef<number>(0);

  // Append text to the last bubble of `role`, or open a new bubble.
  function appendText(role: Role, chunk: string) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        const copy = prev.slice();
        copy[copy.length - 1] = { role, text: last.text + chunk };
        return copy;
      }
      return [...prev, { role, text: chunk }];
    });
  }

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Wire IPC subscriptions once.
  useEffect(() => {
    const api = window.echo;
    if (!api) return;
    queue.current = new AudioQueue(24000);
    queue.current.onPlaying = (active) => {
      setStatus((s) => (active ? 'ai' : s === 'ai' ? 'idle' : s));
    };

    const unsubs = [
      api.onAudio((chunk) => {
        const rate = /rate=(\d+)/.exec(chunk.mimeType)?.[1];
        if (rate && queue.current && Number(rate) !== 24000) {
          // Live model returns 24kHz; guard just in case.
        }
        queue.current?.enqueue(base64ToInt16(chunk.data));
      }),
      api.onAiText((t) => appendText('ai', t)),
      api.onUserText((t) => appendText('user', t)),
      api.onTurnComplete(() => setStatus((s) => (s === 'ai' ? 'idle' : s))),
      api.onError((m) => { setStatus('error'); setErrorMsg(m); }),
      api.onClosed(() => { setStarted(false); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // tick user talk time while recording
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setUserSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  async function ensureStarted(): Promise<boolean> {
    if (started) return true;
    const res = await window.echo.startConversation();
    if (!res.ok) { setStatus('error'); setErrorMsg(res.error || 'failed to start'); return false; }
    setStarted(true);
    setErrorMsg('');
    return true;
  }

  async function toggleMic() {
    if (recording) {
      setRecording(false);
      await mic.current?.stop();
      mic.current = null;
      setStatus('analyzing');
      return;
    }
    if (!(await ensureStarted())) return;
    mic.current = new MicCapture();
    try {
      recordStart.current = Date.now();
      await mic.current.start((b64) => window.echo.sendUserAudio(b64));
      setRecording(true);
      setStatus('user');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg('Mic error: ' + (e?.message || String(e)));
    }
  }

  async function endSession() {
    setRecording(false);
    await mic.current?.stop();
    mic.current = null;
    await window.echo.stopConversation();
    setStarted(false);
    setStatus('idle');
  }

  // crude talk-ratio: user seconds vs total elapsed bubbles (placeholder metric for the slice)
  const ratioPct = Math.min(100, Math.round((userSeconds / Math.max(1, userSeconds + 8)) * 100));
  const statusClass = `st-${status}`;
  const breathing = status === 'ai' || status === 'user';

  return (
    <>
      <div className="cv-top">
        <span className="cv-scn">AI Conversation · Free practice <small>Live · Gemini coach</small></span>
        <div className="cv-ratio">
          You spoke
          <div className="ratio-bar"><i style={{ transform: `scaleX(${ratioPct / 100})` }} /></div>
          {ratioPct}%
        </div>
      </div>

      <div className="cv-layout">
        <div className="cv-body">
          <div className="cv-stream" ref={streamRef}>
            {messages.length === 0 ? (
              <div className="cv-empty">
                Tap the microphone and say something in English.<br />
                The AI coach will reply by voice and keep the conversation going.
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`cv-msg ${m.role === 'ai' ? 'cv-ai' : 'cv-user'}`}>
                  <div className="m-who">{m.role === 'ai' ? 'AI Coach' : 'You'}</div>
                  <div className="m-bubble">{m.text}</div>
                </div>
              ))
            )}
          </div>

          <div className={`cv-status ${statusClass}`}>
            <span className={`cv-orb ${breathing ? 'breath' : ''}`} />
            <span className="st-txt">{status === 'error' ? `${STATUS_TEXT.error}: ${errorMsg}` : STATUS_TEXT[status]}</span>
          </div>

          <div className="cv-controls">
            <button
              className={`cv-mic ${recording ? 'recording' : ''}`}
              onClick={toggleMic}
              title={recording ? 'Stop speaking' : 'Start speaking'}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-3.1A7 7 0 0019 11h-2z" />
              </svg>
            </button>
            <span className="cv-mic-label">
              {recording ? 'Listening… tap again when you finish.' : started ? 'Tap to speak your turn.' : 'Tap to start the conversation.'}
            </span>
            <button className="cv-end" onClick={endSession}>End & summarize →</button>
          </div>
        </div>

        <aside className="cv-rail">
          <div>
            <div className="rail-label">Your speaking time</div>
            <div className="rail-data">{Math.floor(userSeconds / 60)}:{String(userSeconds % 60).padStart(2, '0')}<small>min</small></div>
            <div className="rail-sub">Counts while your mic is on.</div>
          </div>
          <div>
            <div className="rail-label">Turns</div>
            <div className="rail-data">{messages.filter((m) => m.role === 'user').length}<small>spoken</small></div>
            <div className="rail-sub">Keep talking — the coach lets you lead.</div>
          </div>
          <div>
            <div className="rail-label">Session</div>
            <div className="rail-sub">{started ? 'Live · connected' : 'Not started'}</div>
          </div>
        </aside>
      </div>
    </>
  );
}
