import { useRef } from 'react';

// ---- Typewriter bubble ---------------------------------------------------
// 视觉打字机(大刘 §2.2 方案 B):文字立刻 append 到 DOM,只给"新增字符"
// CSS stagger fade-in。零延迟,不缓冲流。新增 > 30 字符时降级为整段淡入,
// 避免长 chunk 走 stagger 太慢(大刘 §2.4)。
//
// AI/User 两侧都用同一组件——节奏跟各自的流(Gemini Live outputTranscription
// / inputTranscription)走,组件不知道也不关心。

type Role = 'ai' | 'user';

// role 保留在签名里以便将来按 AI/User 调速率,目前两侧同节奏(故 _role)。
export function TypewriterBubble({ text, role: _role }: { text: string; role: Role }) {
  const prevLen = useRef(0);
  const newStart = prevLen.current;
  prevLen.current = text.length;

  // 文本被外部覆盖性缩短(比如 ASR 修订,虽然当前 Gemini Live 是纯 append,
  // 但保险一下):新起点 > 当前长度时退化为全文字静态显示。
  const safeStart = newStart > text.length ? text.length : newStart;
  const stable = text.slice(0, safeStart);
  const fresh = text.slice(safeStart);

  if (fresh.length === 0) {
    return <div className="m-bubble">{stable}</div>;
  }

  // 长 chunk 降级:>30 字符整段淡入,不逐字
  if (fresh.length > 30) {
    return (
      <div className="m-bubble">
        {stable}
        <span className="tw-chunk">{fresh}</span>
      </div>
    );
  }

  // 短 chunk:逐字 stagger fade-in。中文一字 = 一 token,英文按字符。
  // 不强行区分语种,12ms 间隔在两种语言下都够顺。
  return (
    <div className="m-bubble">
      {stable}
      {Array.from(fresh).map((ch, i) => (
        <span
          key={safeStart + i}
          className="tw-char"
          style={{ animationDelay: `${i * 12}ms` }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

// ---- Conversation avatar (48px SVG) --------------------------------------
// Mia §0-§8 钉死规格。复用 .cv-orb 选择器(§1 "选择器复用"),把内部从
// 18px 圆 div 换成 48px SVG。状态切换由 React 控制 .st-* class
// (在 .cv-status 上,沿用既有),所有动画在 CSS keyframes 里。
// breathing 参数仅供旧 .cv-orb.breath 兼容回退(默认不传则不加 breath)。

type AvatarStatus = 'idle' | 'ai' | 'user' | 'analyzing' | 'error';

const AVATAR_LABEL: Record<AvatarStatus, string> = {
  idle: '等待中 · Avatar idle, waiting',
  user: '正在听你说话 · Listening to you speak',
  analyzing: '正在思考 · Thinking',
  ai: '正在回答 · Speaking',
  error: '连接出错 · Connection error',
};

export function ConversationAvatar({ status }: { status: AvatarStatus }) {
  return (
    <svg
      className="cv-orb"
      role="img"
      aria-label={AVATAR_LABEL[status]}
      viewBox="0 0 48 48"
      focusable="false"
    >
      <circle className="av-body" cx="24" cy="24" r="20" />
      <ellipse className="av-eye av-eye-l" cx="18" cy="22" rx="2.5" ry="3.5" />
      <ellipse className="av-eye av-eye-r" cx="30" cy="22" rx="2.5" ry="3.5" />
      {/* analyzing 态下 CSS 控制思考点显隐;always 渲染省得 React diff */}
      <circle className="av-think-dot av-think-1" cx="18" cy="4" r="1.8" />
      <circle className="av-think-dot av-think-2" cx="24" cy="4" r="1.8" />
      <circle className="av-think-dot av-think-3" cx="30" cy="4" r="1.8" />
    </svg>
  );
}
