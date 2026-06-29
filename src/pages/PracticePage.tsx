// PracticePage — Wave 2 scored shadowing trainer (ported from docs/design/mockups/practice.html).
// Flow: hear the target (Gemini TTS) → record your read (MicRecorder) → score it
// (ai:evaluateUtterance, Gemini multimodal) → show 5-dim rubric + feedback + mistakes.
// On finishing the set it writes utterance/mistake rows + a completed practice_session
// so Home stats (streak / weekly speaking minutes) move off zero.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../router';
import { generateDailyPlan } from '../lib/dailyPlan';
import { todayStr } from '../lib/useProfile';
import { getShadowSentences } from '../lib/sentenceBank';
import { clickable } from '../lib/a11y';
import { MicRecorder, AudioQueue, base64ToInt16 } from '../lib/audio';
import type { UserProfile, Utterance, Mistake, PracticeSession } from '../../electron/storage/types';
import type { ScoreResult } from '../global';

type Phase = 'listen' | 'recording' | 'scoring' | 'scored' | 'error';

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Display labels only — the underlying ScoreResult field names (pronunciation/…)
// are the scoring engine's JSON contract and must NOT change. PRD §7.9 口径.
const DIM_LABELS: [keyof ScoreResult['scores'], string][] = [
  ['pronunciation', '发音'],
  ['fluency', '流畅度'],
  ['completeness', '完整度'],
  ['naturalness', '自然度'],
  ['confidence', '表达稳定度'],
];

