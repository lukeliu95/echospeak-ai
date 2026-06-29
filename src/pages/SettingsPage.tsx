// SettingsPage — ported from docs/design/mockups/settings.html, adapted to the brief:
// AI service = Gemini (key held by Main; status only). Training prefs, recording policy,
// data backend. All changes persist to the local settings store.
import { useEffect, useState } from 'react';
import type { AiStatus } from '../global';
import type { UserProfile } from '../../electron/storage/types';
import { clickable } from '../lib/a11y';

type RecordingPolicy = 'none' | '7d' | 'forever';
const TIMES: (15 | 30 | 45 | 60)[] = [15, 30, 45, 60];

export function SettingsPage({ profile, onProfileChange }: {
  profile: UserProfile | null;
  onProfileChange: () => void;
}) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [minutes, setMinutes] = useState<15 | 30 | 45 | 60>(profile?.daily_practice_minutes ?? 30);
  const [reminderOn, setReminderOn] = useState(true);
  const [reminderTime, setReminderTime] = useState('20:00');
  const [policy, setPolicy] = useState<RecordingPolicy>('none');
  const [backend, setBackend] = useState<'local' | 'supabase'>('local');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      if (!window.echo) return;
      setStatus(await window.echo.aiStatus());
      const s = await window.echo.store.getSettings();
      if (s.reminderEnabled !== undefined) setReminderOn(Boolean(s.reminderEnabled));
      if (typeof s.reminderTime === 'string') setReminderTime(s.reminderTime);
      if (typeof s.recordingPolicy === 'string') setPolicy(s.recordingPolicy as RecordingPolicy);
      if (s.dataBackend === 'supabase') setBackend('supabase');
      if (typeof s.supabaseUrl === 'string') setSupabaseUrl(s.supabaseUrl);
      if (typeof s.supabaseKey === 'string') setSupabaseKey(s.supabaseKey);
    })();
  }, []);

  useEffect(() => {
    if (profile) setMinutes(profile.daily_practice_minutes);
  }, [profile]);

  async function save() {
    const patch: Record<string, unknown> = {
      reminderEnabled: reminderOn,
      reminderTime,
      recordingPolicy: policy,
      dataBackend: backend,
      supabaseUrl: supabaseUrl.trim(),
      supabaseKey: supabaseKey.trim(),
    };
    if (keyInput.trim()) patch.geminiKeyOverride = keyInput.trim();
    await window.echo.store.saveSettings(patch);

    // persist daily minutes on the profile
    if (profile && profile.daily_practice_minutes !== minutes) {
      await window.echo.store.saveProfile({ ...profile, daily_practice_minutes: minutes, updated_at: new Date().toISOString() });
      onProfileChange();
    }
    if (keyInput.trim()) setStatus(await window.echo.aiStatus());
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const sourceLabel: Record<AiStatus['source'], string> = {
    override: '本地填写的 Key',
    env: '环境变量 GEMINI_API_KEY',
    file: 'gei-memory/api-keys.env',
    none: '未找到',
  };

  return (
    <div className="st-main"><div className="st-inner">
      <h1 className="st-h">设置</h1>

      {/* AI service */}
      <div className="st-group">
        <div className="sg-title">AI 服务 · Gemini</div>
        <div className="sg-desc">EchoSpeak 用 Gemini 驱动语音对话与评分。Key 由后台进程持有，界面层从不接触。</div>
        {status?.connected ? (
          <div className="key-status">
            <svg viewBox="0 0 24 24" width="16" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
            已连接 · 来源：{sourceLabel[status.source]}
          </div>
        ) : (
          <div className="key-status" style={{ color: 'var(--es-error)' }}>
            未连接 · 未找到 Gemini Key
          </div>
        )}
        <div className="key-row" style={{ marginTop: 10 }}>
          <input
            className="key-input"
            type={showKey ? 'text' : 'password'}
            placeholder="可选：在此填入你自己的 Gemini API Key（存本地）"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button className="es-btn es-btn-secondary" onClick={() => setShowKey((s) => !s)}>{showKey ? '隐藏' : '显示'}</button>
        </div>
        <div className="key-note">
          <svg viewBox="0 0 24 24" width="16" fill="var(--es-info)" style={{ flexShrink: 0, marginTop: 1 }}><path d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm-1 14l-4-4 1.4-1.4L11 12.2l5.6-5.6L18 8z" /></svg>
          <span>填写的 Key 只存在本机（Electron userData），优先级高于环境变量与文件。留空则用系统已配置的 Key。</span>
        </div>
      </div>

      {/* training prefs */}
      <div className="st-group">
        <div className="sg-title">训练偏好</div>
        <div className="sg-desc">每天练多久。改动会更新今日计划的总时长与步骤分配。</div>
        <div className="time-grid">
          {TIMES.map((t) => (
            <div
              key={t}
              className={`time-opt ${minutes === t ? 'sel' : ''}`}
              {...clickable(() => setMinutes(t), `每日训练 ${t} 分钟`)}
              aria-pressed={minutes === t}
            >
              <div className="t-n">{t}</div><div className="t-u">分钟</div>
            </div>
          ))}
        </div>
        <div className="reminder-row" style={{ marginTop: 10 }}>
          <div
            className={`toggle ${reminderOn ? '' : 'off'}`}
            {...clickable(() => setReminderOn((v) => !v), '每日提醒开关')}
            role="switch"
            aria-checked={reminderOn}
          />
          <span className="reminder-meta">每天</span>
          <input className="time-pick" type="text" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} />
          <span className="reminder-meta">提醒我开口练英语</span>
        </div>
      </div>

      {/* recording policy */}
      <div className="st-group">
        <div className="sg-title">录音与隐私</div>
        <div className="sg-desc">当前版本只保存文字评分结果,录音音频评分后立即丢弃,不落盘。回放历史录音在后续版本中加入。</div>
        <div className="radio-list">
          {([
            ['none', '不保存录音', '评分后立即删除音频(当前唯一行为)', false],
            ['7d', '保存最近 7 天 · 即将推出', '需要回放历史录音的话先用这条提需求', true],
            ['forever', '永久保存 · 即将推出', '保留全部录音,需要的话提需求', true],
          ] as [RecordingPolicy, string, string, boolean][]).map(([val, t, d, disabled]) => (
            <label
              key={val}
              className={`radio-opt ${policy === val ? 'sel' : ''} ${disabled ? 'disabled' : ''}`}
              onClick={() => { if (!disabled) setPolicy(val); }}
              aria-disabled={disabled}
            >
              <span className="r-dot" />
              <div className="r-line"><span className="r-t">{t}</span><span className="r-d">{d}</span></div>
            </label>
          ))}
        </div>
      </div>

      {/* data backend */}
      <div className="st-group">
        <div className="sg-title" style={{ marginBottom: 0 }}>数据后端 · 当前 {status?.backend ?? 'local'}</div>
        <div className="sg-desc" style={{ marginBottom: 5 }}>默认存本机；可切到 Supabase 云端（填 URL + anon key，重启生效）。</div>
        <div className="backend-row">
          <button className={`backend-opt ${backend === 'local' ? 'sel' : ''}`} onClick={() => setBackend('local')}>本地存储</button>
          <button className={`backend-opt ${backend === 'supabase' ? 'sel' : ''}`} onClick={() => setBackend('supabase')}>Supabase 云端</button>
        </div>
        {backend === 'supabase' && (
          <div className="backend-fields">
            <input className="key-input" placeholder="https://xxxx.supabase.co" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} />
            <input className="key-input" type="password" placeholder="anon key" value={supabaseKey} onChange={(e) => setSupabaseKey(e.target.value)} />
            <span className="reminder-meta">未接真实例测试 · 需先在 Supabase 跑 supabase-schema.sql 建表</span>
          </div>
        )}
      </div>

      <div className="st-footer">
        {saved && <span className="reminder-meta" style={{ color: 'var(--es-success)', alignSelf: 'center' }}>已保存 ✓</span>}
        <button className="es-btn es-btn-primary" onClick={save}>保存设置</button>
      </div>
    </div></div>
  );
}
