# 真实 Redis 并发验证（2026-10-30）

## 环境与方法

- 使用 redis-windows 社区便携构建 Redis 7.4.11（MSYS2），不是官方 Linux 发行包。发布来源：https://github.com/redis-windows/redis-windows/releases/tag/7.4.11 。
- 下载 ZIP SHA-256：ec629971d76756dd040204297f1a92f43848e7a5f4862d39426beeafcca2a2a9，与 GitHub 发布资产 digest 一致。
- Redis 独立进程，仅监听 127.0.0.1 的动态测试端口，AOF everysec，128MB，noeviction。测试实例已关闭。
- SQLite 使用每次运行创建的唯一 .local/redis-validation/<uuid>/test.db；创建测试表，不迁移或访问业务数据库。
- 真实执行 worker.claim / worker.execute / worker.persist、Redis Lua、Streams 和 SQLite 事务。测试器建立 2/4/8 个并发消费者，不是启动多个 Worker 进程，也未直接测试 main 调度循环。
- 模型为可控异步生成器，每轮输出 220 段中文及 emoji，段间计划等待 20ms；真实墙钟时间受 Windows 调度、Redis 和 SQLite 开销影响。
- 并发提交通过 ASGITransport 调用实际 API；认证依赖替换为测试用户，因此不代表真实网络或认证链路压测。
- 运行期间另有观察者反复读取数据库和 Redis，检查已保存文字是期望全文的前缀、SQLite 内容不回退、Redis 快照游标在事件流中存在。完成后逐字比较两张表、快照、事件拼接及断点后的 XREAD 结果。

## 并发结果

|执行槽位|任务数|观测峰值|批次耗时（秒）|平均单轮执行（秒）|任务保存次数|SQLite 总提交次数*|锁错误|
|---|---:|---:|---:|---:|---:|---:|---:|
|2|12|2|40.058|6.627|72|86|0|
|4|12|4|20.038|6.577|72|88|0|
|8|12|8|13.222|6.504|72|92|0|

*总提交计入领取/扫描事务，不含测试数据准备和随后结果检查。每轮任务保存 6 次，包含周期快照、阶段切换和最终提交，不是 6 个纯定时快照。原来逐片段保存会对这份 220 段输入至少执行 220 次片段提交，但本轮未运行旧实现进行等条件性能基准，不能把次数估算当作实测性能提升。

全部 36 轮任务最终 succeeded；每轮只被领取一次；数据库文字、聊天消息、Redis 快照和事件重放文字全部一致。三档共执行 4438 次有 Redis 快照的观察。此结果支持当前受控负载下 8 个并发执行槽位可完成工作，不代表线上用户容量、最大并发或多进程吞吐上限。默认 Worker 并发仍为 2。

## 正确性与故障检查

- 16 个相同请求同时提交：均返回同一任务 ID。
- 8 个不同请求同时提交同一会话：1 个接受，7 个返回 409。
- 同用户 8 个新任务同时提交：3 个接受，5 个返回 429。
- 真实 Lua：新 attempt 已写入后，旧 attempt 被拒绝，快照不变。
- 真实 Streams：限制设为 100 后写 120 条，实际长度保持 100；活跃快照无 TTL；已完成任务具有 TTL。
- 生成中取消：1.629 秒后确认 cancelled，保留部分内容，事件流无 completed。
- 真实关闭 Redis 进程：13.419 秒后执行流程结束，任务 failed / analysis_failed，保留 70 字符，聊天消息与任务内容一致。故障后终态事件无法发布是预期现象，SQLite 查询仍可确认失败。

## 复现

从项目根目录执行（路径替换为实际便携包路径）：

```powershell
.\backend\.venv\Scripts\python.exe backend/scripts/verify_redis_concurrency.py --redis-server '...\redis-server.exe'
```

只重测接口竞争、Redis 原子操作、取消与停机：增加 `--faults-only`。脚本自行创建并关闭自己的 Redis 进程，不清空外部 Redis，也不使用已有业务数据库。运行资料保留在 .local/，已加入 Git 忽略。

原始结果：redis-concurrency-2026-10-30.json、redis-faults-2026-10-30.json。

## 尚未验证

真实模型、浏览器 SSE 重连、多 Worker 进程、Worker 强制崩溃、Redis AOF 重启恢复、内存上限耗尽、SQLite 故障注入、长时间持续负载和 Linux 部署容量。浏览器断网恢复不能仅由 XREAD 重放测试替代。

检查环境时另发现已有 Redis 3.2.100 系统服务，路径位于用户 Downloads；它不属于本任务，没有被修改或关闭。本轮未改业务 .env，也未启用前后端功能开关。
