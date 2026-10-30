# 动画初始化修正

- 未发现初始坐标错误的直接证据：静态路径与 SMIL 首关键帧一致；修正后连续三轮采样中，SVG 的 x/y/width/height 各自保持不变。身体本来就有上下 6px 的动画，不能当成布局跳动。
- 将初始化分为两阶段：先挂载完整静态 SVG，CSS 动画暂时暂停；下一次 requestAnimationFrame 后挂载四肢 animate，layout effect 将 SVG 时间设为 0，再与 CSS 动画一起放行。取消待执行回调以兼容卸载/StrictMode。未改跑姿、步频或使用固定毫秒延时。
- 用户手动暂停与减少动态效果继续分别保留；初始化后不因普通重渲染重复归零。
- pnpm run build 通过。Chrome 156.0.8078.74 与 WebKit 27.2，桌面/390px 窄屏各 14 项检查全部通过（共 56 项），包括腿形实际变化、暂停恢复、减少动态效果及手动暂停跨设置变化。业务接口模拟，无真实后端联调。
- 启动采样第一批热启动约 104/39ms；增加场景边界采样后热启动约 46/45ms。浏览器首次冷启动仍观察到约 1.5 秒等待，不能声称所有加载停顿已消除。
- 早前 Chrome 版本与本轮不同，且主动读几何数据可能影响调度；这些数字不能当成严格同条件 A/B 性能提升证明，也未确定浏览器内部根因。此修改是明确初始化顺序、避免部分场景先运行的针对性改进。
- 当前结果：frontend/test-results/browser-compat/results-chrome.json、results-webkit.json；启动数据：frontend/test-results/animation-tabs-baseline/results.json。测试服务器和浏览器均已结束。
