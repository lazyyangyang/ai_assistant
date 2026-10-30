# AI Career 项目协作约定

## 适用范围与上下文

- 本文件适用于本仓库及子目录。在本项目中处理每一轮用户请求前，读取本文件的最新内容，并将其作为工作上下文；不要只依赖历史对话中的摘要。
- 如上下文被压缩、切换任务或本文件发生更新，继续工作前重新读取。不需要在每次回复中复述全文。
- 本文件不能改变 Codex 的沙箱权限或客户端加载机制；实际自动加载由 Codex 决定。遵守更高优先级指令及用户当前明确要求。

## 与用户协作

- 默认使用简体中文，先给结论，再用清楚的步骤说明原因。
- 区分咨询与执行：用户询问“能不能”“为什么”“有什么优劣”时，结合上下文判断；在技术讨论中默认先解释方案，不将可行性提问直接视为修改授权。
- 用户明确要求“请修改”“请实现”“请创建”或确认执行后，完成对应工作；已授权范围内的常规步骤不要反复询问。
- 用户学习项目代码时，按实际调用链解释：前端输入与状态 → 业务 Hook → 请求封装 → 后端路由与依赖 → 数据库 → 响应 → 界面更新。列出相关文件，必要时给出代码片段和示例数据。
- 描述当前代码、预期设计和已验证行为时明确区分。不要把 README/TODO 的描述或勾选当成运行验证结果。
- 不猜测软件界面的按钮或配置入口；根据可见截图、实际工具能力或官方说明解释，不具备操作能力时直接说明。

## 项目概况

- AI Career 是求职辅助平台，主线为：注册登录 → JD 解析 → 简历诊断与版本管理 → 模拟面试 → 评价报告。
- 前端：React 19、TypeScript 5.9、Vite 8、Tailwind CSS 4、React Router 7、Axios（Fetch 适配器）；UI 使用 shadcn / Base UI，聊天使用 Markdown 渲染与 TanStack React Virtual。具体依赖范围见 package.json 和 README 技术栈。
- 后端：FastAPI、Uvicorn、Pydantic、LangChain / langchain-openai、OpenAI 兼容模型接口、sse-starlette、SQLAlchemy 异步会话、Alembic；PDF / DOCX 提取使用 pdfplumber / python-docx。
- 数据库默认 SQLite + aiosqlite，ORM 定义 users、auth_sessions、resumes、chat_sessions、chat_messages 五张业务表。已包含 PostgreSQL 的 asyncpg 驱动与配置入口，但不代表已部署或完成迁移验证。
- 当前阶段保留 SQLite，优先跑通 AI 业务；后续学习分库分表、分布式部署时再评估迁移 PostgreSQL，相关架构另行设计与验证。
- 产品目标为每个浏览器标签页可独立登录不同账号；同账号标签页需同步简历等服务端数据变更，业务通知与登录凭证同步分离。代码已按 `docs/tab-session-isolation-design.md` 实施；验证覆盖与未验收项见 `docs/verification/tab-session-isolation-2026-10-27.md`，不可把实现等同完整验收。
- 语音功能包含录音转文字和文字转语音；非 WAV 音频转换依赖 FFmpeg。
- 以当前文件为准，不在普通代码讲解时读取或输出真实密钥。

## 代码导航

- `frontend/src/pages/`：页面展示与表单绑定。
- `frontend/src/hooks/`：页面状态、业务交互和 SSE 消费逻辑。
- `frontend/src/contexts/AuthContext.tsx`：登录、注册、退出与用户状态。
- `frontend/src/lib/http.ts`：Axios 实例、请求及响应拦截器；`authSession.ts` 管理页内状态机、内存身份和预刷新；`businessEvents.ts` 只同步简历失效通知。
- `frontend/src/lib/api.ts`：业务接口封装。
- `frontend/src/components/ProtectedRoute.tsx`：前端路由访问控制。
- `frontend/vite.config.ts`：开发服务器及 `/api` 代理。
- `backend/app/main.py`：FastAPI 入口、路由注册与 CORS。
- `backend/app/routers/`：认证、聊天、简历、STT、TTS 接口。
- `backend/app/auth.py`：密码哈希、JWT 签发与验证。
- `backend/app/deps.py`：当前用户认证依赖。
- `backend/app/database.py`、`backend/app/models/`：数据库会话与模型。
- `backend/app/schemas.py`：请求及响应结构。
- `backend/app/agents.py`、`backend/app/prompts.py`：模型调用与角色提示词。
- `backend/app/config.py`、`backend/.env.example`：配置定义与示例。
- `backend/alembic/`：数据库迁移。

## 现有行为与修改注意事项

以下记录基于当前工作区（认证机制更新于 2026-10-27）；后续变更时核对并更新，不能作为禁止功能演进的约束。

