# Worker SQLite 锁异常修复

## 已确认与边界

claim 在 BEGIN IMMEDIATE 下维护租约、领取任务并提交。原主循环没有捕获 OperationalError，提交锁超时会跳出 main，finally 取消所有执行任务并关闭 Redis。此退出路径已修复。数据库默认 rollback journal，读连接可能阻塞写提交；目前没有事务级追踪证明历史故障的具体持锁连接，不能声称已经定位唯一持锁来源。

## 修改

- 主循环仅对 SQLite BUSY/LOCKED 做指数退避（上限 5 秒加抖动），会话退出回滚后再重试，保留正在执行的任务；记录失败次数和恢复日志。其他数据库错误继续暴露。
- persist 仍最多三次尝试，但只重试锁错误，不重放模型。
- submit/cancel 将 BEGIN 和 COMMIT 的锁错误转换为 503 + Retry-After: 1，并回滚。提交重试需保留原 client_request_id。
- SQLite 连接使用 WAL 和 5000ms busy_timeout。WAL 仍只有单写者，不等于无限并发。此设置在后续连接时生效并持久化到数据库，部署要求数据库位于同机本地磁盘；备份应使用 SQLite 备份方式，不能忽略 WAL 文件直接复制主库。

## 验证

- 后端完整回归 40 passed（新增真实锁测试之前）；新增测试文件随后 3 passed，包括真实临时文件数据库持有 BEGIN IMMEDIATE、领取失败、释放后恢复。
- 异常处理修复但未启用 WAL：批次 f6587ea13a204b64bb1e34413d316df7，预热成功后提交返回 503，证明仅捕获异常不足以解决稳定性。
- 加 WAL：批次 6ff950def3ae40c6b34fc888bd11588e，1/5/10 并发各三批，分别 3/15/30 全通过。20 并发首批失败，API 日志为 QueuePool size 5 overflow 10 耗尽（30 秒），不是容量验收通过。后续断流、强杀恢复检查未到达。
- 真实 TCP、独立后端 Worker、独立 Redis、模拟模型；未修改业务 .env 或业务数据库，脚本已结束并清理其子进程。原始资料位于 .local/runs-tcp/ 对应批次。

## 剩余工作

追踪 API 连接持有时间及流式响应依赖释放，定位连接池耗尽和历史持锁连接；完成后重新容量对照。未验证真实模型和浏览器。不能以 WAL 下低负载通过宣称全部根因消除或容量提升。

SQLite WAL 行为参考：https://www.sqlite.org/wal.html
