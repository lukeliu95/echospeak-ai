// ReviewPage — Wave 3 daily review (PRD §8: 错误次数最多优先).
// Pulls the highest-priority unmastered mistakes via selectReviewMistakes, then
// runs a simplified 听→跟读→评分 loop (same Gemini engine as PracticePage). After
// each take we bump review_count; a strong read (avg >= 80) marks the mistake mastered.
// Reuses the practice page's visual language — no new visual style.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../router';
import { selectReviewMistakes } from '../lib/reportData';
import { MicRecorder, AudioQueue, base64ToInt16 } from '../lib/audio';
import { clickable } from '../lib/a11y';
import type { UserProfile, Mistake } from '../../electron/storage/types';
import type { ScoreResult } from '../global';

type Phase = 'idle' | 'listen' | 'recording' | 'scoring' | 'scored' | 'error';

function avgScore(s: ScoreResult): number {
  const v = s.scores;
  return Math.round((v.pronunciation + v.fluency + v.completeness + v.naturalness + v.confidence) / 5);
}

export function ReviewPage({ profile }: { profile: UserProfile | null }) {
  const { navigate } = useRouter();
  const [queue, setQueue] = useState<Mistake[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playErr, setPlayErr] = useState(''); // inline TTS playback hint — non-blocking (same fix as PracticePage)
  const [reviewedCount, setReviewedCount] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);
  const [done, setDone] = useState(false);

  const recorder = useRef<MicRecorder | null>(null);
  const audio = useRef<AudioQueue | null>(null);

  // Load the prioritized review queue once.
  useEffect(() => {
    (async () => {
      if (!profile || !window.echo?.store) { setLoaded(true); return; }
      const all = await window.echo.store.getMistakes(profile.id);
      setQueue(selectReviewMistakes(all, 8));
      setLoaded(true);
    })();
    return () => { recorder.current?.stop().catch(() => {}); };
  }, [profile]);

  const cur = queue[idx];
  const total = queue.length;
  // The sentence to re-read: the corrected form is the gold target.
  const target = useMemo(() => (cur ? (cur.correction || cur.original) : ''), [cur]);

  async function playTarget() {
    if (!window.echo?.speakSentence || !target) return;
    setPlaying(true);
    setPlayErr('');
    try {
      const res = await window.echo.speakSentence(target);
      if (!res.ok) { setPlaying(false); setPlayErr(res.error || '播放失败,请检查网络与 API Key'); return; }
      const rate = Number(/rate=(\d+)/.exec(res.mimeType)?.[1]) || 24000;
      const q = new AudioQueue(rate);
      q.onPlaying = (active) => setPlaying(active);
      audio.current = q;
      q.enqueue(base64ToInt16(res.audioBase64));
    } catch (e: any) {
      setPlaying(false);
      setPlayErr('播放失败:' + (e?.message || '未知错误'));
    }
  }

  async function toggleRecord() {
    if (phase === 'recording') {
      setPhase('scoring');
      try {
        const take = await recorder.current!.stop();
        recorder.current = null;
        const res = await window.echo.evaluateUtterance(take.wavBase64, target, 'audio/wav');
        if (!res.ok) { setPhase('error'); setErrMsg(res.error); return; }
        setScore(res.result);
        setPhase('scored');
        await recordReview(res.result);
      } catch (e: any) {
        setPhase('error');
        setErrMsg(e?.message || String(e));
      }
      return;
    }
    setScore(null);
    recorder.current = new MicRecorder();
    try {
      await recorder.current.start();
      setPhase('recording');
    } catch (e: any) {
      setPhase('error');
      setErrMsg('Mic error: ' + (e?.message || String(e)));
    }
  }

  // Bump review_count; mark mastered on a strong read so it leaves the queue.
  async function recordReview(result: ScoreResult) {
    if (!profile || !window.echo?.store || !cur) return;
    const mastered = avgScore(result) >= 80;
    await window.echo.store.saveMistake({
      ...cur,
      review_count: cur.review_count + 1,
      mastered,
      updated_at: new Date().toISOString(),
    });
    setReviewedCount((c) => c + 1);
    if (mastered) setMasteredCount((c) => c + 1);
  }

  function nextOne() {
    if (idx + 1 >= total) { setDone(true); return; }
    setIdx((i) => i + 1);
    setScore(null);
    setPhase('idle');
  }

  // ---- empty / loading / done states ----
  if (loaded && total === 0 && !done) {
    return (
      <div className="rv-wrap">
        <div className="rv-empty">
          <div className="rv-empty-ic">✓</div>
          <div className="rv-empty-t">暂无待复习的句子</div>
          <div className="rv-empty-d">完成训练时读不好的句子会进入复习清单，按出现次数最多优先排好等你重练。</div>
          <button className="es-btn es-btn-primary" style={{ marginTop: 20, padding: '12px 24px' }} onClick={() => navigate('practice')}>去练习 →</button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rv-wrap">
        <div className="rv-empty">
          <div className="rv-empty-ic">🎉</div>
          <div className="rv-empty-t">复习完成</div>
          <div className="rv-empty-d">本次复习了 {reviewedCount} 句，其中 {masteredCount} 句已读熟，移出复习清单。</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button className="es-btn es-btn-secondary" style={{ padding: '12px 22px' }} onClick={() => navigate('report')}>看进步</button>
            <button className="es-btn es-btn-primary" style={{ padding: '12px 22px' }} onClick={() => navigate('home')}>返回首页</button>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded || !cur) {
    return <div className="rv-wrap"><div className="rv-empty"><div className="rv-empty-d">加载复习清单…</div></div></div>;
  }

  const progressPct = Math.round((reviewedCount / total) * 100);

  return (
    <>
      <div className="pr-top">
        <span className="pr-title">每日复习 · 高频错误优先</span>
        <div className="pr-bar"><i style={{ width: `${progressPct}%` }} /></div>
        <span className="pr-pct">第 {idx + 1} / {total} 句</span>
        <span className="pr-exit" {...clickable(() => navigate('home'), '退出复习')}>退出</span>
      </div>

      <div className="rv-wrap rv-stage">
        <span className="es-tag ct-stage-tag" style={{ alignSelf: 'center' }}>复习 · 重读正确说法</span>

        {cur.explanation && cur.explanation !== '加入复习清单' && (
          <div className="rv-note">为什么标错：{cur.explanation}</div>
        )}
        <div className="rv-wrong">你之前说：<s>{cur.original}</s></div>
        <div className="ct-orig" style={{ textAlign: 'center', maxWidth: 560 }}>{target}</div>

        <div className="audio-player" style={{ maxWidth: 480, width: '100%' }}>
          <div className="ap-row">
            <button className="ap-play" onClick={playTarget} title="听正确说法" aria-label={playing ? '暂停播放' : '播放正确说法'}>
              {playing
                ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <div className="ap-wave">
              {[40, 70, 55, 90, 60, 75, 45, 85, 50, 65, 40, 80].map((h, i) => (
                <i key={i} className={playing ? 'played' : ''} style={{ height: `${h}%` }} />
              ))}
            </div>
            <span className="ap-time">{playing ? '播放中' : '点击听正确说法'}</span>
          </div>
          {playErr && <div className="play-err" role="alert">{playErr}</div>}
        </div>

        <div className="record-zone" style={{ paddingTop: 18, marginTop: 8 }}>
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
            {phase === 'recording' ? '正在录音…  跟着读一遍'
              : phase === 'scoring' ? '评分中…'
              : phase === 'scored' ? (avgScore(score!) >= 80 ? `读熟了 · ${avgScore(score!)} 分 ✓` : `${avgScore(score!)} 分 · 再练一次会更稳`)
              : phase === 'error' ? '出错了'
              : '点击开始跟读'}
          </div>
          {phase === 'error' && <div className="rec-hint" style={{ color: 'var(--es-error)' }}>{errMsg}</div>}
          {phase === 'scored' && score?.better && (
            <div className="rv-better">更地道：<b>{score.better}</b></div>
          )}
        </div>

        {(phase === 'scored' || phase === 'error') && (
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button className="es-btn es-btn-secondary" style={{ padding: '10px 20px' }} onClick={() => { setScore(null); setPhase('idle'); }}>再读一次</button>
            <button className="es-btn es-btn-primary" style={{ padding: '10px 20px' }} onClick={nextOne}>
              {idx + 1 >= total ? '完成复习 →' : '下一句 →'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
