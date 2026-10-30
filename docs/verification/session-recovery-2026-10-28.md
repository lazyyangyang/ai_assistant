# 页面刷新后的登录恢复

日期：2026-10-28。用户要求刷新网页保持登录，同时保留标签页独立登录，禁止 Access Token 写入 localStorage。

## 实现

- Access Token 和用户资料只在页面内存；sessionStorage 的 `ai-career-session-id-v1` 仅保存认证 sid，不保存 Token、刷新凭证或用户资料。
- 初始化时只有 Navigation Timing 类型为 `reload` 且 sid 格式有效才进入 `restoring`。普通新导航、back_forward 新文档及无法识别的类型清除可能复制的 sid，要求登录。SPA 跳转不重新初始化；存活 BFCache 文档沿用原有重新验证流程。
- AuthProvider 挂载后去重调用 `restore()`：按 sid 定向 refresh，验证返回 sid/JWT 一致性，然后 GET /auth/me。用户资料加载成功后才允许业务请求，保留原路由。
- 不需要后端接口或数据库结构变更。原有 HttpOnly、SameSite=Strict、精确 Path 的刷新 Cookie 和固定会话有效期不变。
- 恢复时 401 清除本页恢复记录；网络、超时、403、5xx 等保留记录并允许重试或放弃。放弃只是清除本页关联，不宣称撤销服务器会话。迟到响应不得复活已放弃的身份。
- 退出开始即清除恢复记录，防止退出结果未知时通过重载绕过暂停。显式重新验证成功才重新保存 sid。认证失效也清除记录；实例销毁保留记录以允许重载恢复。
- sessionStorage 不可用时登录仍可在本页使用，不把凭证降级写入其他存储；刷新后可能需要重新登录。
- 刷新恢复登录不恢复内存中的 JD、未提交草稿或聊天选择。

## 实际验证

- 前端全量 Vitest：11 个文件、42 项通过；修正构造函数语法后再次跑认证相关 3 个文件、23 项通过。
- `pnpm run build`：通过。第一次构建发现 erasableSyntaxOnly 不允许参数属性，已改成普通字段赋值后通过。
- 改动相关 ESLint：通过；`git diff --check` 通过，存在仓库原有 CRLF 提示。
- 真实浏览器：Playwright chromium 项目使用已安装的 Edge，报告版本 `156.0.4314.50`。`tab-session-isolation.spec.ts` 9 项全部通过。
- 浏览器用例包含：不同账号在同一 browser context 中登录和刷新恢复；刷新后 sid 不变；存储只有 sid 无 Access Token；退出一页另一页仍可恢复；新页不自动登录；带 opener 新开页面清除复制的 sid，随后重载仍未登录；恢复 503 后重试；服务端撤销后重载回登录；原有业务 401、JD 隔离、旧响应和退出失败回归。
- 浏览器报告：`frontend/test-results/3077ad99-4e9b-4bf9-a7f8-531593b7d36e/report/index.html`。
- 使用现有隔离 E2E 服务，在上述 test-results 目录建立测试数据库。认证、Cookie 和业务持久化走真实后端，AI/语音边界为夹具；未操作开发数据库、未调用真实模型。

## 环境问题与未覆盖范围

- 首次沙箱内 Vitest 因临时文件 rename EPERM 未执行测试；经审批在沙箱外重跑通过。
- 沙箱内 Playwright 启动长时间无输出，已终止该测试；沙箱外默认 Chromium 因未安装对应 headless shell 未能运行。随后改用现有 Edge 通过，未安装新浏览器。
- 未验证 Firefox、WebKit、手机、浏览器菜单“复制标签页”、关闭后恢复标签页、浏览器重启恢复。这些生命周期可能复制 sessionStorage，且导航类型依浏览器实现而异；不能把 reload 检查当作在所有浏览器中区分复制和刷新身份的绝对保证。
- 正常新建页和 opener 新开页的隔离已验证；这是应用行为隔离，同源恶意脚本或手工复制会话选择信息不属于隔离安全边界。
- 本轮没有修改后端，因此没有另跑后端全量 pytest；不能将上述夹具 E2E 结果称为真实 AI 联调。
