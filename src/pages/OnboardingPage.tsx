// OnboardingPage — first-run setup, ported from docs/design/mockups/onboarding.html.
// Goal locked (听说优先). Pick daily minutes + interest scenarios. Save UserProfile.
// "Skip" stores a default profile so the user lands on Home either way.
import { useState } from 'react';
import { useRouter } from '../router';
import type { UserProfile } from '../../electron/storage/types';

const TIMES: (15 | 30 | 45 | 60)[] = [15, 30, 45, 60];
const INTERESTS = ['日常生活', '工作沟通', '商务社交', '旅行', '面试', '学术'];

const DEFAULT_INTERESTS = ['日常生活', '工作沟通'];

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function buildProfile(minutes: 15 | 30 | 45 | 60, interests: string[]): UserProfile {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    native_language: 'zh-CN',
    target_language: 'en',
    listening_level: 'B1',
    speaking_level: 'B1',
    daily_practice_minutes: minutes,
    priority: { listening: 0.55, speaking: 0.35, reading: 0.1, writing: 0 },
    interests,
    business_scenarios: interests,
    created_at: now,
    updated_at: now,
  };
}

export function OnboardingPage({ onDone }: { onDone: () => void }) {
  const { navigate } = useRouter();
  const [minutes, setMinutes] = useState<15 | 30 | 45 | 60>(30);
  const [interests, setInterests] = useState<string[]>(DEFAULT_INTERESTS);
  const [saving, setSaving] = useState(false);

  function toggleInterest(label: string) {
    setInterests((cur) =>
      cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label],
    );
  }

  async function finish(useDefault: boolean) {
    setSaving(true);
    const chosen = useDefault || interests.length === 0 ? DEFAULT_INTERESTS : interests;
    const profile = buildProfile(useDefault ? 30 : minutes, chosen);
    await window.echo.store.saveProfile(profile);
    onDone();
    navigate('home');
  }

  return (
    <div className="ob-main"><div className="ob-inner">
      <div className="ob-progress">
        <span className="dot done" /><span className="dot done" /><span className="dot cur" /><span className="dot" />
      </div>
      <div className="ob-step-lbl">第 3 步 / 共 4 步</div>
      <h1 className="ob-h">告诉我你想练什么</h1>
      <p className="ob-sub">系统会替你安排每天练什么，你只管开口。设置只需 1 分钟。</p>

      {/* goal (locked: 听说优先) */}
      <div className="ob-section-lbl">你的目标</div>
      <div className="goal-card">
        <div className="gc-ic"><svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-3.1A7 7 0 0019 11h-2z" /></svg></div>
        <div>
          <div className="gc-t">听说优先</div>
          <div className="gc-d">听 55% · 说 35% · 读 10% · 不练写。把耳朵和嘴巴练出来。</div>
        </div>
        <div className="gc-check"><svg viewBox="0 0 24 24" width="22" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg></div>
      </div>

      {/* daily time */}
      <div className="ob-section-lbl">每天练多久</div>
      <div className="time-grid">
        {TIMES.map((t) => (
          <div
            key={t}
            className={`time-opt ${minutes === t ? 'sel' : ''}`}
            onClick={() => setMinutes(t)}
          >
            <div className="t-n">{t}</div>
            <div className="t-u">分钟</div>
            {t === 30 && <div className="t-rec">· 推荐 ·</div>}
          </div>
        ))}
      </div>

      {/* interests multi-select */}
      <div className="ob-section-lbl">你想在什么场景里开口（可多选）</div>
      <div className="chip-wrap">
        {INTERESTS.map((label) => (
          <span
            key={label}
            className={`chip ${interests.includes(label) ? 'sel' : ''}`}
            onClick={() => toggleInterest(label)}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="ob-footer">
        <span className="skip" onClick={() => !saving && finish(true)}>
          暂时跳过，先用默认计划开始
        </span>
        <button className="es-btn es-btn-primary ob-next" disabled={saving} onClick={() => finish(false)}>
          {saving ? '保存中…' : '完成设置，开始 →'}
        </button>
      </div>
    </div></div>
  );
}
