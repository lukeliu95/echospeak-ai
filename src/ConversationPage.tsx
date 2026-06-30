import { useEffect, useRef, useState } from 'react';
import { MicCapture, AudioQueue, base64ToInt16 } from './lib/audio';
import { TypewriterBubble, ConversationAvatar } from './conversationParts';
import { useProfile, todayStr } from './lib/useProfile';
import { useRouter } from './router';
import type { ConversationSummary } from './global';
import type { PracticeSession } from '../electron/storage/types';

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
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const { profile } = useProfile();
  const { navigate } = useRouter();
  const mic = useRef<MicCapture | null>(null);
  const queue = useRef<AudioQueue | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const recordStart = useRef<number>(0);
  const sessionStart = useRef<number>(Date.now());

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
    return () => {
      unsubs.forEach((u) => u());
      mic.current?.stop().catch(() => {}); // user navigated away mid-talk — don't leak the mic
      queue.current?.close();              // free the AudioContext too (browsers cap ~6/page)
    };
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
    // Disable the End button + show the analyzing state immediately so the user
    // never sees the page sit silent after they tap End (Wave-3 false-promise fix).
    if (summarizing) return;
    setSummarizing(true);
    setSummaryError('');
    setRecording(false);
    setStatus('analyzing');

    // Snapshot stats BEFORE we tear down the mic, so the summary reflects what
    // actually happened in this session.
    const durationSec = Math.max(0, Math.round((Date.now() - sessionStart.current) / 1000));
    const userTalkSec = userSeconds;
    const snapshot = messages.map((m) => ({ role: m.role, text: m.text }));

    // Ask Gemini for the structured coach summary. If it fails we STILL tear
    // down audio/mic — leaking the mic because the summary call errored is
    // unacceptable (round-005 lesson).
    let result: ConversationSummary | null = null;
    try {
      const res = await window.echo.summarizeConversation({
        messages: snapshot,
        durationSec,
        userTalkSec,
      });
      if (res.ok) result = res.result;
      else setSummaryError(res.error || 'Summary failed');
    } catch (e: any) {
      setSummaryError(e?.message || String(e));
    }

    // Always tear down — mic / live audio / queue — even if the summary errored.
    try { await mic.current?.stop(); } catch { /* ignore */ }
    mic.current = null;
    try { await window.echo.stopConversation(); } catch { /* ignore */ }
    setStarted(false);

    if (result) {
      setSummary(result);
      // Write a practice_session so Home's "本周开口分钟" / streak reflects this
      // free-talk session. Don't block the UI on the storage call.
      if (profile && window.echo?.store) {
        const speakingMin = Math.max(1, Math.round(userTalkSec / 60));
        const actualMin = Math.max(speakingMin, Math.round(durationSec / 60));
        const session: PracticeSession = {
          id: `sess-conv-${Date.now()}`,
          user_id: profile.id,
          date: todayStr(),
          planned_minutes: speakingMin,
          actual_minutes: actualMin,
          speaking_minutes: speakingMin,
          listening_minutes: Math.max(0, actualMin - speakingMin),
          completed: true,
          topic: 'Free practice',
          mode: 'free_talk',
          summary: result.overall_feedback.slice(0, 200),
          created_at: new Date().toISOString(),
        };
        try { await window.echo.store.saveSession(session); }
        catch (e) { console.error('saveSession (free_talk) failed:', e); }
      }
    }

    setStatus('idle');
    setSummarizing(false);
  }

  // "Try another round" — wipe the summary + transcript so the learner can
  // start a fresh free-talk session without leaving the page.
  function restartConversation() {
    setSummary(null);
    setSummaryError('');
    setMessages([]);
    setUserSeconds(0);
    sessionStart.current = Date.now();
    setStatus('idle');
  }

  // crude talk-ratio: user seconds vs total elapsed bubbles (placeholder metric for the slice)
  const ratioPct = Math.min(100, Math.round((userSeconds / Math.max(1, userSeconds + 8)) * 100));
  const statusClass = `st-${status}`;

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
            {messages.length === 0 && !summary ? (
              <div className="cv-empty">
                Tap the microphone and say something in English.<br />
                The AI coach will reply by voice and keep the conversation going.
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`cv-msg ${m.role === 'ai' ? 'cv-ai' : 'cv-user'}`}>
                  <div className="m-who">{m.role === 'ai' ? 'AI Coach' : 'You'}</div>
                  <TypewriterBubble text={m.text} role={m.role} />
                </div>
              ))
            )}

            {summary && (
              <section className="cv-summary" aria-live="polite">
                <header className="cv-sum-head">
                  <span className="cv-sum-eyebrow">Session summary · 本次回顾</span>
                  <h3 className="cv-sum-title">{summary.overall_feedback}</h3>
                </header>

                <div className="cv-sum-stats">
                  <div>
                    <div className="cv-sum-num">{summary.speaking_minutes.toFixed(1)}<small>min</small></div>
                    <div className="cv-sum-cap">You spoke · 开口时长</div>
                  </div>
                  <div>
                    <div className="cv-sum-num">{summary.turn_count}<small>turns</small></div>
                    <div className="cv-sum-cap">Turns taken · 发言轮数</div>
                  </div>
                </div>

                {summary.strengths.length > 0 && (
                  <div className="cv-sum-block">
                    <div className="cv-sum-h">What you did well · 做得好</div>
                    <ul>
                      {summary.strengths.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}

                {summary.improvements.length > 0 && (
                  <div className="cv-sum-block">
                    <div className="cv-sum-h">One thing to try · 一个改进点</div>
                    <ul>
                      {summary.improvements.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}

                {summary.useful_phrases.length > 0 && (
                  <div className="cv-sum-block">
                    <div className="cv-sum-h">Useful phrases · 值得记住</div>
                    <div className="cv-sum-tags">
                      {summary.useful_phrases.map((p, i) => <span key={i} className="cv-sum-tag">{p}</span>)}
                    </div>
                  </div>
                )}

                {summary.next_step && (
                  <div className="cv-sum-block">
                    <div className="cv-sum-h">Next time · 下次试试</div>
                    <p className="cv-sum-next">{summary.next_step}</p>
                  </div>
                )}

                <div className="cv-sum-actions">
                  <button className="cv-sum-btn cv-sum-primary" onClick={restartConversation}>再来一段 · One more round</button>
                  <button className="cv-sum-btn" onClick={() => navigate('home')}>返回首页 · Back to home</button>
                </div>
              </section>
            )}

            {summaryError && !summary && (
              <div className="cv-sum-err">
                Couldn't generate a summary: {summaryError}.
                <button className="cv-sum-btn" onClick={() => navigate('home')}>Back to home</button>
              </div>
            )}
          </div>

          <div className={`cv-status ${statusClass}`}>
            <ConversationAvatar status={status} />
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
            <button
              className="cv-end"
              onClick={endSession}
              disabled={summarizing || (messages.length === 0 && !started)}
            >
              {summarizing ? 'Summarizing…  生成总结中' : summary ? 'Summary ready ↓' : 'End & summarize →'}
            </button>
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