export function PracticePage({ profile }: { profile: UserProfile | null }) {
  const { navigate } = useRouter();

  const plan = useMemo(
    () =>
      generateDailyPlan({
        interests: profile?.interests ?? [],
        scenarios: profile?.business_scenarios ?? [],
        totalMinutes: profile?.daily_practice_minutes ?? 30,
        level: profile?.speaking_level ?? 'B1',
        date: todayStr(),
      }),
    [profile],
  );

  const sentences = useMemo(() => getShadowSentences(plan.scenario), [plan.scenario]);

  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('listen');
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playErr, setPlayErr] = useState(''); // inline TTS playback hint — non-blocking
  const [doneCount, setDoneCount] = useState(0); // sentences with at least one scored take
  const [completed, setCompleted] = useState(false);
  const [reviewMarked, setReviewMarked] = useState(false);

  // session id stays stable across the whole set so all utterances group together.
  const sessionId = useRef<string>(uid('sess'));
  const sessionStart = useRef<number>(Date.now());
  const speakingMs = useRef<number>(0); // accumulated record-button-on time
  const recStart = useRef<number>(0);
  const lastUtteranceId = useRef<string | null>(null);
  const recorder = useRef<MicRecorder | null>(null);
  const queue = useRef<AudioQueue | null>(null);

  const cur = sentences[idx];
  const total = sentences.length;

  useEffect(() => {
    queue.current = new AudioQueue(24000);
    queue.current.onPlaying = (active) => setPlaying(active);
    return () => { recorder.current?.stop().catch(() => {}); };
  }, []);

  // ---- play the original sentence via Gemini TTS (degrade gracefully) ----
  async function playOriginal() {
    if (!window.echo?.speakSentence) return;
    setPlaying(true);
    setPlayErr('');
    try {
      const res = await window.echo.speakSentence(cur.en);
      if (!res.ok) { setPlaying(false); setPlayErr(res.error || '播放失败,请检查网络与 API Key'); return; }
      const rate = Number(/rate=(\d+)/.exec(res.mimeType)?.[1]) || 24000;
      const q = new AudioQueue(rate);
      q.onPlaying = (active) => setPlaying(active);
      queue.current = q;
      q.enqueue(base64ToInt16(res.audioBase64));
    } catch (e: any) {
      setPlaying(false);
      setPlayErr('播放失败:' + (e?.message || '未知错误'));
    }
  }

  // ---- record / stop + score ----
  async function toggleRecord() {
    if (phase === 'recording') {
      // stop + score
      speakingMs.current += Date.now() - recStart.current;
      setPhase('scoring');
      try {
        const take = await recorder.current!.stop();
        recorder.current = null;
        const res = await window.echo.evaluateUtterance(take.wavBase64, cur.en, 'audio/wav');
        if (!res.ok) { setPhase('error'); setErrMsg(res.error); return; }
        setScore(res.result);
        setPhase('scored');
        await persistTake(res.result);
        setDoneCount((c) => Math.max(c, idx + 1));
      } catch (e: any) {
        setPhase('error');
        setErrMsg(e?.message || String(e));
      }
      return;
    }
    // start recording
    setScore(null);
    setReviewMarked(false);
    recorder.current = new MicRecorder();
    try {
      await recorder.current.start();
      recStart.current = Date.now();
      setPhase('recording');
    } catch (e: any) {
      setPhase('error');
      setErrMsg('Mic error: ' + (e?.message || String(e)));
    }
  }

  // ---- data closure: write one utterance (+ mistakes) per scored take ----
  async function persistTake(result: ScoreResult) {
    if (!profile || !window.echo?.store) return;
    const now = new Date().toISOString();
    const utteranceId = uid('utt');
    lastUtteranceId.current = utteranceId;
    const utterance: Utterance = {
      id: utteranceId,
      session_id: sessionId.current,
      type: 'shadowing',
      prompt_text: cur.en,
      user_transcript: result.transcript,
      improved_text: result.better || null,
      audio_path: null,
      score_pronunciation: result.scores.pronunciation,
      score_fluency: result.scores.fluency,
      score_completeness: result.scores.completeness,
      score_naturalness: result.scores.naturalness,
      score_confidence: result.scores.confidence,
      feedback: result.feedback.join(' '),
      created_at: now,
    };
    await window.echo.store.saveUtterance(utterance);

    for (const m of result.mistakes) {
      const mistake: Mistake = {
        id: uid('mis'),
        user_id: profile.id,
        utterance_id: utteranceId,
        category: m.category,
        original: m.original,
        correction: m.correction,
        explanation: m.explanation || null,
        review_count: 0,
        mastered: false,
        created_at: now,
        updated_at: now,
      };
      await window.echo.store.saveMistake(mistake);
    }
  }

  // ---- "加入复习": bump review_count on this take's mistakes (or log the whole sentence) ----
  async function addToReview() {
    if (!profile || !window.echo?.store || reviewMarked) return;
    const now = new Date().toISOString();
    const mistakes = score?.mistakes ?? [];
    if (mistakes.length === 0 && lastUtteranceId.current) {
      // Clean read but the user still wants to revisit — store a review marker.
      await window.echo.store.saveMistake({
        id: uid('mis'),
        user_id: profile.id,
        utterance_id: lastUtteranceId.current,
        category: 'fluency',
        original: cur.en,
        correction: cur.en,
        explanation: '加入复习清单',
        review_count: 1,
        mastered: false,
        created_at: now,
        updated_at: now,
      });
    } else {
      const all = await window.echo.store.getMistakes(profile.id);
      for (const m of all.filter((x) => x.utterance_id === lastUtteranceId.current)) {
        await window.echo.store.saveMistake({ ...m, review_count: m.review_count + 1, updated_at: now });
      }
    }
    setReviewMarked(true);
  }

  // ---- finish the set: write the completed practice_session ----
  async function finishSet() {
    if (!profile || !window.echo?.store) { navigate('home'); return; }
    const actualMin = Math.max(1, Math.round((Date.now() - sessionStart.current) / 60000));
    const speakingMin = Math.max(1, Math.round(speakingMs.current / 60000));
    const session: PracticeSession = {
      id: sessionId.current,
      user_id: profile.id,
      date: todayStr(),
      planned_minutes: plan.totalMinutes,
      actual_minutes: actualMin,
      speaking_minutes: speakingMin,
      listening_minutes: Math.max(0, actualMin - speakingMin),
      completed: true,
      topic: plan.theme,
      mode: 'daily',
      summary: `跟读 ${doneCount}/${total} 句 · ${plan.theme}`,
      created_at: new Date().toISOString(),
    };
    await window.echo.store.saveSession(session);
    setCompleted(true);
  }

  function nextSentence() {
    if (idx + 1 >= total) { finishSet(); return; }
    setIdx((i) => i + 1);
    setScore(null);
    setPhase('listen');
    setReviewMarked(false);
  }

  function retry() {
    setScore(null);
    setPhase('listen');
    setReviewMarked(false);
  }

  // progress: fraction of sentences with a scored take
  const progressPct = Math.round((doneCount / total) * 100);

  // ---- completed summary view ----
  if (completed) {
    return (
      <>
        <div className="pr-top">
          <span className="pr-title">今日训练 · {plan.theme}</span>
          <div className="pr-bar"><i style={{ width: '100%' }} /></div>
          <span className="pr-pct">{doneCount}/{total} 句</span>
          <span className="pr-exit" {...clickable(() => navigate('home'), '返回首页')}>返回首页</span>
        </div>
        <div className="pr-grid">
          <div className="pr-col pr-center" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', gridColumn: '1 / -1' }}>
            <span className="es-tag ct-stage-tag" style={{ alignSelf: 'center' }}>训练完成</span>
            <div className="ct-orig" style={{ maxWidth: 460 }}>完成了 {doneCount} / {total} 句跟读 🎉</div>
            <div className="ct-zh" style={{ maxWidth: 460 }}>
              成绩已经记录。回到首页看看你的连续天数和本周开口时长吧。
            </div>
            <button
              className="es-btn es-btn-primary"
              style={{ marginTop: 28, padding: '14px 28px', fontSize: 'var(--es-fs-subtitle)' }}
              onClick={() => navigate('home')}
            >
              返回首页 →
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pr-top">
        <span className="pr-title">今日训练 · {plan.theme}</span>
        <div className="pr-bar"><i style={{ width: `${progressPct}%` }} /></div>
        <span className="pr-pct">第 {idx + 1} / {total} 句</span>
        <span className="pr-exit" {...clickable(() => finishSet(), '完成训练并退出')}>完成退出</span>
      </div>

      <div className="pr-grid">
        {/* LEFT: steps + position */}
        <div className="pr-col pr-left">
          <div className="col-lbl">训练步骤</div>
          <ul className="step-list">
            {plan.steps.map((s, i) => (
              <li key={s.name} className={`step-item ${i === 1 ? 'si-cur' : i < 1 ? 'si-done' : 'si-todo'}`}>
                <span className="si-dot">
                  {i < 1 ? <svg viewBox="0 0 24 24" width="11" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg> : null}
                </span>
                <span className="si-name">{s.name}</span>
                <span className="si-min">{s.minutes} min</span>
              </li>
            ))}
          </ul>
          <div className="time-box">
            <div className="tb-lbl">跟读进度</div>
            <div className="tb-val">{idx + 1}/{total}</div>
            <div className="tb-sub">目标：{plan.goal}</div>
          </div>
        </div>

        {/* CENTER: original + player + record */}
        <div className="pr-col pr-center">
          <span className="es-tag ct-stage-tag">跟读 · Shadowing</span>
          <div className="ct-orig">{cur.en}</div>
          <div className="ct-zh">{cur.zh}</div>

          <div className="audio-player">
            <div className="ap-row">
              <button className="ap-play" onClick={playOriginal} title="听原句" aria-label={playing ? '暂停播放' : '播放原句'}>
                {playing
                  ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                  : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
              </button>
              <div className="ap-wave">
                {[40, 70, 55, 90, 60, 75, 45, 85, 50, 65, 40, 80, 55, 35].map((h, i) => (
                  <i key={i} className={playing ? 'played' : ''} style={{ height: `${h}%` }} />
                ))}
              </div>
              <span className="ap-time">{playing ? '播放中' : '点击听原句'}</span>
            </div>
            <div className="ap-tools">
              <button className="ap-tool" onClick={playOriginal}>⟲ 重听</button>
            </div>
          </div>
          {playErr && <div className="play-err" role="alert">{playErr}</div>}

          <div className="record-zone">
            <button
              className="rec-btn"
              onClick={toggleRecord}
              disabled={phase === 'scoring'}
              style={phase === 'scoring' ? { opacity: 0.5, cursor: 'wait' } : undefined}
              title={phase === 'recording' ? '停止录音' : '开始跟读'}
            >
              {phase === 'recording'
                ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-3.1A7 7 0 0019 11h-2z" /></svg>}
            </button>
            <div className="rec-state">
              {phase === 'recording' ? '正在录音…  轮到你说'
                : phase === 'scoring' ? '评分中…  AI 正在听'
                : phase === 'scored' ? '已评分 · 看右侧反馈'
                : phase === 'error' ? '出错了'
                : '点击开始跟读'}
            </div>
            <div className="rec-hint">
              {phase === 'recording' ? '点击停止 · 跟着原句的节奏说一遍' : '先点上方播放听原句，再跟读'}
            </div>
            {score?.transcript && (
              <div className="user-transcript">你说的：<b>{score.transcript}</b></div>
            )}
          </div>
        </div>

        {/* RIGHT: feedback */}
        <div className="pr-col pr-right">
          <div className="fb-section">
            <div className="col-lbl">实时反馈</div>
            {phase === 'error' ? (
              <div style={{ color: 'var(--es-error)', fontSize: 'var(--es-fs-label)' }}>{errMsg}</div>
            ) : !score ? (
              <div style={{ color: 'var(--es-text-tertiary)', fontSize: 'var(--es-fs-label)' }}>
                录一句，这里会出现 5 维评分与纠错。
              </div>
            ) : (
              <>
                {score.feedback[0] && <div className="fb-pos">✓ {score.feedback[0]}</div>}
                <div className="score-list">
                  {DIM_LABELS.map(([k, label]) => {
                    const v = score.scores[k];
                    return (
                      <div className="score-item" key={k}>
                        <div className="sr-top"><span className="sr-name">{label}</span><span className="sr-val">{v}</span></div>
                        <div className="sr-track"><div className={`sr-fill${v < 75 ? ' low' : ''}`} style={{ transform: `scaleX(${v / 100})` }} /></div>
                      </div>
                    );
                  })}
                </div>
                {(score.feedback[1] || score.better) && (
                  <div className="fb-correct">
                    {score.better && <><div>更地道的说法：</div><div className="fc-better">"{score.better}"</div></>}
                    {score.feedback[1] && <div className="fc-why">{score.feedback[1]}</div>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button className="es-btn es-btn-secondary" style={{ flex: 1, fontSize: 13, padding: 9 }} onClick={retry}>再练一次</button>
                  <button className="es-btn es-btn-ghost" style={{ flex: 1, fontSize: 13, padding: 9, color: 'var(--es-accent)' }} onClick={addToReview} disabled={reviewMarked}>
                    {reviewMarked ? '已加入 ✓' : '加入复习'}
                  </button>
                </div>
                <button
                  className="es-btn es-btn-primary"
                  style={{ width: '100%', marginTop: 8, fontSize: 13, padding: 10 }}
                  onClick={nextSentence}
                >
                  {idx + 1 >= total ? '完成训练 →' : '下一句 →'}
                </button>
              </>
            )}
          </div>

          {score && score.mastered_phrases.length > 0 && (
            <div className="fb-section">
              <div className="col-lbl">本句掌握表达</div>
              {score.mastered_phrases.map((p, i) => <span className="mastered-tag" key={i}>{p}</span>)}
            </div>
          )}

          {score && score.mistakes.length > 0 && (
            <div className="fb-section">
              <div className="col-lbl">错误记录</div>
              {score.mistakes.map((m, i) => (
                <div className="mistake-row" key={i}>
                  <span className="mk-dot" />
                  <div><span className="mk-o">{m.original}</span> → <span className="mk-c">{m.correction}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