- 前端 HTTP 请求已迁移至 Axios，使用 Fetch 适配器；流式聊天使用 `responseType: 'stream'`，语音合成使用 Blob。
- 请求拦截器添加 Bearer Token；响应拦截器规范化错误并保留 Axios 状态和取消信息。不能将取消请求展示为普通请求失败。
- Access Token 只存在本页内存，不写入 localStorage/sessionStorage；仅认证 sid 保存在 sessionStorage。浏览器报告 reload 时用 sid 和定向 Cookie 恢复，再 GET /me；普通新页面清除可能复制的 sid，不继承身份。未知导航类型保守要求登录，浏览器复制/关闭后恢复差异须单独验收。Refresh Cookie 为 ai_career_tab_refresh，HttpOnly、SameSite=Strict、精确 Path=/api/auth/sessions/{sid}/，固定有效期、不滚动续期。
- 恢复期间阻止业务请求；401 清除恢复记录，网络/服务错误允许重试或放弃恢复。退出开始即清除恢复记录，退出结果未知时不能通过重载自动恢复；显式重新验证成功可重新保存 sid。存储不可用时退化为本页内存登录。
- 注册只创建账号并返回用户信息，不签发 Token 或创建登录会话；注册成功跳转登录页，由用户主动登录。用户名和邮箱由数据库唯一约束兜底，提交时的对应唯一冲突回滚并返回 409，其他完整性错误不伪装为重复注册。
- 提前 60 秒刷新，页内队列与共享 Promise 去重；没有跨页凭证广播或 Web Locks。BroadcastChannel 只通知同账号简历失效，失败显示提示，进入/恢复页面时重新 GET，不使用 localStorage 降级。
- HTTP 层在 401 时最多刷新并重试一次，认证失效清除用户状态，由 ProtectedRoute 跳转；聊天 Hook 保留自身跳转处理。
- 登录会话使用 auth_sessions 表，JWT 的 sid 与其绑定；定向 refresh/logout 校验 sid 与 Cookie 哈希，旧入口返回 410。退出失败保留业务树并关闭请求入口；聊天 session_id 不参与认证。Cookie 写操作要求 X-CSRF-Protection 请求头及允许的 Origin；HTTPS 部署须设置 REFRESH_COOKIE_SECURE=true。
- 会话上限配置 AUTH_MAX_ACTIVE_SESSIONS_PER_USER 默认 20；SQLite 用短写事务原子检查配额。简历写入同样串行保护版本与 active。过期维护命令默认预览，执行删除须显式 --execute 并确认数据库。
- 后端使用 `Depends(get_current_user)` 认证，CORS 是独立的跨域中间件。数据归属检查需保留。
- Vite 将 `/api` 代理到 `http://127.0.0.1:8000`；浏览器侧是同源请求。直接跨域部署需另行考虑 CORS。
- 修改网络层时保留 JSON、FormData 自动边界、204 空响应、Blob/流错误解析、SSE 分块中文、结构化事件、结束事件和 AbortController 取消能力。
- JD 复用结果保存在单身份内存槽位，忽略且保留旧 localStorage；同账号简历列表共享 Provider 更新，但选择与聊天上下文由页面独立持有。简历优化版本保存最近 AI 回复全文。不要误称为多岗位管理或排版简历导出。

## 本地环境与执行边界

- 使用 Windows PowerShell，路径可能包含空格和中文，命令必须正确引用路径。
- 前端依赖安装在项目目录，使用 pnpm 并维护 `pnpm-lock.yaml`。不要无故切换包管理器或生成其他锁文件。
- 后端使用 `backend/.venv` 的 Python，避免向全局 Python/Anaconda 环境安装项目依赖。
- 不在无关任务中修改系统 PATH、全局 Git/npm/pip 配置、注册表或用户级软件设置。共享依赖缓存可能写到项目外，不能宣称完整虚拟机隔离。
- 沙箱或网络受限时遵循工具审批机制，不通过替代工具绕过限制。
- 启动服务需在当前任务范围内；仅测试前端时不自动启动后端或调用真实 AI 服务。用户要求关闭时，仅关闭本任务启动并确认归属的进程。
- 密钥放在本地环境配置中，不写入源码、文档、测试样例或提交记录。不要覆盖已有 `.env`。
- 修改前检查 Git 状态，保留用户已有改动和未跟踪文件。不要擅自清理 `.codex/`、缓存、数据库或重置仓库。

## 验证与交付

- 前端命令从 `frontend` 目录执行：`pnpm run build`、`pnpm exec vitest run`。静态检查可针对改动文件执行 `pnpm exec eslint <files>`。
- 后端命令从 `backend` 目录执行：`.\.venv\Scripts\python.exe -m pytest`。仅在后端任务需要且依赖可用时运行。
- 数据库迁移属于数据库写入，只有当前任务需要初始化或迁移时才执行 `alembic upgrade head`，先确认目标数据库。
- 网络层和认证等实质性改动需要有针对性的验证；文档修改不必运行应用测试。
- Mock 测试不能替代真实后端/模型联调。报告实际运行的检查、通过或失败情况，以及未验证的范围。
- 不因为历史上构建成功就宣称当前版本测试通过。完成时说明改了什么、为什么、如何验证，提供可点击的文件链接。
- 不默认提交、推送或部署，除非任务明确要求。

## 文档维护

- 保持本文件简洁，记录稳定规则与关键架构，不追加完整聊天记录、临时日志或敏感信息。
- 用户明确更新长期偏好，或任务改变本文件描述的架构时，同步修订相关条目。

- JD 异步任务正在分阶段实现：已实现 chat_runs、独立 Worker、Redis Streams/SSE 与 JD 前端接入；JD 已移除旧流式实现和前端切换开关，固定使用异步任务；后端 CHAT_RUNS_ENABLED 默认关闭，启用前须准备 Redis、迁移和 Worker。真实 Redis 的受控并发、取消与停机检查见 docs/verification/redis-concurrency-2026-10-30.md；真实模型、浏览器和多进程故障联调尚未验收，启用和限制见 docs/jd-runs-implementation.md。



- SQLite 连接现使用 WAL 和 5 秒 busy_timeout；Worker 领取锁冲突退避重试，任务写接口锁超时返回 503。SSE 短数据库操作已增加取消保护，池上限保持每进程 15；模拟模型独立进程 1..40 并发及断流/重启复测通过，追踪和限制见 docs/verification/pool-tracing-2026-10-30.md。故障有时序性，尚不能宣称真实模型容量提升或所有历史锁来源已消除。
