# 标签页独立登录：实施与验收记录

日期：2026-10-27（Asia/Shanghai）。状态：核心代码已实施；G5/G6 完整验收未完成。没有提交、推送、部署或操作日常数据库。

## 基线与执行边界

- 开始时的 Git 改动清单保存在 [tab-session-baseline.txt](tab-session-baseline.txt)。工作区原有认证改造、迁移、文档、测试和未跟踪目录均保留，没有 reset/clean。
- 改动前 `pnpm run build` 成功。首次 Vitest 在沙箱临时文件 rename 时 EPERM；获准沙箱外重跑后，原有 5 文件 / 22 测试通过。
- 原始 pytest 在沙箱内长时间无输出，已结束本任务的该进程；未取得完整修改前后端基线，不能声称原始 pytest 全绿。首次沙箱外执行时后端协议已改：7 个旧协议断言失败、1 个 STT 夹具失败。前者随协议迁移，后者原夹具只有 dummy-audio-bytes 且 Mock 不接受 debug_info，改为 1 秒合法 WAV 和准确的服务签名。
- pytest 在导入 app 之前创建唯一临时 SQLite URL，并覆盖模型/STT/TTS 外部地址；E2E 在导入 app 前验证路径属于 frontend/test-results/<UUID>/，使用唯一数据库、端口和测试账号。没有调用真实模型；没有覆盖 .env。
- Playwright 由 pnpm 安装并更新唯一 pnpm-lock.yaml。浏览器和测试执行获准在沙箱外进行，未修改 PATH、全局包管理器配置或浏览器用户设置。

## 实际代码与验证映射

| 任务 | 主要文件 | 实施与验证 | 未覆盖/下一步 |
| --- | --- | --- | --- |
| W01 | 设计文档、AGENTS.md、本记录 | 明确 phase 唯一归状态机、/me 显式完成通知、logout 拒绝/未知结果均不允许换号 | 以本记录区分实现与全验收 |
| W02 | playwright.config.ts、e2e/fixtures、tests/e2e_app.py、conftest.py | 独立数据库、同 context 双 page、真实认证/简历、模型边界夹具 | Firefox 启动阻塞 |
| W03 | routers/auth.py、services/auth_sessions.py、schemas.py、main.py | sid 格式、精确 Cookie Path、定向哈希验证、幂等退出、旧端 410、所有认证错误 no-store；负向组合/提交失败回归 | HTTPS Secure 实机在 W14 |
| W04 | config.py、.env.example、test_auth_session_limits.py、cleanup_expired_auth_sessions.py | 原子上限、真实多连接竞争、锁冲突 503 后成功、过期不占额度、默认预览和重复清理；不删除有效会话 | 浏览器 Cookie 配额未测；PostgreSQL 分支未测 |
| W05 | authTypes.ts、authSession.ts、authTransport.ts、httpErrors.ts | 页内队列/去重、epoch/generation、提前刷新/退避、identityError/logoutUncertain/revalidating、dispose；双实例互不等待 | 原生恢复与完整失败组合尚未逐一实测 |
| W06 | http.ts、api.ts、requestScope.ts | 调用时快照、请求/成功/失败/重试保护、401 一次、取消合并、流保持注册、Blob 错误、FormData/204 | 全部写超时浏览器组合未逐一注入 |
| W07 | AuthContext、AuthenticatedWorkspace、ProtectedRoute、App、登录/注册页面 | /me 唯一去重、启动匿名、同 sid 保留业务树、失败重试、阻塞保留草稿；组件和真实双页验证 | 原生复制/关闭恢复未验 |
| W08 | jdStorage.ts、i18n.ts | 单身份深拷贝槽位，旧 localStorage 保留但忽略；单元与 Chrome JD 跨页/换号用例通过 | Chrome/WebKit JD 最终统一运行通过 |
| W09 | useStreamChat、useChatPanel、useChatInput、useInterviewEndPage、useOperationGuard | 组件/身份/操作保护，停止 tracks/播放/timer/reader，录音授权晚返回清理；SSE 中文/结构化/结束事件回归 | STT/TTS 迟到完整矩阵和手机麦克风/播放未验 |
| W10 | businessEvents.ts、AuthContext、api.ts | userId 频道、严格白名单、eventId/sourceTabId、256 去重容量、本页失效与远端通知分离；通知失败仍写成功 | 非主流浏览器兼容未验 |
| W11 | ResumeDataContext、useResumesData、resumeStore.ts | 单缓存、200ms 合并、请求中 dirty 补拉、失败保留、不忙循环、无消费者延迟、清理监听；单元测试 | 所有隐藏/离线/StrictMode 组合未完全覆盖 |
| W12 | useResumeSelection、简历/面试页面、ChatPanel、routers/resumes.py | 有效选择保留、删除不自动替换、聊天上下文固定、禁新请求；写与同步错误分开；修复并发版本重复 | 全部 UI 版本/active/隐藏页交互组合未验 |
| W13 | tab-session-isolation.spec.ts、resume-sync.spec.ts | 9 个真实协议/明确故障注入场景，每场景双页共用 context，无预装 Token/storageState | 尚非 T01–T22 每个子场景的全自动化 |
| W14 | 三浏览器配置、测试报告 | Chrome 和 WebKit 可执行；Firefox 安装后仍 spawn UNKNOWN | Firefox、真机、原生复制/恢复、真实 BFCache、Cookie 容量、HTTPS Secure 未验 |
| W15 | README、AGENTS、设计/任务文档、本记录 | 文档更新，迁移升级/降级测试只在临时库，旧端 410 与定向协议测试通过 | 完整旧/新客户端升级回滚演练和最终 G6 未完成 |

