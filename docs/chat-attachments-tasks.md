# 聊天附件模块待办

状态：全部待实施。范围与参数见[详细设计](chat-attachments-design.md)，验收编号见[测试方案](chat-attachments-test-plan.md)。路径为计划新增/修改位置，不代表已经存在或已完成。

## 第一阶段：可验证的上传与文本聊天闭环

| 编号 | 模块与预计文件 | 待办与完成标准 | 依赖 / 测试 |
|---|---|---|---|
| A01 | 配置与协议：`backend/app/config.py`、`.env.example`、`schemas.py` | 定义限额、状态、错误码、能力与附件 DTO；增加开关；实际依赖不可用时 capability 禁用 | 无；T01/T10 |
| A02 | 数据与迁移：`models/attachment.py`、`models/chat.py`、`models/__init__.py`、`alembic/versions/` | 新表/索引/外键/请求幂等记录；旧消息兼容；迁移升级及回退方案；不直接迁移用户库 | A01；T02/T12 |
| A03 | 存储：`services/attachments/storage.py` | 流式写入、临时与最终路径、原子发布、大小/哈希检查、空间预留与对账；禁止用户路径 | A01；T03/T09 |
| A04 | 上传：`routers/attachments.py`、`services/attachments/uploads.py`、`main.py` | 初始化、上传片、状态、complete、取消；配额原子检查；幂等、越权检查、过期；complete 排队不阻塞请求 | A02/A03；T01—T04 |
| A05 | Worker：`workers/attachments.py`、`services/attachments/jobs.py` | 持久任务、租约心跳、generation 防旧写、失败重试、取消、子进程回收；提供启动/停止说明 | A02/A03；T05/T11 |
| A06 | 解析：`services/attachments/parsers/` | TXT/MD/PDF/DOCX；正文表格顺序、页段来源、覆盖与警告、格式检测/资源限制；复用解析不引入简历副作用 | A05；T06/T09 |
| A07 | 维护：`backend/scripts/maintain_attachments.py` | 默认 dry-run，明确目标后 --execute；清过期/孤儿、释放配额、避免删除关联文件；故障对账 | A03—A05；T05/T12 |
| A08 | 前端传输：`lib/attachmentsApi.ts`、`workers/fileHash.worker.ts`、`hooks/useAttachments.ts` | 能力加载、增量哈希、分片并发、已确认进度、暂停/重试/取消、重选文件续传；复用 http/auth/operation guard，不新增 Token 存储 | A04；T03/T04/T08 |
| A09 | 输入框：`components/chat/ChatInput.tsx`、新增 `AttachmentCard.tsx`、`hooks/ChatInput/useChatInput.ts`、`lib/i18n.ts` | 文件选择/拖拽/粘贴图片入口、卡片、错误与预览、发送门槛、仅附件消息；未支持图片时说明原因；不影响语音和中文输入法 | A08；T07/T10 |
| A10 | 模型上下文：`services/attachments/context.py`、`agents.py` | full_text 预算、附件数据隔离、来源与版本记录；长文档显式拒绝，不静默截断；核验当前提供方容量 | A06；T06/T07 |
| A11 | 聊天后端：`routers/chat.py`、`schemas.py` | 发送前验证、同事务关联、请求幂等、空文本附件发送、新 SSE 事件、历史 DTO；历史附件由数据库加载；保留 JD/面试流程 | A02/A10；T07/T08 |
| A12 | 聊天前端：`hooks/useStreamChat.ts`、`hooks/ChatPanel/useChatPanel.ts`、`components/chat/ChatPanel.tsx`、`types/chat.ts`、`lib/api.ts`、面试页面 Hook | 传递附件/请求 ID、SSE 范围展示、历史卡片、流中止与失败重试；所有入口一致，不能只完成一个页面 | A09/A11；T07/T08/T10 |
| A13 | 联调发布：测试目录、README、architecture、AGENTS.md | 运行完整验收、记录证据和缺陷；按实际实现更新架构条目；部署配置、Worker 运维、备份与回滚说明 | 全部；T01—T12 |

实施顺序：A01 → A02/A03 → A04/A05 → A06/A07/A08 → A09/A10/A11 → A12 → A13。表格表示依赖关系，不代表授权后台自动并行代理。

## 第二阶段：完成其余格式及长文档体验

- [ ] B01 DOC 转换：实现受控转换适配器，验证 Windows 进程回收、宏/网络禁用与字体依赖；T06/T09/T11。
- [ ] B02 扫描 PDF 与图片 OCR：逐页任务、失败页重试、原页与识别文本对照；T06/T10。
- [ ] B03 图片理解：针对实际模型接口实现视觉输入、像素与请求大小预算、历史图片恢复；以真实接口验收，不把 OCR 当作理解图片；T07/T13。
- [ ] B04 长文档：片段检索、来源引用、分段摘要及聚合任务、上下文预览和明确模式选择；T07/T13。
- [ ] B05 参数校准：根据负载测试调整 100 MiB/500 页等默认值，说明支持容量；T11。

第一阶段通过只表示文本格式与可靠传输闭环，不表示用户要求的 DOC/图片/扫描件全部完成。完整需求交付需要 B01—B05 完成，或用户明确调整范围。

## 每项交付记录模板

`任务编号 / 实际文件 / 实现范围 / 检查命令 / 通过与失败数量 / 测试环境 / 未验证项 / 证据路径 / 剩余缺陷`。未运行不得勾选通过，Mock 与真实解析、浏览器、模型验证分列。实现前保留现有工作区改动，不默认提交、部署或迁移。
