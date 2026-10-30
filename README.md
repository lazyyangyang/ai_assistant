# AI Career

AI Career 是一个面向求职场景的 AI 辅助平台，提供从岗位解析、简历优化到模拟面试的完整流程。

前端采用 React + TypeScript，后端采用 FastAPI + LangChain，并通过 SSE 提供流式对话体验。

## 核心功能

- JD 智能解析：提取岗位技能、职责和硬性要求
- 简历诊断与多版本管理：支持上传 PDF/TXT/DOCX，生成并管理版本
- Mock Interview：多轮模拟问答，支持面试结束后生成反馈
- 语音能力：支持 STT（语音转文字）与 TTS（文字转语音）
- 历史会话：按用户维度持久化聊天会话与消息

## 技术栈

以下说明于 2026-10-28 按当前代码及依赖清单核对；版本为清单声明范围，不代表本机实际安装版本或运行验收结果。

### 前端

| 技术 | 声明版本 | 用途 |
|---|---|---|
| React / React DOM | `^19.2.4` | 页面渲染，配合 Hooks / Context 管理状态 |
| TypeScript | `~5.9.3` | 类型检查 |
| Vite | `^8.0.1` | 构建、开发服务器与 `/api` 代理 |
| Tailwind CSS | `^4.2.2` | 样式，通过 Vite 插件集成 |
| React Router | `^7.13.2` | 页面路由与登录访问控制 |
| Axios | `^1.20.0` | 使用 Fetch 适配器，处理认证、JSON、上传、Blob 和 SSE 流 |
| shadcn / Base UI | `^4.1.1` / `^1.3.0` | 本地 UI 组件与底层交互组件（当前为 Base UI） |
| react-markdown / remark-gfm / rehype-highlight | `^10.1.0` / `^4.0.1` / `^7.0.2` | Markdown、GFM 与代码高亮 |
| TanStack React Virtual | `^3.13.23` | 聊天消息列表虚拟化 |
| Lucide React | `^1.7.0` | 图标 |

包管理器声明为 `pnpm@11.19.0`，维护 `pnpm-lock.yaml`。验证工具包括 TypeScript、ESLint、Vitest、Testing Library 和 Playwright。依赖以 [package.json](frontend/package.json) 为准。

### 后端

| 技术 | 声明版本 / 约束 | 用途 |
|---|---|---|
| FastAPI / Uvicorn | `>=0.115.0` / `>=0.32.0` | 异步 API 与 ASGI 服务 |
| LangChain / langchain-openai | 均为 `>=0.3.0` | 通过 ChatOpenAI 调用可配置的 OpenAI 兼容模型接口 |
| Pydantic / pydantic-settings | `>=2.9.0` / `>=2.0.0` | 请求响应校验与环境配置 |
| sse-starlette | `>=2.0.0` | SSE 流式响应 |
| SQLAlchemy Async / Alembic | `>=2.0.0` / `>=1.14.0` | 异步 ORM、会话与数据库迁移 |
| python-jose / passlib[bcrypt] | 未锁定版本，另约束 `bcrypt<5` | JWT 签发验证与密码哈希 |
| pdfplumber / python-docx | `>=0.11.0` / `>=1.1.2` | PDF / DOCX 简历文本提取，另支持 TXT |
| HTTPX / python-multipart | HTTPX 未锁定版本 / `>=0.0.20` | 语音服务 HTTP 请求与文件上传解析 |

后端使用项目内 `.venv`，依赖见 [requirements.txt](backend/requirements.txt)；测试使用 pytest、pytest-asyncio 和 HTTPX。STT / TTS 通过兼容接口调用，非 WAV 音频转换另依赖 FFmpeg。

### 数据库与数据存储

- **当前阶段保留 SQLite**，默认连接为 `sqlite+aiosqlite:///./ai_career.db`，驱动为 `aiosqlite>=0.20.0`。从 `backend` 目录启动时，对应 `backend/ai_career.db`；实际连接可由 `DATABASE_URL` 覆盖。
- **PostgreSQL 为预留切换方案**：依赖已包含 `asyncpg>=0.30.0`，连接形式为 `postgresql+asyncpg://user:password@host/dbname`。目前不将其描述为已部署的生产数据库；迁移和并发行为仍需单独验证。
- 数据访问使用 SQLAlchemy `AsyncSession`，表结构变更通过 Alembic 管理。SQLite 登录会话配额和简历版本写入使用短写事务保护并发。

