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

### 前端

- React 19
- TypeScript 5
- Vite 8
- Tailwind CSS 4
- React Router 7
- shadcn/ui

### 后端

- FastAPI
- LangChain + OpenAI 兼容接口
- SQLAlchemy Async + Alembic
- SQLite（开发）/ PostgreSQL（生产）
- JWT 鉴权
- SSE（Server-Sent Events）流式响应

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
JWT_ACCESS_EXPIRE_MINUTES=15
JWT_REFRESH_EXPIRE_DAYS=7
REFRESH_COOKIE_SECURE=false
REFRESH_COOKIE_SAMESITE=lax
DATABASE_URL=sqlite+aiosqlite:///./ai_career.db
```

生产环境通过 HTTPS 部署时必须将 `REFRESH_COOKIE_SECURE` 设置为 `true`。

语音能力可选配置：

```env
FFMPEG_BIN=C:\path\to\ffmpeg.exe
STT_MODEL=whisper-1
TTS_MODEL=tts-1
```

## API 概览

### 鉴权

- `POST /api/auth/register` 注册
- `POST /api/auth/login` 登录并获取 JWT
- `POST /api/auth/refresh` 使用 HttpOnly Refresh Cookie 续期 Access Token
- `POST /api/auth/logout` 清除 Refresh Cookie
- `GET /api/auth/me` 获取当前用户

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
