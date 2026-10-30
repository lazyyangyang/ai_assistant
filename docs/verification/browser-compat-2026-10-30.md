# 前端跨浏览器检查（2026-10-30）

## 结论

当前抽查范围内，Chrome、Edge 页面与基础交互正常；WebKit 页面正常，但跑步四肢路径动画失效。Firefox 因本地测试程序启动失败尚未验证。不能据此宣称所有浏览器、完整业务链路均稳定。

| 浏览器/引擎 | 版本 | 桌面 1365×900 | 窄屏 390×900 |
| --- | --- | --- | --- |
| Google Chrome | 156.0.8078.48 | 13/13 | 13/13 |
| Microsoft Edge | 156.0.4314.50 | 13/13 | 13/13 |
| Playwright WebKit | 27.2 | 12/13，四肢动画失败 | 12/13，四肢动画失败 |
| Playwright Firefox | 本地 firefox-1555 | 启动失败，未测试 | 未测试 |

合计 78 项检查，76 项通过、2 项失败。成功启动的三个浏览器/引擎中未捕获 pageerror 或页面 crash，所有检查页面有可见内容且文档无横向溢出。检查不是持续压力测试，不能证明长时间运行永远没有白屏。

## 方法和范围

- 从当前工作区构建独立生产产物，用 Vite preview 启动本地测试服务器；本轮构建成功。
- 无头浏览器实测，分别使用桌面和窄屏视口；窄屏只是桌面引擎视口模拟，不是 iOS/Android 真机。
- 公共页：首页、登录、注册；检查可见内容、横向溢出并截图。
- 深色布局：桌面通过主题按钮切换；窄屏通过测试脚本添加 dark 类，仅验证样式，不代表移动端主题入口验收。
- 动画：对实际 SVG getBBox 高度连续采样，检查腿形变化；验证暂停、恢复按钮和 reduced-motion。
- 匿名受保护路由跳转；模拟登录；通过导航进入 JD、简历、模拟面试；已登录页面刷新恢复。
- API 全部由 Playwright 模拟拦截，返回测试用户、合规格式测试 Token 和空简历/会话列表。未启动后端、未接触项目数据库、未调用真实模型。
- 本次未测试真实 Cookie、安全属性、跨页账号隔离、业务数据提交、SSE/Redis、长聊天、上传下载、真实录音/TTS、报告详情、断网恢复、老版本浏览器。
- 本次只增加测试脚本和报告，没有修改产品实现。

## 明确发现

### WebKit 四肢动画失效

在两种视口下 `CSS.supports('d', 'path("M0 0 L10 10")')` 均为 false，腿部连续四次 getBBox 高度均为 70；Chrome/Edge 支持该属性，采样高度随动画变化。

位置：`frontend/src/components/CareerTrack.css` 的 `career-stride`、`career-swing`。当前依赖 CSS `d: path(...)` 插值。WebKit 保留 SVG 原始路径，所以页面不崩溃，但四肢没有跑动；身体 transform 动画属于另一种属性，不应当据此判断整套动画已兼容。

建议改用关节分组 transform 动画，或另行验证跨引擎路径动画方案。这是功能兼容性问题，不是白屏。

### Firefox 尚无结论

测试在启动 `firefox-1555/firefox/firefox.exe` 时返回 `browserType.launch: spawn UNKNOWN`，尚未打开页面。不能将环境故障计作产品失败或通过，需要修复测试浏览器安装/执行环境后重跑。

### 语音需要独立验收

本机 WebKit 的 `MediaRecorder` 不可用，Chrome/Edge 可用；未使用麦克风。`useChatInput.ts` 在录音入口检查 getUserMedia，随后在 try/catch 中使用 MediaRecorder；缺少该 API 时存在无法录音的能力限制，不能把页面加载成功等同语音兼容。

WebKit 自动化构建不等于真实 Safari；本结果不能外推为所有 Safari 不支持 MediaRecorder。真实 Safari/macOS/iPhone 需要验证权限、录音格式、转写与播放。

## 复现与产物

- 在 frontend 目录：`node scripts/check-browser-compat.mjs`。依赖项目 Playwright、本机 Chrome/Edge 和已安装的 Playwright Firefox/WebKit。
- 可设置 `COMPAT_ENGINE=chrome|edge|firefox|webkit` 单独检查一个引擎。
- 原始结果：`frontend/test-results/browser-compat/results.json`（Edge/Firefox/WebKit）、`results-chrome.json`（Chrome）。
- 同目录包含各页面截图和生产构建。浏览器与本轮预览服务器已在测试结束关闭。
- 第一次探索运行的模拟 sid 格式不合规，导致登录失败；已修正测试数据并重跑，表格使用修正后的完整结果，不将该测试数据问题列为产品缺陷。
