# AI Career 标签页独立登录改造方案

> 2026-10-28 更新：用户已要求整页刷新保持登录。当前实现仅把认证 sid 保存到 sessionStorage，Access Token 仍在内存；reload 时定向 refresh → /me，普通新导航清除可能复制的 sid。恢复期间阻止业务操作，失败可重试或重新登录，退出开始清除恢复记录。下文“首版”中的整页刷新重登录规则与仅内存 sid 描述为历史设计，已由此更新取代。实现边界与本轮验证见 [恢复机制记录](verification/session-recovery-2026-10-28.md)。

日期：2026-10-27。状态：代码已实施，完整验收尚未完成。实际覆盖见 [本轮记录](verification/tab-session-isolation-2026-10-27.md)。目标是在同一浏览器中，让不同标签页分别登录不同账号，登录、Token 刷新和退出互不干扰；同一账号的服务端简历变更通知其他标签页更新显示，不同账号的业务数据保持隔离。

推荐首版采用内存保存当前会话选择信息、按会话路径保存 HttpOnly Refresh Cookie、显式指定会话的刷新和退出接口。删除跨标签页凭证共享；保留单页请求去重和过期请求保护。SQLite 继续使用，无须为此引入分布式存储。

## 产品行为和取舍

| 场景 | 首版设计行为 |
| --- | --- |
| 标签页一登录 A，标签页二登录 B | 各自保留账号、简历、聊天和 JD 上下文 |
| 标签页一退出 | 仅撤销一的登录会话；二继续工作 |
| 两个标签页登录同一个账号 | 创建两个独立登录会话；单个退出不退出另一个 |
| 同账号标签页 B 上传或修改简历 | A 收到数据变更通知，用自己的 Token 重新拉取列表；不切换账号或自动更换当前使用的简历 |
| 从当前页面打开新标签页、复制标签页 | 新文档无内存凭证，必须自行登录 |
| 当前标签页内 React Router 跳转 | 保持会话；路由跳转不销毁全局认证实例 |
| 页面持续打开、Access Token 将过期 | 用本会话的 Refresh Cookie 自动刷新 |
| 手动刷新整个页面、浏览器恢复关闭的标签页 | 重新登录；不扫描浏览器 Cookie 恢复身份 |
| 注册成功 | 保持现有行为：创建账号后到登录页 |
| 关闭标签页 | 内存状态消失；服务端会话按固定有效期过期，不承诺关闭即成功退出 |

“刷新 Token”和“刷新网页”是两个动作。首版支持前者；为保证新文档不会继承其他标签页身份，后者重新登录。这是建议的产品取舍，不是已经实现的行为。

如果产品必须保留网页刷新后的登录，可把会话选择信息放入 sessionStorage；但复制标签页、带 opener 打开页面和浏览器恢复可能复制或恢复存储。不能声称 sessionStorage 天然保证每个新标签页为空。可以用 Web Locks 检测正在占用的会话，但原标签页已关闭或被冻结等情况下，仅凭锁和存储无法无条件区分刷新与复制。该扩展必须另行确定“恢复登录提示”或允许继承的规则，再验收，不能偷偷作为首版降级。[MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)、[MDN Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)

## 当前代码中的耦合

| 位置 | 现有行为 | 需要修改 |
| --- | --- | --- |
| `frontend/src/lib/authSession.ts` | 全站同一个 BroadcastChannel 传播 login、token、logout；全站 Web Lock；新页询问其他页 Token | 删除账号和凭证跨页传播，换成页内协调 |
| `frontend/src/contexts/AuthContext.tsx` | 启动立即调用 refresh 恢复共享身份 | 启动完成后为未登录；只有当前页登录过才可刷新 |
| `backend/app/routers/auth.py` | 单一 `ai_career_refresh` Cookie，Path 为 `/api/auth` | 新 Cookie 名与会话专属 Path |
| 同上 `issue_session` | 登录先撤销旧 Cookie 对应的会话 | 登录创建独立会话，不撤销其他标签页会话 |
| 同上 refresh、logout | 根据全局 Cookie 找会话 | 显式提供 session_id，匹配该会话 Cookie 与数据库 |
| `frontend/src/lib/jdStorage.ts` | `localStorage['saved_jd_result']` 为所有账号共用 | 改为当前登录会话内存缓存；退出和换号清空 |