## 本轮发现并修复的问题

1. 四个并发创建简历请求都得到 version=1。加入 SQLite BEGIN IMMEDIATE 短事务，先结束认证读事务，再读取版本、写入和维护 active；多连接测试验证版本唯一、仅一个 active。PostgreSQL 使用用户行锁分支，但本轮只验证 SQLite。
2. 首次发送聊天时，历史初始化 Effect 在流开始后重置消息并取消流。调整为加载中不执行历史初始化；真实聊天及删除上下文用例复测通过。
3. SSE 401 重试返回响应头后，外层错误处理提前释放取消注册。将取消注册的所有权交给返回流，直到结束或取消才释放；测试验证传给 Fetch 的 signal 在身份暂停时被取消。
4. 退出/恢复取消请求后，表单忙状态需回到可重试状态，但草稿不得丢失；当前通过身份状态订阅清忙状态，旧操作不能回写。
5. 测试使用 input[type=text] 未匹配未显式设置 type 的实际标题输入框，改为按可见 placeholder 定位；没有放宽功能断言。

## 最终检查命令与结果

| 检查 | 结果 |
| --- | --- |
| frontend: pnpm run build | 成功，退出码 0 |
| frontend: pnpm exec vitest run | 10 文件、31 测试通过，退出码 0 |
| frontend: pnpm exec eslint（本轮改动 TS/TSX 与 E2E 文件） | 退出码 0，无错误；useVirtualizer 的 React Compiler incompatible-library 警告 1 条 |
| backend: .\.venv\Scripts\python.exe -m pytest -q | 26 测试通过，退出码 0；包括迁移、会话维护、配额锁冲突和简历并发 |
| Chrome 155.0.8059.85（Playwright chromium project，channel=chrome） | 最新 9/9 通过 |
| WebKit 27.2 | 最终统一运行 9/9 通过；Chrome/WebKit 合计 18/18，通过（3.2 分钟）。T10 曾触及 30 秒总预算，保留断言改为 60 秒场景预算后，单独及统一运行均通过（统一运行 14.3 秒） |
| Firefox 157.0 / Playwright firefox v1555 | 7 项均在启动阶段失败，单独重试仍 spawn UNKNOWN；不计为功能通过 |
| git diff --check | 成功，只有已有文件 LF/CRLF 提示 |

