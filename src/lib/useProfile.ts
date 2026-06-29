// Profile + sessions hook — reads from the Main-process store via IPC.
import { useEffect, useState, useCallback } from 'react';
import type { UserProfile, PracticeSession, Utterance, Mistake } from '../../electron/storage/types';

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!window.echo?.store) { setLoading(false); return; }
    const p = await window.echo.store.getProfile();
    setProfile(p);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { profile, loading, reload, setProfile };
}

export function useSessions(userId: string | undefined) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);

  const reload = useCallback(async () => {
    if (!userId || !window.echo?.store) return;
    setSessions(await window.echo.store.getSessions(userId));
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  return { sessions, reload };
}

// Loads everything the Report page aggregates: sessions + all their utterances + mistakes.
export function useReportData(userId: string | undefined) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId || !window.echo?.store) { setLoading(false); return; }
    const sess = await window.echo.store.getSessions(userId);
    // fan-out: one getUtterances per session (LocalAdapter is in-memory; cheap)
    const uttLists = await Promise.all(sess.map((s) => window.echo.store.getUtterances(s.id)));
    setSessions(sess);
    setUtterances(uttLists.flat());
    setMistakes(await window.echo.store.getMistakes(userId));
    setLoading(false);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  return { sessions, utterances, mistakes, loading, reload };
}

// --- derived stats for Home ---
export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeStreak(sessions: PracticeSession[]): number {
  // Count consecutive days ending today (or yesterday) with a completed session.
  const days = new Set(sessions.filter((s) => s.completed).map((s) => s.date));
  let streak = 0;
  const cur = new Date();
  // allow today to be empty (streak still counts up to yesterday)
  if (!days.has(todayStr(cur))) cur.setDate(cur.getDate() - 1);
  while (days.has(todayStr(cur))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

export function weekSpeakingMinutes(sessions: PracticeSession[]): number {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 6);
  const startStr = todayStr(start);
  const endStr = todayStr(now);
  return sessions
    .filter((s) => s.date >= startStr && s.date <= endStr)
    .reduce((sum, s) => sum + (s.speaking_minutes || 0), 0);
}

// Mon-first 7-day completion flags for the week-dots row.
export function weekDots(sessions: PracticeSession[]): { date: string; done: boolean; today: boolean }[] {
  const done = new Set(sessions.filter((s) => s.completed).map((s) => s.date));
  const out: { date: string; done: boolean; today: boolean }[] = [];
  const now = new Date();
  const todayS = todayStr(now);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const ds = todayStr(d);
    out.push({ date: ds, done: done.has(ds), today: ds === todayS });
  }
  return out;
}