## 凭证与 Cookie 设计

三个值各有职责：`user_id` 是账号身份，`session_id` 是一次独立登录会话，Refresh Token 是刷新会话所需的秘密。聊天 session_id 仍与认证会话无关。

| 数据 | 保存位置 | 生命周期 |
| --- | --- | --- |
| Access Token | 当前页面 authSession 内存 | 短期，到期前刷新；整页重载消失 |
| 当前认证 session_id | 当前页面 authSession 内存 | 登录至退出或整页重载 |
| Refresh Token 原文 | 浏览器 HttpOnly Cookie | 固定有效期或显式退出 |
| Refresh Token 哈希 | 数据库 auth_sessions | 有效期内保留；退出删除 |
| 用户信息、JD、选中简历与草稿 | React 状态或本页会话缓存 | 退出、账号切换时清空 |

示例中 SID_A、SID_B 实际使用服务端生成的不可预测 ID：

```text
标签页一：内存 { session_id: SID_A, access_token: TOKEN_A }
Cookie：ai_career_tab_refresh=REFRESH_A
        Path=/api/auth/sessions/SID_A/; HttpOnly; SameSite=Strict

标签页二：内存 { session_id: SID_B, access_token: TOKEN_B }
Cookie：ai_career_tab_refresh=REFRESH_B
        Path=/api/auth/sessions/SID_B/; HttpOnly; SameSite=Strict
```

HTTPS 设置 Secure，省略 Domain，避免扩大作用域。开发 localhost 保持配置化。两个 Cookie 虽同名，但 Path 不同，不相互覆盖。刷新 A 的 URL 只匹配 A 的会话路径；末尾斜线避免路径前缀歧义。新名称与旧 `ai_career_refresh` 分离。

