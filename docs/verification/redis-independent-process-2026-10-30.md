# Redis 与独立 Worker 补充验证（2026-10-30）

## 结论

前端与后端自动化回归通过，真实 Redis 受控故障测试通过。但真实 TCP API 与独立 Worker 进程联调在单请求顺序提交阶段就出现 SQLite 锁错误。尚不能给出新架构容量或与旧基线比较的性能结论。

本次未修改业务代码，只新增测试脚本。没有调用真实模型，没有改业务 .env、数据库或已有 Redis 系统服务。测试脚本退出时关闭自己启动的 API、Worker 和 Redis。代码里的 Worker 是后端 Python 进程，不是浏览器 Web Worker。

## 已执行

- 后端 `python -m pytest -p no:cacheprovider -q`：38 passed。首次沙箱运行 37 passed、1 项因 pytest 系统临时目录权限发生 setup error；获准沙箱外重跑后全部通过。
- 前端 `pnpm exec vitest run`：12 个文件、43 项通过。首次因沙箱依赖文件权限失败，获准重跑后通过。存在 Vite configLoader 的配置兼容性提示。
- `verify_redis_concurrency.py --faults-only`：真实 Redis 7.4.11，通过去重、会话互斥、用户配额、旧 attempt 拒绝、事件限长、TTL、取消及 Redis 停机测试。
- 新增 `verify_runs_tcp.py`：使用真实 HTTP 认证、真实 Redis、API 与 Worker 独立进程，执行实际 worker.main 调度循环。计划 1/5/10/20/40 并发各三批，但前置稳定性失败，容量扫描未有效完成。

## 隔离与参数

所有新数据在 `.local/runs-tcp/<uuid>/test.db` 或 `.local/redis-validation/<uuid>/test.db`，账号 lt_*、example.com，Redis 独立回环动态端口，独立目录、128MB、noeviction、AOF everysec。Redis 键按批次环境隔离。ORM 创建测试表，迁移覆盖来自单独 pytest。

新测试模型与旧基线一样输出 40 个文本片段，初始等待 100ms，每片段计划等待 25ms，结构化提取等待 200ms。独立 Worker 配置 8 个执行槽位（业务默认仍为 2），租约测试参数 30 秒（业务默认仍为 60 秒）。低负载失败发生时并未同时占用 8 个槽位。

## 实测失败

### 第一次运行：Worker 退出

批次 `59a28e8285204f0c8e477c49dadbafb7`。

- 预热及一个计量请求完成后，Worker 日志出现 `sqlite3.OperationalError: database is locked`。
- 栈定位：`worker.main()` 的 `run = await claim(worker_id)` → `claim()` 的 `await db.commit()`。
- 当前 main 没有在 claim 周围捕获该异常并进行退避，因此整个 Worker 退出，而不是只让一轮任务失败。
- 现场数据库出现 queued 任务；仅靠该 Worker 执行的租约/排队维护也无法继续。
- 为解除等待，获准停止了本次测试 API 子进程，让测试器落盘退出、清理其他子进程。原始 report.json 后续 5/10/20/40 档的连接失败由人工停止服务造成，全部作废，不是容量测量结果。

### 第二次运行：再次出现提交接口锁错误

批次 `b2e275d2da564a25bad87780e5db1251`。测试器增加每轮 25 秒期限和失败即停止逻辑后，用新库重跑。

- 预热成功，约 2.154 秒。
- 第一个计量请求成功，约 2.025 秒；全文 1240 字符，结构化结果匹配。
- 下一个顺序提交请求约 5.576 秒后返回 HTTP 500，API 日志包含 `database is locked`。
- 测试器立即中止，未产生并发档汇总；本轮未复现 Worker 崩溃，不能把两次现象混同。

两次均为真实独立进程环境。可以确认锁竞争与异常收敛问题，但尚未通过事务追踪定位具体持锁者，也未做 WAL、事务调整的因果对照。不能宣称 Redis 失效，亦不能直接断言迁移数据库就会解决所有问题。

## 真实 Redis 故障检查

批次 `86bb4ef7583544c68300847d78b460c3`。

- 16 次相同请求只产生 1 个任务。
- 同会话 8 个竞争请求：1 个接受、7 个 409。
- 同用户 8 个任务：3 个接受、5 个 429。
- 旧 attempt 拒绝、事件流长度限制、活跃键无 TTL、终态 TTL 检查通过。
- 取消约 1.642 秒确认。
- Redis 停机约 13.407 秒后任务 failed / analysis_failed；保留 70 字符，与聊天消息一致。

这组脚本的 API 用 ASGITransport、替换认证依赖，Worker 用受控直接调用；不能代替上述独立进程联调。

## 后续优先级

1. 给 claim/main 增加锁异常退避、健康状态和进程退出监控，避免一次锁超时让全部任务无人执行。
2. 排查 API/SSE/Worker 的事务持有时间，定位持锁者；独立测试库比较 WAL 与短事务策略。接口锁冲突应有可控失败语义，不能裸露为 500。
3. 低负载连续运行通过后再执行容量梯度，避免把队列堆积和传输失败当吞吐数据。
4. 再验收 TCP 断流重连、Worker 强杀重启、浏览器刷新/切页、真实模型。新脚本虽包含这些情景，本轮因前置失败尚未到达，不能视为通过。

## 复现与证据

从仓库根目录：

```powershell
.\backend\.venv\Scripts\python.exe backend/scripts/verify_runs_tcp.py --redis-server '.local/redis-validation/bin74/Redis-7.4.11-Windows-x64-msys2/redis-server.exe'
```

新脚本每次生成唯一目录，保存 report.json、api.log、worker.log、redis.log 和测试数据库。不得用这些结果推断浏览器 UI 已验证。

证据位置（仓库相对路径）：

- `.local/runs-tcp/59a28e8285204f0c8e477c49dadbafb7/`：第一轮原始资料，人工中止后的容量数据作废。
- `.local/runs-tcp/b2e275d2da564a25bad87780e5db1251/`：第二轮复现报告和错误日志。
- `.local/redis-validation/86bb4ef7583544c68300847d78b460c3/report.json`：受控 Redis 故障检查。

`.local` 已被仓库忽略；需要分享原始证据时应显式导出本批次测试资料。
