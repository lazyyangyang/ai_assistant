# JD 异步生成：实现与启用

当前新增 JD 专用异步路径，简历诊断与面试仍使用原流式入口。JD 前端固定使用任务接口；后端服务开关默认关闭。

## 启用条件

1. 已安装 Python Redis 客户端到 backend/.venv（本轮安装 redis 5.3.1）。
2. 准备可访问的 Redis 7.4 实例。部署时绑定回环或受控内网、开启访问认证、AOF、持久化目录和内存上限，使用 noeviction，禁止浏览器直接访问。当前 Windows 未发现 Docker，WSL 提示未安装。本次在项目目录使用 Redis 7.4.11 社区便携构建完成隔离验证，测试实例已关闭；另有既存 Redis 3.2 系统服务未改动。
3. 明确 DATABASE_URL 指向的目标后，从 backend 执行 `.\.venv\Scripts\python.exe -m alembic upgrade head`。本轮只对测试临时数据库迁移，未迁移业务数据库。
4. 后端配置 CHAT_RUNS_ENABLED=true 和 REDIS_URL；启动 API，并在 backend 独立运行 `.\.venv\Scripts\python.exe -m app.worker`。
5. 前端已移除 VITE_JD_RUNS_ENABLED，JD 固定使用任务接口；后端未启用时返回 503，不回退旧流程。

## 行为

- SQLite 短写事务原子领取任务；Worker 默认并发 2，任务快照/租约默认 2 秒保存一次，Redis 文字片段约 100ms 合并。
- 运行超时 600 秒，排队超时 300 秒，租约 60 秒；失联任务标记 interrupted，不自动重试模型。
- SQLite 先提交最终文字、结构化结果与 succeeded，再发 completed。前端最终查询 SQLite 状态确认结果。
- Redis Lua 原子保存快照与事件游标，Streams 限长 2000，终态发布后 TTL 24 小时。运行中不设置 TTL。
- SSE 每轮检查认证，连接断开不取消任务。重连先替换原子快照，再接收后续事件；Redis 不可用时前端继续查询任务状态。
- 新对话分析新 JD；已有会话可选择追问或更新。追问不重新提取，提取失败不覆盖上次有效卡片。输入、原始 JD、JD 版本和历史保存在任务输入快照。
- 点击停止请求服务端取消；切换会话/新建会话仅停止订阅。sessionStorage 只保存按认证 sid 隔离的聊天定位 ID，认证恢复后继续查看。

## 已知验收边界

- 已完成真实 Redis 下 2/4/8 执行槽位并发、重放一致性、取消及 Redis 停机检查，见 verification/redis-concurrency-2026-10-30.md。真实模型、浏览器断网与 API/Worker 重启联调以及旧实现对照尚未完成，不能据此宣称线上容量提升。
- Worker 每 30 秒分批核对终态任务，为残留 Redis 键设置 TTL；Worker 全部停止时清理暂停。
- 旧 /chat/stream 始终 对 JD 请求返回 410，防止旧入口绕过任务会话并发限制；简历和面试不受影响。
- 前端 POST 自动重试使用同一个请求 ID；若两次响应均丢失，需从历史会话查看已创建任务。

Redis API 依据：https://redis.io/docs/latest/develop/clients/redis-py/async/ 和 https://redis.io/docs/latest/commands/xread/ 。


## 本轮自动化检查

- 后端全量 pytest：38 项通过（包含临时数据库迁移升级/降级）。
- 前端原有 Vitest 回归：42 项通过；新增 SSE 测试另行运行，1 项通过。
- 前端生产构建通过；改动文件 ESLint 无错误，TanStack Virtual 有既有兼容性警告。
- Worker 故障测试使用替身事件总线和模型，未连接真实 Redis 或模型。