Cookie 仍由浏览器共享，Path 只是控制请求携带范围，不是防范同源恶意脚本的安全隔离边界。必须用路径 session_id、Refresh Token 哈希、数据库会话共同验证；不能只知道 session_id 就刷新或退出。HttpOnly 阻止脚本读取 Cookie 原文，并不阻止同源脚本发请求。[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

这提供正常应用行为上的标签页隔离，不承诺将同源 XSS 或手动复制凭证的标签页当作独立安全域。

## 接口契约

| 接口 | 入参和鉴权 | 返回及效果 |
| --- | --- | --- |
| POST `/api/auth/register` | 原注册字段与 CSRF/Origin 校验 | 201 用户信息；无登录会话 |
| POST `/api/auth/login` | email、password；CSRF/Origin 校验 | 200 TokenResponse 增加 session_id；设置该 session 的 Cookie |
| POST `/api/auth/sessions/{session_id}/refresh` | 指定路径；该路径 Refresh Cookie；CSRF/Origin | 200 同一 session_id 的新 Access Token；不延长固定有效期 |
| POST `/api/auth/sessions/{session_id}/logout` | 指定路径；该路径 Refresh Cookie；CSRF/Origin | 204；仅删除该会话及精确 Path 的 Cookie |
| GET `/api/auth/me` 及业务接口 | Authorization Bearer | 保持现有 sid、用户及会话有效性检查 |

登录响应示意：

```json
{
  "access_token": "<JWT>",
  "token_type": "bearer",
  "expires_in": 900,
  "session_id": "<服务端创建的会话ID>"
}
```

900 仅为示例，实际保留现有有效期配置。刷新时检查响应 session_id、JWT sid 与发起请求的会话一致。响应不一致立即拒绝，不用返回 Token 切换当前账号。

刷新验证顺序：校验 ID 格式 → 查数据库 session → 检查 Cookie 哈希及过期时间 → 检查用户存在 → 签发带该 sid 的 Token。业务接口继续通过 `get_current_user` 验证会话与归属，不通过 Cookie 或前端 user_id 选择用户。

退出时：有效 Cookie 必须匹配目标会话才可删除；会话已不存在或已过期可以幂等返回 204 并清理目标路径 Cookie。目标有效但 Cookie 缺失或不匹配时拒绝，不删除任何会话。Access Token 过期不应阻止凭有效 Refresh Cookie 退出。

登录失败不改变任何已有 Cookie。登录成功但 Cookie 被浏览器拒绝时，首次刷新返回认证错误并要求当前页重新登录，绝不能寻找另一个 Cookie 顶替。

## 前端流程与并发规则

页面启动：创建独立 authSession 实例，user=null，loading 在初始化后结束；不调用全局 refresh，不向其他标签页请求 Token。开发热更新也按新认证实例处理，不隐式保留跨实例凭证。

登录：表单 → useLoginPage → AuthContext.login → apiLogin → 后端创建会话 → 浏览器保存定向 Cookie → 前端保存 session_id 与 Token → /me → 更新当前页 user → 首页。

刷新：提前 60 秒刷新、本页共享 pending Promise、请求 401 最多刷新重试一次等逻辑保留；URL 使用请求开始时捕获的 session_id。移除认证 BroadcastChannel、askPeer 和固定名称 Web Lock，改用页内 Promise 队列协调 login、refresh、logout。保留 epoch/revision 思路，防止旧请求迟到污染新身份。业务数据通知使用下面的独立频道，不接入认证状态机。

退出：先阻止当前页发出新业务请求，等待已开始的认证操作结束，再请求当前会话 logout；成功后清空凭证、用户与业务状态。退出失败保留当前身份并展示可重试错误，不宣称服务器已撤销会话。Cookie 按 session 路径隔离，不会删除 B 的 Cookie。

首版账号切换要求当前页先退出，再登录另一个账号；不要在 A 会话仍活动时直接创建 B 并遗留 A。登录/注册页面对已登录用户显示当前账号和退出入口。其他标签页无需退出。

业务请求捕获 epoch 和 sid：身份变化后，未发出的请求取消；旧响应不得更新新的页面。中断 SSE、上传、转写请求并释放录音/音频资源；取消错误沿用现有语义，不显示普通失败。后端已开始的请求可能已产生数据库写入，前端取消不能承诺回滚。

BFCache 恢复需在恢复事件处理时验证本页会话有效性，验证前不提交新业务操作；不要仅通过卸载事件保证退出。后台页唤醒仅刷新自己的会话。

## 业务数据隔离

认证独立之外，必须同步处理客户端数据。JD 改为页内会话缓存，由认证 session_id 隔离；A 保存的 JD 不能被 B 的诊断和面试 Hook 读取。首次升级忽略旧 localStorage 全局 JD，不把其内容自动归属给任何账号，也不擅自删除原数据。

AuthContext 身份改变时重新初始化业务页面状态：清除聊天消息、活动聊天 ID、选中简历、诊断全文、报告、待发送草稿和播放地址。可以在受保护业务子树使用认证 session_id 作为 key，让换号时明确卸载旧业务组件；同会话 Token 刷新不改变 key。

深浅主题等非敏感偏好可继续跨标签页共享。服务端简历和聊天仍按 user_id 校验：同账号不同标签页看到相同服务端数据是正常行为，登录会话隔离不等于复制一套业务数据库。

## 同账号简历变更通知

登录会话按 session_id 隔离，服务端简历按 user_id 共享。不同标签页可以持有不同会话，但 user_id 相同就应看到同一份服务端简历列表。当前 useResumePage 只在挂载及本页写操作后加载列表，useInterviewPage 仅在挂载时加载，因此还需要增加跨页数据变更订阅。

首版新建 `businessEvents.ts`，在 /me 成功后加入 `ai-career-data-v1:{userId}` 频道，退出或换号时关闭。使用 BroadcastChannel 传递“数据可能已变化”的通知，不传播 Token、Cookie、认证 session_id、简历正文或文件内容。频道名和 userId 过滤只是消息路由，不是授权边界；每次重新拉取仍用接收标签页自己的 Token，由服务端验证归属。[MDN Broadcast Channel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)

通知结构示例：

```json
{
  "version": 1,
  "type": "resumes.changed",
  "eventId": "<随机事件ID>",
  "sourceTabId": "<本页内存随机ID>",
  "userId": "<操作时已认证用户ID>"
}
```

sourceTabId 用于排除本页事件，不是认证凭证；消息不携带可请求的任意 URL，接收方只接受固定事件白名单。无需在前端根据消息内容直接增加或删除列表记录，数据库返回的列表始终是依据。

完整流程：B 的上传接口在数据库提交后返回成功 → B 立即发布 resumes.changed 并使本页列表失效 → A 验证消息格式和当前 userId → A 调用 apiGetResumes → /resumes 按 A 的 Token 查询当前用户数据 → 更新 A 的简历列表和面试选择列表。

上传、新版本保存、删除、设为当前都发布同一种失效事件。只在写请求成功后发布；应在随后的本页列表刷新之前发布，以免列表刷新失败掩盖已成功写入。写请求结果未知时不假称成功，通过重新拉取确认；发布失败不得让已成功上传显示为上传失败，也不能自动重传文件。业务写操作开始时捕获 userId 和身份版本，返回时如已换号，不把旧账号操作通知发到新账号频道。

接收方只刷新数据，不再次广播，避免循环。共享 useResumesData 或 ResumeDataProvider 统一给简历页和面试页供数；其缓存以当前身份隔离。连续事件合并，例如 200 ms 内合并；请求进行中收到新事件时记录 dirty，当前请求完成后再拉一次，不能漏掉后续写入。旧请求序号和身份版本不匹配时丢弃响应，不用消息时间戳判断服务端版本。

| A 的状态 | 收到通知后的显示规则 |
| --- | --- |
| 简历列表可见且网络正常 | 自动重新拉取，显示新增或更新记录；可显示轻量“简历列表已更新”提示 |
| A 已选择某个仍存在的简历 | 保持选择，不因 B 上传新简历或设为当前就强制切换 |
| A 尚无选中简历且未开始业务 | 按服务端当前简历或首条选择；空列表保持空态 |
| 当前选中简历被 B 删除 | 清空失效选择，提示重新选择；禁止后续携带已删除 ID 发起新请求 |
| A 正在面试或生成诊断 | 不重建聊天、不清草稿、不自动更换上下文；若选中简历被删除，保留已经发出的请求，提示并阻止继续使用失效 ID |
| A 正在填上传表单 | 更新列表，不覆盖标题、已选文件或未提交输入 |
| A 在其他路由或后台 | 标记数据过期，进入相关页面或恢复可见时重新拉取 |
| A 当前会话过期或已退出 | 走本页原认证失效流程，不借用 B 的 Token；清理订阅 |

BroadcastChannel 不提供持久化事件重放。页面挂载、重新变为可见及网络恢复时重新校验列表；失败保留旧数据并标记“更新失败，可重试”。这也补偿后台挂起、事件漏收或写入成功后发送页立刻关闭的情况。健康前台双页的验收目标是写成功后 2 秒内开始更新或展示刷新状态，完成时间取决于接口；后台页不承诺立即渲染。

本期范围为同浏览器、同源、同存储分区的标签页。跨浏览器、跨设备以及没有经过前端通知的后台写入不保证实时推送，访问/恢复时重新加载可发现变化；若后续要求实时跨设备通知，再设计经过认证的服务端 SSE/WebSocket。现有聊天 SSE 只服务聊天，不自动承担简历变更订阅。

## 文件改动清单

| 文件 | 计划变更 |
| --- | --- |
| `frontend/src/lib/authSession.ts` | 增加当前 sid，删除广播与跨页锁，页内串行认证和刷新去重，保留 epoch |
| `frontend/src/lib/http.ts` | 更新认证 URL 匹配，所有定向刷新/退出加 CSRF；保留取消、401、流、Blob、FormData 行为 |
| `frontend/src/lib/api.ts` | TokenResponse 增加 session_id，refresh/logout 构建定向 URL |
| `frontend/src/contexts/AuthContext.tsx` | 移除无条件启动恢复；绑定本页身份和状态清理 |
| `frontend/src/App.tsx` 与业务 Hooks | 账号切换卸载旧业务状态；登录页已有身份提示 |
| `frontend/src/lib/jdStorage.ts` 与 JD/简历/面试 Hooks | 改为会话内存缓存，退出清空 |
| `frontend/src/lib/businessEvents.ts` 新增 | 独立业务频道、消息白名单、事件去重、按 userId 订阅与清理；不传凭证 |
| `frontend/src/hooks/useResumesData.ts` 新增及简历/面试 Hooks | 统一列表失效与重载，身份及请求序号保护，保留当前选择和草稿 |
| 简历写操作封装或业务服务 | 上传、删除、新版本、设为当前成功后统一发布事件；不要在多个层次重复发布 |
| `backend/app/routers/auth.py` | 新路径和 Cookie 工具；登录不撤销其他会话；定向校验与清理 |
| `backend/app/schemas.py` | 登录/刷新响应增加 session_id，注册保持 UserOut |
| `backend/app/deps.py` | 保留 JWT sid 与数据库会话绑定验证；核对撤销即时生效 |
| 前后端认证、聊天与语音测试 | 更新登录助手及 Cookie 路径断言，加入多标签与串号用例 |
| README 与 AGENTS.md | 实现并验证后更新现有行为；本轮仅记下产品目标 |

现有 auth_sessions 已含用户、Refresh 哈希、过期时间和会话主键，首版可复用，不因本方案自动迁移数据库。可增加过期会话清理任务，但不得删除未过期的其他标签页会话。

## 升级和资源生命周期

前后端协议一同升级，旧 `/auth/refresh`、`/auth/logout` 不得偷偷改为操作某个新会话。新前端不恢复旧 Cookie；旧客户端收到明确“请刷新页面重新登录”错误。发布前安排旧会话失效步骤，优先利用现有 session 记录的创建时间划定升级前会话，或在维护窗口明确撤销旧会话；实际数据库写入须作为实施部署步骤单独执行。不能在浏览器打开页面时清空全部用户会话。

回滚同样要求重新登录，不能将多会话 Cookie 合并为“最后一个账号”。旧名称 Cookie 可按原 Path 清理，新 Cookie 只在其对应退出操作清理。

每个会话有独立 Cookie，会占用浏览器站点 Cookie 配额。Path 限制可减少普通请求携带量，但不增加浏览器配额。首版需压测多次刷新网页、重复登录导致的孤立会话；为同时有效会话数量设计可配置上限，达到上限明确提示，不自动顶掉其他活动标签页。Cookie 缺失时要求本页重登录。上线前确定有效期和上限；不能以某个固定浏览器配额为跨浏览器保证。

关闭标签页后无法可靠通知服务端撤销，保留固定过期清理；用户需要立即撤销时应使用显式退出。浏览器内存中的页面被销毁后，孤立 Cookie 不会被新页面自动选中。

## 测试和验收

浏览器测试必须在同一个 browser context 中创建多个 page，共享 Cookie 才能复现本需求。分别创建两个隔离 context 只能验证不同浏览器用户，不能证明标签页隔离。

| 编号 | 场景 | 通过条件 |
| --- | --- | --- |
| T01 | 同 context 两页分别登录 A、B | /me、简历和聊天分别对应本人；会话 ID 不同 |
| T02 | B 登录后 A 继续请求与刷新 | A 会话仍有效；两页 Token sid 不改变 |
| T03 | A 退出、重复退出 | 仅 A 会话被删除；B 可持续刷新与请求 |
| T04 | 同账号双标签登录 | 两条独立会话；退出一不影响另一个 |
| T05 | 新建页、应用新开链接、复制页 | 不主动 refresh、不继承 A、无 Token 广播 |
| T06 | 整页刷新、关闭再恢复 | 按首版规则重新登录；SPA 路由跳转仍保持登录 |
| T07 | 篡改 refresh/logout 的 session_id 与 Cookie 组合 | 不返回别人的 Token、不撤销别人的会话；sid 本身不能鉴权 |
| T08 | A、B 并发刷新及各自 401 | 各自页内去重；请求最多重试一次；无跨页等待或串号 |
| T09 | A 刷新延迟时退出，旧 /me 与 SSE 迟到 | 无身份复活，无旧数据进入新登录身份 |
| T10 | A 保存 JD，B 打开简历/面试，A 换号 | B 读不到 A 的 JD；换号后旧草稿和诊断被清理 |
| T11 | Cookie 属性、精确 Path、删除与缺失 | HttpOnly、SameSite、HTTPS Secure 正确；缺失不回退到其他会话 |
| T12 | 缺少 CSRF 头或非法 Origin | 所有 Cookie 写操作与定向刷新拒绝，现有归属检查不变 |
| T13 | 会话到期、后台唤醒、BFCache、网络中断 | 仅本页提示恢复或登录；无其他身份自动替换 |
| T14 | 旧协议客户端、新协议客户端、发布与回滚 | 不恢复错误身份；升级提示明确；旧会话处理符合部署计划 |
| T15 | 高并发页、重复登录、Cookie 配额边界 | 有限资源行为可解释，不静默撤销其他活动会话 |
| T16 | 同 context 同账号 A、B 两页，B 上传成功 | A 无须手动刷新即可看到新简历；A 的 Token、sid、有效选择与草稿不变 |
| T17 | 两页登录不同账号，或人为发送其他 userId 事件 | 不显示另一账号简历；频道消息不能绕过服务端归属校验 |
| T18 | 同账号跨页新版本、删除、设为当前 | 列表正确更新，选择规则符合上表，面试不被重置 |
| T19 | 上传失败、本地刷新失败、发送通知失败 | 失败上传无成功事件；写成功不因通知或刷新失败变成上传失败；无自动重传 |
| T20 | 事件重复、乱序、连续到达与请求迟到 | 去重合并，无广播循环；请求期间 dirty 触发补拉；最终与服务端一致 |
| T21 | A 后台、离线、漏收事件或相关页未挂载 | 恢复/进入页面后补拉；失败可重试，不误称已同步 |
| T22 | 收消息或上传期间 A 换号/退出 | 关闭旧订阅、丢弃旧响应；不向新用户频道发布旧账号事件；B 不退出 |

单元测试覆盖 authSession 状态机、URL 分类、旧响应隔离；后端测试覆盖创建与定向撤销、越权组合、数据库会话存在性；真实浏览器验证 Cookie 路径与标签页生命周期。保留现有 SSE 中文分块、取消、Blob 错误、上传和注册后登录回归。

验收必须记录 Chromium、Firefox、WebKit 实际版本；真机补充手机浏览器切后台和恢复。前端 build、相关 ESLint、Vitest、后端 pytest 与同 context 多页测试通过后，才宣称方案实现。当前后端全量测试已有一项语音夹具过短的失败，实施时应单独追踪，不能把它计为本方案测试通过。

## 实施顺序

1. 固化首版整页刷新需重登录的产品规则，补充接口契约和认证测试。
2. 实现服务端按 session 定向 Cookie 与接口；复用 SQLite 表，测试不同会话互不撤销。
3. 实现前端页内认证状态和请求保护；移除凭证广播与自动全局恢复。
4. 清理账号切换时的业务状态并改造 JD 缓存，加入独立的同账号简历变更频道和列表重载。
5. 同浏览器多页、复制、刷新、退出和语音聊天回归；完成文档与升级步骤。

本轮只交付设计，没有修改认证实现，没有执行数据库迁移或应用测试。
