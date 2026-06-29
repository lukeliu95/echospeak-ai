// HomePage — ported 1:1 from docs/design/mockups/home.html.
// Stats computed from local data (empty state shows 0). Daily plan via local generator.
import { useMemo } from 'react';
import { useRouter } from '../router';
import { useSessions, computeStreak, weekSpeakingMinutes, weekDots, todayStr } from '../lib/useProfile';
import { generateDailyPlan } from '../lib/dailyPlan';
import type { UserProfile } from '../../electron/storage/types';

const GREETING = (() => {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
})();

function dateLabel(): string {
  const d = new Date();
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${wk}`;
}

export function HomePage({ profile }: { profile: UserProfile }) {
  const { navigate } = useRouter();
  const { sessions } = useSessions(profile.id);

  const streak = computeStreak(sessions);
  const weekMin = weekSpeakingMinutes(sessions);
  const dots = weekDots(sessions);

  const plan = useMemo(
    () =>
      generateDailyPlan({
        interests: profile.interests,
        scenarios: profile.business_scenarios,
        totalMinutes: profile.daily_practice_minutes,
        level: profile.speaking_level,
        date: todayStr(),
      }),
    [profile],
  );

  return (
    <div className="home-main"><div className="home-inner">
      <div className="home-top">
        <div className="home-greet">{GREETING}<small>今天，把耳朵和嘴巴再练一次。</small></div>
        <div className="home-date">{dateLabel()}</div>
      </div>

      <div className="home-stats">
        <div className="stat">
          <div><span className="num">{streak}</span><span className="unit">天</span></div>
          <div className="lbl">连续练习</div>
          <div className="week-dots">
            {dots.map((d) => (
              <i key={d.date} className={d.today ? 'today' : d.done ? 'on' : ''} />
            ))}
          </div>
        </div>
        <div className="stat">
          <div><span className="num muted">{weekMin}</span><span className="unit">分钟</span></div>
          <div className="lbl">本周开口时长</div>
        </div>
      </div>

      {/* DailyPlanCard · focal */}
      <div className="plan-card">
        <div className="plan-head">
          <div>
            <div className="plan-theme">今日主题 · {plan.theme} <span className="es-tag">{plan.level}</span></div>
            <div className="plan-meta">目标：{plan.goal}</div>
          </div>
          <div className="plan-min"><div className="n">{plan.totalMinutes}</div><div className="u">分钟</div></div>
        </div>

        <div className="plan-steps">
          {plan.steps.map((s) => (
            <div className="pstep" key={s.name}>
              <div className="s-name">{s.name}</div>
              <div className="s-min">{s.minutes} min</div>
              <div className="s-bar" />
            </div>
          ))}
        </div>

        <button className="start-btn" autoFocus onClick={() => navigate('practice')}>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          Start Today's Practice
        </button>
      </div>

      {/* secondary actions */}
      <div className="quick-row">
        <div className="quick" onClick={() => navigate('practice')}>
          <div className="q-ic"><svg viewBox="0 0 24 24" width="16" fill="currentColor"><path d="M13 2v8h8a9 9 0 11-8-8z" /></svg></div>
          <div className="q-t">Quick 10-Min</div>
          <div className="q-d">没时间？系统自动选主题</div>
        </div>
        <div className="quick" onClick={() => navigate('conversation')}>
          <div className="q-ic"><svg viewBox="0 0 24 24" width="16" fill="currentColor"><path d="M12 3a9 9 0 00-9 9 9 9 0 009 9 9 9 0 009-9 9 9 0 00-9-9zm0 4a3 3 0 110 6 3 3 0 010-6z" /></svg></div>
          <div className="q-t">Free Talk</div>
          <div className="q-d">直接和 AI 自由聊</div>
        </div>
        <div className="quick" onClick={() => navigate('review')}>
          <div className="q-ic"><svg viewBox="0 0 24 24" width="16" fill="currentColor"><path d="M3 3h18v4H3zm0 7h18v4H3zm0 7h12v4H3z" /></svg></div>
          <div className="q-t">Review Mistakes</div>
          <div className="q-d">复习昨天读不好的句子</div>
        </div>
      </div>

      <div className="review-hint">
        <span>今天的复习清单会在你完成训练后生成。先开口练一次吧。</span>
        <button className="es-btn-ghost" onClick={() => navigate('report')}>看进步 →</button>
      </div>
    </div></div>
  );
}
