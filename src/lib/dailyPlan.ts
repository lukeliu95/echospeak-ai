// Local daily-plan generator (Wave 1). Picks one preset theme based on the user's
// chosen interest scenarios, deterministically by date so the plan is stable for a day.
// Gemini dynamic generation replaces this in a later wave (ai:generateDailyPlan).

export interface PlanStep {
  name: string;
  minutes: number;
}
export interface DailyPlan {
  theme: string;
  scenario: string;
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
  goal: string;
  totalMinutes: number;
  steps: PlanStep[];
}

// scenario id -> preset theme bank. interests in onboarding map to these ids.
interface PresetTheme {
  scenario: string;
  theme: string;
  goal: string;
}

const PRESETS: PresetTheme[] = [
  { scenario: 'work', theme: '工作沟通', goal: '能用英语简单介绍正在做的项目进展' },
  { scenario: 'business', theme: '商务社交', goal: '能在会议开场做一句自我介绍并接住寒暄' },
  { scenario: 'daily', theme: '日常生活', goal: '能用英语点一杯咖啡并加一个特殊要求' },
  { scenario: 'travel', theme: '旅行', goal: '能在机场问路并听懂登机口变更广播' },
  { scenario: 'interview', theme: '面试', goal: '能用三句话讲清一段过往项目经历' },
  { scenario: 'academic', theme: '学术', goal: '能在讨论中用英语提出一个澄清性问题' },
];

// Fallback when user picked nothing / unknown scenarios.
const DEFAULT_PRESET = PRESETS[2]; // daily

// Build the 5-step path proportional to total minutes (mirrors home.html / practice.html).
function buildSteps(totalMinutes: number): PlanStep[] {
  // base ratios at 30 min: 5 / 8 / 5 / 10 / 2
  const ratios = [
    { name: '听力热身', r: 5 / 30 },
    { name: '跟读模仿', r: 8 / 30 },
    { name: '句型替换', r: 5 / 30 },
    { name: 'AI 场景对话', r: 10 / 30 },
    { name: '今日反馈', r: 2 / 30 },
  ];
  const raw = ratios.map((s) => ({ name: s.name, minutes: Math.max(1, Math.round(s.r * totalMinutes)) }));
  // Reconcile rounding drift onto the conversation step.
  const sum = raw.reduce((a, s) => a + s.minutes, 0);
  raw[3].minutes += totalMinutes - sum;
  if (raw[3].minutes < 1) raw[3].minutes = 1;
  return raw;
}

// Map onboarding interest labels (zh) to preset scenario ids.
const INTEREST_TO_SCENARIO: Record<string, string> = {
  工作沟通: 'work',
  商务社交: 'business',
  商务英语: 'business',
  日常生活: 'daily',
  日常: 'daily',
  旅行: 'travel',
  面试: 'interview',
  学术: 'academic',
  'AI / 科技': 'work',
};

function dayIndex(dateStr: string): number {
  // Stable per-day rotation seed.
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) >>> 0;
  return h;
}

export function generateDailyPlan(opts: {
  interests: string[];
  scenarios: string[]; // business_scenarios
  totalMinutes: number;
  level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
  date: string; // YYYY-MM-DD
}): DailyPlan {
  const wantedIds = new Set<string>();
  for (const label of [...(opts.interests || []), ...(opts.scenarios || [])]) {
    const id = INTEREST_TO_SCENARIO[label];
    if (id) wantedIds.add(id);
  }
  const candidates = PRESETS.filter((p) => wantedIds.has(p.scenario));
  const pool = candidates.length ? candidates : [DEFAULT_PRESET];
  const picked = pool[dayIndex(opts.date) % pool.length];

  return {
    theme: picked.theme,
    scenario: picked.scenario,
    level: opts.level ?? 'B1',
    goal: picked.goal,
    totalMinutes: opts.totalMinutes,
    steps: buildSteps(opts.totalMinutes),
  };
}
