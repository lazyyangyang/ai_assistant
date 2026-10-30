# 连接池追踪与 SSE 取消保护

## 配置核对（项目代码和本机安装依赖）

- SQLite：每个进程的 Engine 使用独立池，pool_size=5、max_overflow=10、pool_timeout=30 秒。API 与 Worker 各最多借出 15 个连接，不预建 15 个连接。
- Redis：RunEvents 未设置 max_connections，当前 redis-py 默认 2**31=2147483648。这是理论客户端池上限，不是预分配，也不是 Redis 服务端 maxclients。API 每条 SSE 创建自己的 RunEvents/池；Worker 进程共享一个 RunEvents。未核查用户业务 Redis 的 maxclients。
- 模型：项目没有显式 HTTP 连接限制。本机 LangChain 默认客户端为 max_connections=1000、max_keepalive_connections=100、keepalive_expiry=5 秒，按 base_url/timeout/socket_options 缓存客户端；进程间不共享。用测试 API key 和回环地址构造对象读取实际 transport 验证 1000/100，未发送模型请求。提供商并发配额与此独立。
- Worker 执行槽位：代码默认 2，独立进程测试设 8，配置允许 1..16。槽位不是连接池。

## 追踪实现

verify_runs_tcp.py 新增 --trace-pool，在测试子进程监听 SQLAlchemy checkout/checkin，记录连接标识、单调时钟、持有毫秒数、在借计数、异步调用位置及 SQL 类型/模板前缀（不记录绑定参数、凭证或正文）。每进程输出独立 JSONL，默认不开启。连接创建过程中失败可能尚未触发 checkout，因此在借计数不是连接池全部资源占用的完整视图。终止进程时的未配对记录也不能单独作为泄漏证明。

复现命令：

```powershell
.\backend\.venv\Scripts\python.exe backend/scripts/verify_runs_tcp.py --trace-pool --redis-server '.local/redis-validation/bin74/Redis-7.4.11-Windows-x64-msys2/redis-server.exe'
```

## 证据和修复

失败批次 afb528c12e034778948ac183d9382bb0：20 并发第二批失败。API 借出 1828 次、归还 1824 次；成功归还的持有时间 p95 197.78ms、最大 1899.58ms；Worker 431/431 配对。API 日志在池超时前出现 SSE AnyIO cancel scope 打断连接 terminate，以及 AsyncSession.close 的 no active connection。结合代码，取消可能发生在 SSE 周期性认证/任务查询获取连接或释放连接期间。

修复 chat_runs.py：用 AnyIO CancelScope(shield=True) 保护每轮短数据库查询的完整生命周期，包括获取、查询和退出清理；auth_expired 事件移到会话关闭之后发送。Redis 阻塞等待和 yield 不受保护，断流仍可取消。未增加任何连接池上限。

需要区分证据强度：追踪中的另一未修复批次 8754941d25a34b0a84da39b0456cfba9 也全部通过，说明故障时序敏感，追踪自身也会改变调度。上述是有日志支持的取消风险及针对性保护，不是对所有历史锁错误的唯一因果证明。

## 修复后结果

批次 01a814c9079e4d8bb02e17f2800da3a6，真实 TCP、独立 API/Worker/Redis，模拟模型，8 个执行槽位。

| 进程 | 借出/归还 | 在借峰值 | 持有 p95 | 最大持有 |
| --- | --- | --- | --- | --- |
| API | 4763/4763 | 15 | 200.20ms | 5261.43ms |
| 初始 Worker | 979/979 | 6 | 162.36ms | 2975.83ms |
| 重启 Worker | 37/37 | 1 | 20.01ms | 28.93ms |

1/5/10/20/40 并发各三批分别 3/15/30/60/120 全部成功，另预热成功。断流重连、终态幂等、跨用户拒绝、取消、Worker 强杀后 interrupted、重启后新任务成功均通过。API/Worker 日志无错误。完整后端回归 41 passed。测试服务已由脚本清理，未使用业务数据库、Redis 或真实模型。

两个追踪测试有运行重叠，数字只用于本次持有时间和行为验证，不能作隔离性能基准或旧架构容量提升比较。未验收真实模型、浏览器及长时间反复取消压力。

## 决策

暂不扩大 SQLite 池：保留每进程 15 上限，优先确认取消清理的长期稳定性。峰值达到上限并不必然需要扩容；下一步应在隔离运行下统计获取连接等待时间、超时率及重复断流后的池占用趋势，再决定是否调整。Redis 理论上限过大且池按 SSE 分散，后续可单独设计共享有界池；本次没有擅自改变其生命周期或限额。模型 HTTP 池的 1000 上限也不能作为提升 Worker 槽位的依据。
