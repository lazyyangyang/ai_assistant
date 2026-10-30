# AI Career 平台 — 项目架构说明

## 一、项目概览

AI 驱动的求职辅助平台，采用**前后端分离**架构。通过集成大语言模型，构建了 **JD 智能解析**、**简历深度诊断与重写**、**沉浸式 Mock Interview** 三大核心 Agent，为求职者提供全链路智能辅助。

```
┌────────────────────────────────────────────────────────────┐
│                       用户浏览器                            │
│  React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui  │
└──────────────────────┬─────────────────────────────────────┘
                       │  HTTP / SSE (Vite dev proxy → /api)
                       ▼
┌────────────────────────────────────────────────────────────┐
│                  FastAPI (Python 后端)                      │
│  JWT 认证 │ SSE 流式端点 │ LangChain Agent │ SQLAlchemy    │
└──────────────────────┬─────────────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
   ┌──────────────┐       ┌──────────────┐
   │   Database   │       │   LLM API    │
   │ SQLite 当前 │       │ 可配置模型服务 │
   │ PostgreSQL   │       │ (OpenAI 兼容) │
   │   (预留)     │       │              │
   └──────────────┘       └──────────────┘
```

---

## 二、目录结构

```
ai-career/
├── architecture.md              ← 本文件
├── .gitignore
│
├── frontend/                    ← 前端（React + TypeScript + Vite）
│   ├── package.json
│   ├── vite.config.ts           ← Vite 配置：Tailwind 插件 + /api 代理
│   ├── tsconfig.json            ← TypeScript 配置（@/ 路径别名）
│   ├── tsconfig.app.json
│   ├── components.json          ← shadcn/ui 配置
│   │
│   └── src/
│       ├── main.tsx             ← 入口：BrowserRouter + AuthProvider
│       ├── App.tsx              ← 路由表（公开页 + 受保护页）
│       ├── index.css            ← Tailwind v4 + shadcn 设计 token
│       │
│       ├── layouts/
│       │   └── RootLayout.tsx   ← 全局布局：顶栏导航 + 登录状态
│       │
│       ├── pages/
│       │   ├── HomePage.tsx     ← 首页（功能入口卡片）
│       │   ├── LoginPage.tsx    ← 登录页
│       │   ├── RegisterPage.tsx ← 注册页
│       │   ├── JDPage.tsx       ← JD 智能解析（对话界面）
│       │   ├── ResumePage.tsx   ← 简历诊断与重写（对话界面）
│       │   └── InterviewPage.tsx← 模拟面试（对话界面）
│       │
│       ├── components/
│       │   ├── ProtectedRoute.tsx  ← 路由守卫（未登录 → /login）
│       │   ├── chat/
│       │   │   ├── ChatPanel.tsx       ← 完整对话面板
│       │   │   ├── ChatMessageBubble.tsx ← 消息气泡（Markdown 渲染）
│       │   │   ├── ChatInput.tsx       ← 输入框 + 发送按钮
│       │   │   └── index.ts           ← barrel export
│       │   └── ui/              ← shadcn/ui 组件（button, input, card…）
│       │
│       ├── hooks/
│       │   └── useStreamChat.ts ← SSE 流式消费自定义 Hook
│       │
│       ├── contexts/
│       │   └── AuthContext.tsx  ← 全局认证状态（login/register/logout）
│       │
│       ├── lib/
│       │   ├── api.ts           ← 业务接口封装（通过 http.ts 的 Axios 实例）
│       │   ├── http.ts          ← Fetch 适配器、认证拦截与请求重试
│       │   ├── authSession.ts   ← 页内认证状态机、内存 Token 与预刷新
│       │   ├── sessionRecovery.ts ← sessionStorage sid 与重载恢复
│       │   ├── businessEvents.ts ← 同账号跨页简历失效通知
│       │   └── utils.ts         ← cn() 工具函数
│       │
│       └── types/
│           └── chat.ts          ← ChatMessage 类型定义
│
└── backend/                     ← 后端（FastAPI + LangChain）
    ├── requirements.txt         ← Python 依赖清单
    ├── .env                     ← 环境变量（不入 git）
    ├── .env.example             ← 环境变量模板
    ├── alembic.ini              ← Alembic 迁移配置
    ├── ai_career.db             ← SQLite 开发数据库（不入 git）
    │
    ├── alembic/
    │   ├── env.py               ← 异步迁移环境
    │   └── versions/            ← 迁移版本脚本
    │
    └── app/
        ├── __init__.py
        ├── main.py              ← FastAPI 入口：中间件 + 路由注册
        ├── config.py            ← pydantic-settings 配置类
        ├── database.py          ← 异步数据库引擎 & Session
        ├── auth.py              ← 密码哈希（bcrypt）& JWT 工具
        ├── deps.py              ← FastAPI 依赖注入（get_current_user）
        ├── schemas.py           ← Pydantic 请求/响应模型
        ├── agents.py            ← LangChain 流式 Agent 服务
        ├── prompts.py           ← 三个 Agent 的 System Prompt
        │
        ├── models/              ← SQLAlchemy ORM 模型
        │   ├── __init__.py      ← 统一导出
        │   ├── base.py          ← 声明式基类（id, created_at, updated_at）
        │   ├── user.py          ← 用户表
        │   ├── resume.py        ← 多版本简历表
        │   ├── auth_session.py  ← 独立登录会话表（Refresh Token 哈希）
        │   └── chat.py          ← 对话会话 & 消息表
        │
        └── routers/             ← API 路由
            ├── __init__.py
            ├── auth.py          ← POST register / login, GET me
            └── chat.py          ← POST /api/chat/stream（SSE）
```

