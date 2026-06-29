// Preset shadowing sentence bank, keyed by scenario id (matches dailyPlan PRESETS).
// Wave 2 ships these for stability; a later wave can swap in Gemini-generated sets.
// Each sentence has the English target + a Chinese gloss (shown under the target).

export interface ShadowSentence {
  en: string;
  zh: string;
}

const BANK: Record<string, ShadowSentence[]> = {
  work: [
    { en: 'Actually, the project is on track, but we need one more week for testing.', zh: '其实项目进展顺利，不过测试还需要再加一周。' },
    { en: "Let me quickly walk you through what we shipped this sprint.", zh: '我快速带你过一遍这个冲刺我们交付了什么。' },
    { en: "I think we should double-check the numbers before the meeting.", zh: '我觉得开会前我们应该再核对一下数据。' },
    { en: "Can you give me a quick update on where things stand?", zh: '你能简单说一下目前进展到哪一步了吗？' },
    { en: "No worries, I'll follow up with the team and get back to you.", zh: '别担心，我会去跟进团队，然后回复你。' },
  ],
  business: [
    { en: "It's great to finally meet you in person.", zh: '很高兴终于能当面见到你。' },
    { en: "Thanks for taking the time to join us today.", zh: '感谢你今天抽时间来参加。' },
    { en: "I'd love to hear more about what your team is working on.", zh: '我很想多了解一下你们团队在做什么。' },
    { en: "Let's set up a quick call next week to go deeper.", zh: '下周我们约个简短的电话，深入聊聊吧。' },
    { en: "That's a really interesting point — could you say more?", zh: '这个点很有意思，你能再多说一些吗？' },
  ],
  daily: [
    { en: "Could I get a medium latte with oat milk, please?", zh: '麻烦给我一杯中杯燕麦拿铁，好吗？' },
    { en: "Sorry, could you say that one more time?", zh: '不好意思，你能再说一遍吗？' },
    { en: "I'm just looking around, thanks for your help.", zh: '我就随便看看，谢谢你的帮忙。' },
    { en: "Do you know if there's a pharmacy nearby?", zh: '你知道附近有药店吗？' },
    { en: "That sounds great — let's do it.", zh: '听起来不错，就这么定了。' },
  ],
  travel: [
    { en: "Excuse me, how do I get to gate twenty-two?", zh: '打扰一下，我怎么去 22 号登机口？' },
    { en: "Is this the right line for the airport shuttle?", zh: '请问坐机场摆渡车是在这一排排队吗？' },
    { en: "I'd like to check in two bags, please.", zh: '我想托运两件行李，谢谢。' },
    { en: "Could you recommend a good place to eat around here?", zh: '你能推荐一下这附近好吃的地方吗？' },
    { en: "My flight was delayed, so I missed my connection.", zh: '我的航班延误了，所以错过了转机。' },
  ],
  interview: [
    { en: "In my last role, I led a small team of three engineers.", zh: '在上一份工作里，我带了一个三人的小工程团队。' },
    { en: "One project I'm really proud of is our payments redesign.", zh: '我特别自豪的一个项目是我们的支付系统改版。' },
    { en: "I tend to stay calm and focus on solving the problem.", zh: '我通常会保持冷静，专注于解决问题。' },
    { en: "I'm looking for a role where I can keep growing.", zh: '我在找一个能让我持续成长的岗位。' },
    { en: "Thank you, I really enjoyed our conversation today.", zh: '谢谢你，我很享受今天的交流。' },
  ],
  academic: [
    { en: "Sorry, could you clarify what you mean by that term?", zh: '抱歉，你能解释一下那个术语是什么意思吗？' },
    { en: "I'd like to build on the point you just made.", zh: '我想接着你刚才提的那个观点继续说。' },
    { en: "What evidence supports that conclusion?", zh: '有什么证据支持这个结论？' },
    { en: "Let me summarize the main findings so far.", zh: '我来总结一下目前的主要发现。' },
    { en: "That's an interesting hypothesis worth testing.", zh: '这是个值得验证的有趣假设。' },
  ],
};

const DEFAULT_SCENARIO = 'daily';

export function getShadowSentences(scenario: string): ShadowSentence[] {
  return BANK[scenario] ?? BANK[DEFAULT_SCENARIO];
}
