# AI Career 平台 — 开发任务清单

> 按优先级从高到低排列，每个阶段完成后勾选。

---

## 阶段一：核心功能闭环（MVP 可用）

### 1. 流式请求携带 JWT Token
- [x] `useStreamChat` Hook 的 `fetch` 请求头加入 `Authorization: Bearer <token>`
- [x] 后端 `/api/chat/stream` 端点增加 `get_current_user` 依赖校验
- [x] 未登录用户调用对话接口时返回 401，前端自动跳转登录页

### 2. 对话持久化
- [x] 用户发起新对话时，后端自动创建 `ChatSession` 记录
- [x] 每轮 user / assistant 消息实时写入 `ChatMessage` 表
- [x] 新增 `GET /api/chat/sessions` 接口 — 返回当前用户的历史会话列表
- [x] 新增 `GET /api/chat/sessions/:id/messages` — 返回指定会话的消息记录
- [x] 前端增加「历史对话」侧栏或列表页，支持点击恢复上下文继续对话

### 3. 简历上传与多版本管理
- [x] 新增 `POST /api/resumes/upload` — 接收文件（PDF / TXT / DOCX），解析为纯文本存入 `resumes` 表
- [x] 后端集成 PDF 解析库（`pdfplumber` 或 `PyMuPDF`）
- [x] 新增 `GET /api/resumes` — 返回当前用户的所有简历版本列表
- [x] 新增 `GET /api/resumes/:id` — 返回指定简历详情
- [x] 新增 `DELETE /api/resumes/:id` — 删除指定简历
- [x] 新增 `PATCH /api/resumes/:id` — 更新简历标题 / 设为当前活跃版本
- [x] 前端简历管理页面：上传入口 + 版本列表 + 切换活跃版本
- [x] 对话页面支持选择简历后传入 Agent 上下文

---

## 阶段二：体验优化

### 4. JD 解析结果结构化展示
- [x] 后端 JD Agent 返回结构化 JSON（技能列表、职责、硬性要求）
- [x] 前端 JD 页面除对话气泡外，增加「解析结果卡片」可视化展示
- [x] 支持将解析结果保存，后续关联到简历诊断和模拟面试

### 5. 简历诊断增强
- [x] 简历 Agent 对接用户选择的简历 + 目标 JD，自动注入上下文
- [x] 诊断结果中的「重写段落」支持一键复制
- [x] 支持生成新的简历版本并自动保存到 `resumes` 表

### 6. 前端流式渲染性能优化
- [x] `useStreamChat` 增加防抖节流，避免高频 setState 导致的渲染卡顿
- [x] 消息列表虚拟滚动（当对话过长时保持性能）
- [x] 代码块增加「复制」按钮

### 7. UI / UX 打磨
- [x] 深色模式切换按钮（当前依赖系统偏好）
- [x] 移动端响应式适配（导航折叠、对话区全屏）
- [x] 页面切换 loading skeleton
- [x] 全局 Toast 通知（操作成功 / 失败提示）

---

## 阶段三：沉浸式面试引擎

### 8. 语音输入（STT）
- [x] 前端通过 `Web Audio API` + `MediaRecorder` 采集用户语音
- [x] 录音完成后调用语音转文字接口（Whisper API 或智谱语音）
- [x] 转写文本自动填入输入框或直接发送
- [x] 面试页面增加「按住说话」交互模式

### 9. 面试会话增强
- [x] 面试 Agent 维护长会话记忆（基于 `ChatSession` 持久化上下文）
- [x] 支持面试结束后生成完整评价报告（存入 `feedback` 字段）
- [x] 前端面试结束页：分项评分 + 改进建议可视化

### 10. 语音输出（TTS）— 可选
- [x] 面试官回复支持语音播放（调用 TTS 接口）
- [ ] 实现全语音交互的沉浸式面试体验

---

## 阶段四：工程化与部署

### 11. 测试
- [x] 后端单元测试（pytest + httpx AsyncClient）
- [x] 前端组件测试（Vitest + React Testing Library）
- [x] 认证流程 E2E 测试

### 12. CI/CD
- [ ] GitHub Actions：前端 lint + build、后端 lint + test
- [ ] Docker Compose 编排（frontend Nginx + backend uvicorn + PostgreSQL）
- [ ] 环境变量管理（开发 / 生产分离）

### 13. 生产部署
- [ ] 切换数据库为 PostgreSQL（asyncpg 驱动）
- [ ] Nginx 反向代理（前端静态 + /api 转发）
- [ ] HTTPS 证书配置
- [ ] 日志收集 & 错误监控

---

## 阶段五：扩展功能（远期）

- [ ] OAuth 第三方登录（GitHub / Google）
- [ ] 简历模板导出（生成 PDF）
- [ ] 面试题库管理（按岗位分类）
- [ ] 多语言支持（中 / 英）
- [ ] 用户数据看板（投递进度跟踪）
