// reminder.ts — daily local notification (Main process only).
//
// Reads { reminderEnabled, reminderTime: "HH:MM" } from the settings bag and
// schedules ONE timer to the next occurrence of that time. When it fires it shows
// a native Notification; clicking it focuses the app window. After firing it
// re-arms for the next day. Call scheduleReminder() again whenever settings change.
//
// Real delivery needs a real machine + the clock reaching the set time, so this is
// "未实测触发" in CI — but the scheduling code path is exercised programmatically
// (see test-reminder.mjs) to prove no exceptions and correct next-fire math.
import { Notification } from 'electron';

let timer: ReturnType<typeof setTimeout> | null = null;

export interface ReminderConfig {
  enabled: boolean;
  time: string; // "HH:MM" 24h
}

// Parse "HH:MM" → {h, m}; returns null if malformed (caller treats as disabled).
export function parseTime(t: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

// Milliseconds from `from` until the next occurrence of h:m (today if still ahead,
// else tomorrow). Exported pure so it can be unit-tested without real timers.
export function msUntilNext(h: number, m: number, from = new Date()): number {
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - from.getTime();
}

export function cancelReminder(): void {
  if (timer) { clearTimeout(timer); timer = null; }
}

// (Re)schedule the daily reminder. `onFocus` is called when the user clicks the
// notification (Main wires it to focus the BrowserWindow).
export function scheduleReminder(cfg: ReminderConfig, onFocus: () => void): void {
  cancelReminder();
  if (!cfg.enabled) return;
  const parsed = parseTime(cfg.time);
  if (!parsed) return;

  const arm = () => {
    const delay = msUntilNext(parsed.h, parsed.m);
    timer = setTimeout(() => {
      try {
        if (Notification.isSupported()) {
          const n = new Notification({
            title: 'EchoSpeak AI',
            body: '该开口练英语啦 — 今天的训练在等你。',
            silent: false,
          });
          n.on('click', () => onFocus());
          n.show();
        }
      } catch {
        // never let a notification failure crash the app
      }
      arm(); // re-arm for the next day
    }, delay);
    // Don't keep the event loop alive solely for the reminder.
    if (timer && typeof (timer as any).unref === 'function') (timer as any).unref();
  };
  arm();
}