Vite 的 __dirname/native configLoader 提示不阻止构建，本轮没有为此变更配置加载机制。

## T01–T22 覆盖与边界

| 编号 | 已有证据 | 尚未验收的范围 |
| --- | --- | --- |
| T01–T04 | 后端和 Chrome/WebKit 同 context 登录、归属拒绝、双 sid、定向刷新、单页退出、重复退出 | 所有同账号退出组合未单列浏览器案例；Firefox |
| T05–T06 | 新页匿名零 refresh、SPA 保持、reload 重登 | 原生复制标签、关闭恢复、真实 BFCache |
| T07 | 错 sid/错 Cookie、缺失/过期、非法 sid 422 | 更广泛浏览器 Cookie 容量行为 |
| T08 | 页内并发去重、401 最多一次、两页分别触发真实定向 refresh | 真正等待 Access 自然到期的多设备长期用例 |
| T09 | 迟到 refresh、旧列表跨换号、退出失败草稿保留、SSE 取消 | 所有历史/报告/语音响应排列 |
| T10 | 深拷贝、旧 storage 忽略、跨页 JD 不共享、同文档重登清理 | 真实整页重载后的全部 JD UI 组合未逐一覆盖，内存槽位初始化与换号已验证 |
| T11–T12 | Path/HttpOnly/SameSite、刷新不 Set-Cookie、删除定向、保护头/Origin 403 | 实际 HTTPS Secure、Cookie 被浏览器拒绝/容量耗尽 |
| T13 | 退出不确定后强制 refresh+/me；定时/可见单元测试 | 真 BFCache、手机切后台/断网恢复 |
| T14 | 旧入口 410、临时库迁移升级/降级 | 完整发布与旧客户端回滚演练 |
| T15 | 临时 SQLite 上限、锁冲突后恢复、过期不占额度 | 多账号浏览器 Cookie 配额及孤立会话容量探测 |
| T16–T17 | 同账号更新、异账号数据归属隔离、伪造/重复事件过滤 | 每种写操作跨三浏览器全矩阵 |
| T18 | 删除所选简历后保留草稿并禁提交；并发版本/active 后端一致 | 受控长流期间删除且流继续完成的浏览器屏障测试 |
| T19 | 真实上传成功后 GET 500、通知失败、POST 仅一次、独立同步错误 | 写超时后服务端已提交的完整对账案例 |
| T20 | 200ms 合并、请求期间 dirty 补拉、事件去重、失败不循环 | 高压力事件与乱序全量浏览器测试 |
| T21 | 无消费者暂停、恢复可见/联网代码入口 | 隐藏/离线/手机恢复完整矩阵 |
| T22 | 旧频道回调丢弃、旧列表跨账号迟到、录音权限晚返回 tracks 停止 | STT/TTS/上传各阶段跨号与设备资源完整矩阵 |

## 证据位置与下一步

- Chromium/WebKit 早期 7 场景各全部通过：frontend/test-results/77ebb4ad-07fc-4fb5-92e4-74d00188da55/。
- 最新 9 场景各执行：frontend/test-results/c02ebfac-8a66-4f86-854f-c169f33385c4/，包含 WebKit T10 超时截图与报告。
- Firefox 单独复查：frontend/test-results/6ad0f1c1-d245-4dab-9762-82e46897288b/。
- test-results 已忽略；trace/HAR 关闭，未公开 Token、Cookie 或真实账号。测试服务由 Playwright 管理生命周期，执行完后退出自身服务，不关闭用户其他服务。
- WebKit T10 单独复测：frontend/test-results/ca60da01-f597-4384-8568-6cc1f9d527eb/。最终统一回归目录：frontend/test-results/d7ad420d-0fd6-4916-b205-5c3fd542d017/，18 项通过，退出码 0。
- 下一步先解决 Firefox 启动环境，再按测试计划完成 W13 未覆盖子场景、W14 真机/原生生命周期/容量、W15 完整升级回滚。只有这些通过后才能把 G5/G6 与全部任务标为通过。
