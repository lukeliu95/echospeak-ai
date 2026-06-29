// reportData — pure aggregation functions for the Report (进步) page.
//
// Kept framework-free and side-effect-free so they can be unit-tested headless
// (see test-report-data.mjs). Inputs are the raw storage rows; outputs are the
// shapes the ReportPage renders. No NaN: every divisor is guarded.

import type { PracticeSession, Utterance, Mistake } from '../../electron/storage/types';

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- KPI block (top metrics) ---
export interface ReportKpis {
  practiceDays: number;     // distinct days with a session this week
  speakingMinutes: number;  // sum of speaking_minutes this week
  shadowCount: number;      // # shadowing utterances this week
  masteredCount: number;    // distinct mastered phrases this week
}

// "this week" = the trailing 7 days ending today (inclusive), matching Home.
function weekRange(now = new Date()): { start: string; end: string } {
  const start = new Date(now);
  start.setDate(now.getDate() - 6);
  return { start: todayStr(start), end: todayStr(now) };
}

export function computeKpis(
  sessions: PracticeSession[],
  utterances: Utterance[],
  now = new Date(),
): ReportKpis {
  const { start, end } = weekRange(now);
  const weekSessions = sessions.filter((s) => s.date >= start && s.date <= end);
  const weekSessionIds = new Set(weekSessions.map((s) => s.id));

  const practiceDays = new Set(weekSessions.filter((s) => s.completed).map((s) => s.date)).size;
  const speakingMinutes = weekSessions.reduce((sum, s) => sum + (s.speaking_minutes || 0), 0);

  // utterances belonging to this week's sessions
  const weekUtts = utterances.filter((u) => weekSessionIds.has(u.session_id));
  const shadowCount = weekUtts.filter((u) => u.type === 'shadowing').length;

  // mastered phrases aren't a column on utterance; we approximate "mastered" as
  // the count of distinct high-scoring utterances (>=85 across the board would be
  // too strict, so we use completeness+pronunciation avg). Kept deterministic.
  const masteredCount = weekUtts.filter((u) => {
    if (u.type !== 'shadowing') return false;
    const p = u.score_pronunciation ?? 0;
    const c = u.score_completeness ?? 0;
    return (p + c) / 2 >= 85;
  }).length;

  return { practiceDays, speakingMinutes, shadowCount, masteredCount };
}

// --- daily speaking-minutes bar chart (trailing 7 days, Mon-style left→right by date) ---
export interface DayBar {
  date: string;
  label: string;   // 一..日 weekday glyph
  minutes: number;
  pct: number;     // 0..100 height relative to the max in the window
  today: boolean;
}

const WK = ['日', '一', '二', '三', '四', '五', '六'];

export function dailySpeakingBars(sessions: PracticeSession[], now = new Date()): DayBar[] {
  const byDate = new Map<string, number>();
  for (const s of sessions) {
    byDate.set(s.date, (byDate.get(s.date) || 0) + (s.speaking_minutes || 0));
  }
  const days: { date: string; minutes: number; today: boolean }[] = [];
  const todayS = todayStr(now);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const ds = todayStr(d);
    days.push({ date: ds, minutes: byDate.get(ds) || 0, today: ds === todayS });
  }
  const max = Math.max(1, ...days.map((d) => d.minutes)); // guard /0 -> no NaN
  return days.map((d) => ({
    date: d.date,
    label: WK[new Date(d.date + 'T00:00:00').getDay()],
    minutes: d.minutes,
    pct: Math.round((d.minutes / max) * 100),
    today: d.today,
  }));
}

// --- high-frequency mistakes to review (sorted by occurrence count desc) ---
export interface MistakeBucket {
  key: string;          // category + original (deduped)
  category: Mistake['category'];
  label: string;        // human label: the original text
  correction: string;
  count: number;        // # of mistake rows in this bucket (occurrence)
  reviewCount: number;  // max review_count seen
  pct: number;          // bar width 0..100 relative to top bucket
}

const CATEGORY_LABEL: Record<Mistake['category'], string> = {
  pronunciation: '发音',
  grammar: '语法',
  word_choice: '用词',
  fluency: '流畅度',
  missing_word: '漏词',
};

// Group unmastered mistakes by (category + normalized original), count occurrences,
// sort by count desc (PRD §8: 出现次数最多优先). Returns top `limit` buckets.
export function topMistakes(mistakes: Mistake[], limit = 5): MistakeBucket[] {
  const buckets = new Map<string, MistakeBucket>();
  for (const m of mistakes) {
    if (m.mastered) continue;
    const norm = m.original.trim().toLowerCase();
    const key = `${m.category}::${norm}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.reviewCount = Math.max(existing.reviewCount, m.review_count);
    } else {
      buckets.set(key, {
        key,
        category: m.category,
        label: m.original,
        correction: m.correction,
        count: 1,
        reviewCount: m.review_count,
        pct: 0,
      });
    }
  }
  const list = [...buckets.values()].sort((a, b) => b.count - a.count || b.reviewCount - a.reviewCount);
  const max = Math.max(1, ...list.map((b) => b.count));
  for (const b of list) b.pct = Math.round((b.count / max) * 100);
  return list.slice(0, limit);
}

export function categoryLabel(c: Mistake['category']): string {
  return CATEGORY_LABEL[c] ?? c;
}

// --- review selection (PRD §8): pick mistakes to re-drill ---
// Priority: unmastered first, then highest review_count, then most recently updated.
export function selectReviewMistakes(mistakes: Mistake[], limit = 8): Mistake[] {
  return mistakes
    .filter((m) => !m.mastered)
    .sort((a, b) => {
      if (b.review_count !== a.review_count) return b.review_count - a.review_count;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    })
    .slice(0, limit);
}