---

## 三、技术栈

本节于 2026-10-28 按当前代码核对。前端版本为依赖清单声明的主/次版本，完整范围见 [README 技术栈](README.md#技术栈) 与 `frontend/package.json`；后端约束以 `backend/requirements.txt` 为准，不代表实际安装版本或运行验证结果。

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19 | UI 框架 |
| TypeScript | 5.9 | 类型安全 |
| Vite | 8 | 构建工具 + 开发服务器 |
| React Router | 7 | SPA 路由 |
| Tailwind CSS | 4 | 原子化样式 |
| shadcn / Base UI | 4 / 1 | 本地 UI 组件与交互原语（当前基于 Base UI） |
| Axios | 1 | Fetch 适配器，统一认证、上传、Blob 与 SSE 流请求 |
| TanStack React Virtual | 3 | 聊天消息列表虚拟化 |
| react-markdown | — | AI 回复 Markdown 渲染 |
| rehype-highlight | — | 代码块语法高亮 |
| lucide-react | — | 图标库 |

状态使用 React Hooks / Context 与页内业务存储；BroadcastChannel 仅传递同账号简历失效通知。包管理使用 pnpm，验证工具为 ESLint、Vitest、Testing Library 与 Playwright。

### 后端

| 技术 | 用途 |
|------|------|
| FastAPI | Web 框架（异步、高性能） |
| Uvicorn | ASGI 服务 |
| Pydantic | 请求与响应数据校验 |
| LangChain + ChatOpenAI | 大模型调用 & Agent 编排 |
| SSE-Starlette | Server-Sent Events 流式推送 |
| SQLAlchemy 2.0 (async) | ORM（异步模式） |
| Alembic | 数据库迁移 |
| aiosqlite / asyncpg | SQLite 当前默认驱动 / PostgreSQL 预留切换驱动 |
| passlib (bcrypt) | 密码哈希 |
| python-jose | JWT Token 签发与验证 |
| pydantic-settings | 配置管理（读取 .env） |
| pdfplumber / python-docx | PDF / DOCX 简历文本提取，另支持 TXT |
| HTTPX / python-multipart | STT / TTS HTTP 调用与文件上传解析 |

后端使用项目 `.venv`，测试使用 pytest / pytest-asyncio / HTTPX。语音服务通过兼容接口调用；非 WAV 音频转换依赖 FFmpeg。

---

## 四、数据库模型（ER 关系）

当前阶段保留 SQLite，默认 URL 为 `sqlite+aiosqlite:///./ai_career.db`；从 `backend` 启动时对应 `backend/ai_career.db`。SQLAlchemy 使用异步引擎和 `AsyncSession`，Alembic 管理迁移。可通过 `DATABASE_URL` 配置 PostgreSQL / asyncpg，但切换、部署与并发行为须另行验证，当前不视为已在生产使用 PostgreSQL。

下图与表格描述 ORM 模型，未检查日常数据库迁移状态。SQLite 的登录会话配额和简历版本写入使用短写事务保护；PostgreSQL 的用户行锁分支仍需独立联调验证。

```
┌─────────┐       ┌───────────┐       ┌───────────────┐       ┌──────────────┐
│  users  │ 1───N │  resumes  │       │ chat_sessions │ 1───N │chat_messages │
│─────────│       │───────────│       │───────────────│       │──────────────│
│ id (PK) │       │ id (PK)   │       │ id (PK)       │       │ id (PK)      │
│ username│       │ user_id   │◄──┐   │ user_id       │       │ session_id   │
│ email   │       │ version   │   │   │ agent_type    │       │ role         │
│ hashed_ │       │ title     │   │   │ title         │       │ content      │
│ password│       │ content   │   └───│ resume_id     │       │ created_at   │
│ created │       │ file_url  │       │ jd_content    │       └──────────────┘
│ updated │       │ is_active │       │ status        │
└─────────┘       │ created   │       │ feedback      │
     │            │ updated   │       │ created       │
     │            └───────────┘       │ updated       │
     │  1───N                         └───────────────┘
     └────────────────────────────────────────┘
```

### 表说明

认证关系为 `users.id → auth_sessions.user_id`（一对多）；下方表格补充上图未展示的登录会话。`auth_sessions` 与 `chat_sessions` 分别服务于登录和业务对话，不可混用。

| 表 | 说明 |
|---|------|
| **users** | 用户主体，username/email 唯一索引 |
| **auth_sessions** | 登录会话，关联用户，保存唯一 Refresh Token 哈希、过期时间及公共时间字段 |
| **resumes** | 多版本简历资产，同一用户可维护多个版本（version 字段） |
| **chat_sessions** | 对话会话，关联 agent_type（jd/resume/interview）、可选关联简历 |
| **chat_messages** | 每轮对话消息（role: user/assistant），按时间排序 |

---

## 五、API 端点

### 认证

| 方法 | 路径 | 说明 | 需要登录 |
|------|------|------|---------|
| POST | `/api/auth/register` | 创建账号并返回用户信息，不创建登录会话 | 否 |
| POST | `/api/auth/login` | 登录 → JWT、认证 sid 与定向 Refresh Cookie | 否 |
| POST | `/api/auth/sessions/{sid}/refresh` | 刷新指定登录会话 | 校验定向 Cookie |
| POST | `/api/auth/sessions/{sid}/logout` | 撤销指定登录会话 | 校验定向 Cookie |
| GET | `/api/auth/me` | 获取当前用户信息 | 是 |

### 对话

| 方法 | 路径 | 说明 | 需要登录 |
|------|------|------|---------|
| POST | `/api/chat/stream` | SSE 流式对话（agent_type + messages） | 是 |

认证依赖校验 JWT、登录会话及数据归属。旧 `/api/auth/refresh`、`/api/auth/logout` 返回 410。更多业务接口见 [README API 概览](README.md#api-概览)。

### 健康检查

| 方法 | 路径 |
|------|------|
| GET | `/api/health` |

---

## 六、核心数据流

### 1. 流式对话（SSE）

```
用户输入
  │
  ▼
前端 useStreamChat Hook
  │  Axios（Fetch 适配器）POST /api/chat/stream，携带 Bearer Token
  │  body: { agent_type, messages[] }
  ▼
FastAPI chat router
  │  调用 agents.stream_agent_response()
  ▼
LangChain ChatOpenAI.astream()
  │  system prompt (prompts.py) + 历史消息
  │  连接配置的模型服务（OpenAI 兼容接口）
  ▼
逐 token 返回 SSE:
  event: token  data: {"content": "你"}
  event: token  data: {"content": "好"}
  event: done   data: [DONE]
  │
  ▼
前端实时追加到消息气泡，Markdown 渲染
```

### 2. 用户认证

```
注册成功 → 用户主动登录
  │  POST /api/auth/login
  ▼
后端验证 → 创建 auth_sessions → 签发 JWT 与定向 HttpOnly Cookie
  │  JWT 默认 15 分钟，可由配置覆盖
  │
  ▼
前端 Token 仅存页内内存，认证 sid 存入 sessionStorage
  │  后续请求自动带 Authorization: Bearer <token>
  ▼
受保护路由（ProtectedRoute）
  │  恢复中 → 等待；未认证 → 跳转 /login
  │  reload → sid + 定向 Cookie 刷新 → GET /api/auth/me 恢复
```

普通新页面独立登录；退出或身份切换清理页内业务状态。数据库仅存 Refresh Token 哈希，浏览器 Cookie 保存原始 Refresh Token；跨页通知不携带凭证。完整边界见 [README 鉴权](README.md#鉴权)。

---

## 七、三个 AI Agent

| Agent | 路由参数 | 职责 | Prompt 风格 |
|-------|---------|------|------------|
| **JD Parser** | `agent_type=jd` | 解析岗位描述，提取技能、职责、硬性要求 | 结构化输出 |
| **Resume Advisor** | `agent_type=resume` | 诊断简历短板，STAR 法则重写建议 | Few-Shot 诊断 |
| **Mock Interviewer** | `agent_type=interview` | 沉浸式模拟面试，追问式多轮对话 | Role-Playing |

---

## 八、本地开发

```bash
# 后端
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # Windows
pip install -r requirements.txt
cp .env.example .env                  # 编辑填入 API Key
alembic upgrade head                  # 创建数据库表
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm install
npm run dev                           # http://localhost:5173
```

Vite 开发服务器已配置 `/api` 代理到 `http://127.0.0.1:8000`，前后端联调无需额外配置。

---

## 九、后续规划

对话持久化、流式请求鉴权、简历上传与版本管理、语音接口已有实现；实际验收范围以 `docs/verification/` 中的记录为准。

- 当前继续使用 SQLite，优先完成 AI 业务联调。
- PostgreSQL、分库分表与分布式部署后续另行评估、设计和验证。