| ORM 表 | 存储内容 |
|---|---|
| `users` | 用户资料、唯一用户名/邮箱与密码哈希 |
| `auth_sessions` | 独立登录会话、用户关联、Refresh Token 哈希与过期时间 |
| `resumes` | 用户简历正文、版本、标题与当前启用标记 |
| `chat_sessions` | 聊天类型、岗位内容、可选简历关联与面试反馈 |
| `chat_messages` | 关联聊天会话的角色与消息正文 |

上述为 [ORM 模型](backend/app/models) 定义，未检查本地数据库是否已应用全部迁移。登录会话与聊天会话相互独立；Access Token 仅在本页内存，认证 sid 存在 sessionStorage，Refresh Token 存在 HttpOnly Cookie，数据库仅保存其哈希。JD 复用结果在单身份内存中；跨标签页 BroadcastChannel 仅通知简历数据失效。

## 项目结构

```text
ai-career/
├── frontend/                 # React + TypeScript + Vite
├── backend/                  # FastAPI + LangChain
├── architecture.md           # 架构说明
└── TODO.md                   # 任务清单
```

## 快速开始（本地运行）

> 下面命令以 Windows PowerShell 为例。

### 1) 克隆仓库

```bash
git clone <你的仓库地址>
cd ai-career
```

### 2) 启动后端

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

后端默认地址：`http://127.0.0.1:8000`

### 3) 启动前端

```bash
cd frontend
pnpm install
pnpm run dev
```

前端默认地址：`http://localhost:5173`

开发环境下已配置 `/api` 代理到 `http://127.0.0.1:8000`。

## 环境变量说明

后端使用 `backend/.env` 读取配置，至少需要设置：

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://your-openai-compatible-base-url
OPENAI_MODEL=your_model_name

JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRE_MINUTES=15
REFRESH_EXPIRE_DAYS=7
REFRESH_COOKIE_SECURE=false
AUTH_ALLOWED_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173"]
DATABASE_URL=sqlite+aiosqlite:///./ai_career.db
```

已有 `.env` 的取值优先于默认值；例如保留 `JWT_EXPIRE_MINUTES=1440` 时 Access Token 仍为 24 小时。HTTPS 部署需设置 `REFRESH_COOKIE_SECURE=true`，并将实际前端 Origin 加入允许列表。

语音能力可选配置：

```env
FFMPEG_BIN=C:\path\to\ffmpeg.exe
STT_MODEL=whisper-1
TTS_MODEL=tts-1
```

## API 概览

### 鉴权

- `POST /api/auth/register` 注册：返回用户信息，不创建登录会话；成功后前端跳转登录页
- `POST /api/auth/login` 创建独立会话，返回 Access Token 和认证 `session_id`
- `POST /api/auth/sessions/{sid}/refresh` 用该会话 Cookie 定向刷新
- `POST /api/auth/sessions/{sid}/logout` 定向撤销，重复退出为 204
- `GET /api/auth/me` 获取当前用户
- 旧 `/api/auth/refresh`、`/api/auth/logout` 返回 410，提示重新加载并登录

Access Token 和用户资料只在当前文档内存中，Token 不写入 localStorage 或 sessionStorage；仅认证 sid 保存于 sessionStorage 的 `ai-career-session-id-v1`。整页刷新（Navigation Timing 类型为 reload）用该 sid 的 HttpOnly Cookie 换取新 Token，再 GET /auth/me 恢复身份及当前路由。普通新页面清除可能从 opener 复制的 sid，仍需独立登录；SPA 路由跳转保持登录。恢复中禁止业务请求，401 清除记录，网络或服务错误可重试或放弃恢复；存储不可用时仍可在本页登录，但不能保证刷新恢复。浏览器菜单复制、关闭后恢复等生命周期不作无条件保证，详见 [恢复机制记录](docs/verification/session-recovery-2026-10-28.md)。Refresh Cookie 名称为 `ai_career_tab_refresh`，使用 `HttpOnly; SameSite=Strict; Path=/api/auth/sessions/{sid}/`，固定有效期，不续期、不旋转。Cookie Path 不是同源脚本安全边界，后端同时验证 sid、哈希、有效期和用户。JWT 的 sid 与聊天 session_id 不同。

认证队列和刷新 Promise 仅在本页共享，没有凭证广播或 Web Locks。提前 60 秒刷新，网络失败采用 5–60 秒退避。业务请求携带身份快照；401 最多定向刷新并重试一次，超时不自动重发写请求，已消费的 SSE 不重放。退出开始取消本页业务请求；退出拒绝或结果未知时保留草稿并暂停操作，允许重试退出或强制校验后继续。BFCache 存活文档恢复时校验原会话；实际设备覆盖见验收记录。

同账号标签页通过独立 BroadcastChannel 只通知简历失效，统一列表 Provider 重新读取服务端；不共享凭证、选择、聊天或 JD。JD 只保存在当前会话内存，旧 localStorage 数据保留但不读取。频道失败显示提示，不改变已成功写入的结果。

认证写接口要求 `X-CSRF-Protection: 1` 和允许的 Origin；所有认证响应禁止缓存。HTTPS 部署须设置 `REFRESH_COOKIE_SECURE=true`。`AUTH_MAX_ACTIVE_SESSIONS_PER_USER` 默认 20，计数和插入在短事务中完成，满额 409、锁忙 503，不挤掉有效会话。

已有环境仍须具备 auth_sessions 表；本次定向协议不新增表字段或迁移。部署时前后端须同时升级，旧客户端不能搭配新协议使用。本轮没有迁移或清理日常数据库。维护命令从 backend 执行 `python scripts/cleanup_expired_auth_sessions.py` 默认只预览目标与数量，仅 `--execute` 删除过期记录；请使用项目 `.venv` Python 并先确认目标。

自动化使用 `frontend/playwright.config.ts` 与 `backend/tests/e2e_app.py`，每轮唯一端口、SQLite 文件和测试账号，外部模型/语音为夹具，认证及简历读写是真实接口。浏览器下载后执行 `pnpm exec playwright test`；本机 Chrome 可通过 `E2E_CHROMIUM_CHANNEL=chrome` 选择。测试结果目录不纳入 Git。详见 [本轮实施与验收记录](docs/verification/tab-session-isolation-2026-10-27.md)，未验证设备不等于通过。

### 对话与会话

- `POST /api/chat/stream` 流式对话（SSE）
- `GET /api/chat/sessions` 获取历史会话
- `GET /api/chat/sessions/{session_id}/messages` 获取会话消息

### 简历管理

- `POST /api/resumes/upload` 上传简历文件
- `POST /api/resumes` 新建简历版本
- `GET /api/resumes` 获取简历列表
- `PATCH /api/resumes/{resume_id}` 更新简历
- `DELETE /api/resumes/{resume_id}` 删除简历

### 语音接口

- `POST /api/stt/transcribe` 语音转文字
- `POST /api/tts/synthesize` 文字转语音

### 健康检查

- `GET /api/health`

## 测试

后端：

```bash
cd backend
pytest
```

前端：

```bash
cd frontend
pnpm run test
```

## 部署建议

- 生产数据库建议切换 PostgreSQL（`postgresql+asyncpg://...`）
- 前端可部署到 Vercel/Netlify，后端可部署到云服务器或容器平台
- 使用 Nginx 反向代理 `/api` 到 FastAPI 服务
- 配置 HTTPS 与安全环境变量，不要提交真实密钥

## 路线图

详见仓库根目录 `TODO.md`。

## 许可证

如需开源发布，建议补充 `LICENSE` 文件（如 MIT）。

JD 异步生成的启用步骤、验证边界与配置说明见 [docs/jd-runs-implementation.md](docs/jd-runs-implementation.md)。默认保留原聊天路径，启用后 JD 使用独立 Worker 与 Redis Streams。
