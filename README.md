# EchoSpeak AI

> 每天 20 分钟,把耳朵和嘴巴练出来 —— 面向中文母语用户的 AI 英语听说训练 Mac 桌面应用。
> *A daily English listening & speaking trainer for Chinese speakers, powered by Google Gemini. macOS desktop (Electron).*

EchoSpeak AI 不是"学英语软件",是一台**听说训练器**:听说优先(85–90%),读写只做辅助。打开 10 秒内就能开练,系统替你安排今天练什么,AI 陪你开口、当场纠错、记录进步。

## ✨ 核心功能

- **🎙️ 实时 AI 语音对话** — 对着麦克风说英语,AI 教练实时语音回应、追问、温和纠错(Gemini Live)。
- **🗣️ 跟读 + 发音评分** — 听一句、跟读、录音,AI 给 5 维评分(发音 / 流畅度 / 完整度 / 自然度 / 表达稳定度)并指出读错/漏读的词。
- **📅 今日训练** — 按你选的兴趣场景生成每日训练计划,一个按钮开始。
- **📊 进步报告** — 每日开口时长、跟读句数、高频错误,数据可见。
- **🔁 每日复习** — 把你读不好的句子按出错频次捞出来重练,练熟自动出队。
- **🔒 隐私优先** — 数据默认全本地;API Key 只在主进程持有,绝不暴露给界面层;录音可设不保存。

## 🧱 技术栈

Electron · Vite · React · TypeScript · [@google/genai](https://www.npmjs.com/package/@google/genai)(Gemini Live + 多模态评分 + TTS)· 本地 JSON 存储(可选切换 Supabase Postgres)。

## 🚀 快速开始

### 前置要求

- Node.js 18+
- 一把 **Google Gemini API Key**(免费额度足够试用)——到 [Google AI Studio](https://aistudio.google.com/apikey) 创建。

### 安装运行

```bash
cd app
npm install
npm run dev        # 启动 Electron 窗口
```

首次启动会进入**首次设置**(选目标 / 每日时长 / 兴趣场景),完成后落到首页。

### 配置 API Key(三选一,按优先级)

1. **应用内设置页**(推荐):打开 App → 设置 → AI 服务 → 填入你的 Gemini Key。存在本机 Electron userData,优先级最高。
2. **环境变量**:`GEMINI_API_KEY=your_key npm run dev`
3. **项目根 `.env` 文件**(开发用,已被 `.gitignore` 排除):

   ```
   GEMINI_API_KEY=your_key_here
   ```

> Key 只在 **Main 进程**读取,通过 IPC 安全桥与界面隔离,**永不暴露给 Renderer**。

## 💾 数据存储

默认用**本地 JSON 文件**(零配置,无 native 编译):

```
~/Library/Application Support/echospeak-ai/echospeak-data.json
```

镜像 5 张表:`user_profile` / `practice_session` / `utterance` / `mistake` / `sentence_pattern`。原子写入,损坏自动备份重建。

**可选:切换 Supabase 云端**(多设备同步地基)——在 Supabase 项目里跑 [`supabase-schema.sql`](./supabase-schema.sql) 建表,然后设置页 → 数据后端 → 填 URL + anon key → 重启。数据访问全在 Main 进程,Renderer 经 IPC,不直连 DB。

## 📦 打包成 Mac 应用

```bash
npm run pack    # 出 .app(release/mac-arm64/)
npm run dist    # 出 .dmg + .zip(release/)
```

> 产出为**未签名**包(本机右键 → 打开即可运行)。正式分发给他人需 Apple Developer 账号做签名 + 公证。

## 🧪 测试

```bash
npm run typecheck      # TS 类型检查
npm run build          # 生产构建
npm run test:storage   # 本地持久化冒烟
npm run test:scoring   # 发音评分引擎往返(需 key)
npm run test:roundtrip # 实时对话引擎往返(需 key)
npm run test:report    # 进步页聚合 + 复习选取
npm run test:reminder  # 每日提醒排程
npm run test:noscroll  # 7 页一屏不溢出
```

## ⚠️ 已知限制

- 真人麦克风端到端、macOS 通知到点触发、Supabase 真实例读写需在真实环境验证。
- 每日训练内容目前用本地预置题库;Gemini 动态生成为后续增强。
- 打包未签名/未公证(分发需 Apple 账号)。
- 目前仅 arm64(Apple Silicon)包;Intel Mac 需自行构建 x64。
- 录音音频**评分后立即丢弃,不落盘**(设置页"7 天/永久保存"选项当前是占位,显示"即将推出")。如有"回放历史录音"需求请提 issue。

## 📄 License

[MIT](./LICENSE) © 2026 lukeliu95

---

*Built with [Google Gemini](https://ai.google.dev/). 产品理念:听说优先,每天可执行,AI 让你多说,不追求完美英语,先追求能表达。*
