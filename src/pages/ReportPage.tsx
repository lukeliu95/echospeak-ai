// ReportPage — Wave 3: real aggregates from practice_session / utterance / mistake.
// Top KPIs (本周练习天数 / 开口分钟 / 跟读句数 / 掌握句型), a pure-CSS daily speaking
// bar chart, and a high-frequency-mistake review list (sorted by occurrence, PRD §8).
// Friendly empty state when there is no data yet (no NaN, no crash).
import { useRouter } from '../router';
import { useReportData } from '../lib/useProfile';
import { computeKpis, dailySpeakingBars, topMistakes, categoryLabel } from '../lib/reportData';
import type { UserProfile } from '../../electron/storage/types';

export function ReportPage({ profile }: { profile: UserProfile | null }) {
  const { navigate } = useRouter();
  const { sessions, utterances, mistakes, loading } = useReportData(profile?.id);

  const kpis = computeKpis(sessions, utterances);
  const bars = dailySpeakingBars(sessions);
  const topMis = topMistakes(mistakes, 5);
  const hasAnyData = sessions.length > 0 || mistakes.length > 0;

  return (
    <div className="rp-main"><div className="rp-inner">
      <div className="rp-head">
        <h1>你的进步</h1>
        <div className="rp-tabs"><button className="on">本周</button></div>
      </div>

      <div className="rp-metrics rp-metrics-4">
        <div className="metric"><div className="m-lbl">本周练习天数</div><div className="m-num">{kpis.practiceDays}<span className="u">天</span></div></div>
        <div className="metric"><div className="m-lbl">本周开口时长</div><div className="m-num">{kpis.speakingMinutes}<span className="u">分钟</span></div></div>
        <div className="metric"><div className="m-lbl">本周跟读句数</div><div className="m-num">{kpis.shadowCount}<span className="u">句</span></div></div>
        <div className="metric"><div className="m-lbl">掌握句型</div><div className="m-num">{kpis.masteredCount}<span className="u">个</span></div></div>
      </div>

      <div className="rp-cols">
        {/* daily speaking-minutes bar chart (pure CSS) */}
        <div className="panel">
          <div className="p-title">每日开口分钟数 · 近 7 天</div>
          <div className="chart">
            {bars.map((b) => (
              <div className="bar" key={b.date} title={`${b.date} · ${b.minutes} 分钟`}>
                <div
                  className={`b-fill ${b.today ? 'muted' : ''}`}
                  style={{ height: `${Math.max(b.pct, b.minutes > 0 ? 6 : 2)}%` }}
                />
                <div className="b-day">{b.label}</div>
              </div>
            ))}
          </div>
          {!loading && kpis.speakingMinutes === 0 && (
            <div className="rp-empty-note">还没有开口记录。完成一次训练，这里会画出每天的开口时长。</div>
          )}
        </div>

        {/* high-frequency mistakes to review */}
        <div className="panel">
          <div className="p-title">高频错误 · 待复习</div>
          {topMis.length > 0 ? (
            <>
              {topMis.map((m) => (
                <div className="row-item" key={m.key}>
                  <span className="ri-cat">{categoryLabel(m.category)}</span>
                  <span className="ri-text" title={`→ ${m.correction}`}>{m.label}</span>
                  <span className="ri-bar"><i style={{ width: `${m.pct}%` }} /></span>
                  <span className="ri-count">{m.count} 次</span>
                </div>
              ))}
            </>
          ) : (
            <div className="rp-empty-note">
              {loading ? '加载中…' : '太棒了 — 暂无待复习的错误。完成训练后这里会按出现次数排出最该练的句子。'}
            </div>
          )}
        </div>
      </div>

      {/* CTA: review */}
      <div className="rp-next" onClick={() => navigate('review')} style={{ cursor: 'pointer' }}>
        <div className="n-ic"><svg viewBox="0 0 24 24" width="22" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6z" /></svg></div>
        <div style={{ flex: 1 }}>
          <div className="n-t">{hasAnyData ? '开始每日复习' : '复习清单建设中'}</div>
          <div className="n-d">
            {hasAnyData
              ? `把读不好的句子按"出现次数最多优先"捞出来重练一遍。当前 ${mistakes.filter((m) => !m.mastered).length} 句待复习。`
              : '先完成一次训练，系统会自动收集你读不好的句子，生成复习清单。'}
          </div>
        </div>
        <button className="es-btn es-btn-primary" style={{ padding: '10px 18px' }} onClick={(e) => { e.stopPropagation(); navigate('review'); }}>
          去复习 →
        </button>
      </div>
    </div></div>
  );
}
