# App 播放控制拆分计划

> 执行方式：当前会话内按 executing-plans 实施。

目标：按用户确认的轻量拆分范围，让 App.vue 保留页面和文件操作协调，将现有播放控制移入一个 composable。

技术路线：沿用 Vue 3、Vite 和现有 player.js，不增加依赖。

## 文件与接口

- 新增 `web/src/composables/usePlayback.js`：`usePlayback(player)` 接收播放器 shallowRef，返回 playing、frame、speed、vms、skipped、errors 和 stepOnce、play、stop。
- 修改 `web/src/App.vue`：使用上述接口，保留文件打开、重建、导出、VM 选择和执行行映射。
- 纯搬迁既有逻辑；保留计时公式、每次循环最多推进 8 帧和调用顺序。不调整模板、样式、引擎或已知画布绑定问题。

## 执行与验证

- [x] 搬迁状态、派生列表及播放方法，接回 App.vue。
- [x] 检查差异，确认重建先停止播放、spawn 与重建仍同步帧数，模板接口保持原样；只读审阅未发现本次引入的问题。
- [x] `npm test`：350 通过、1 跳过（缺少 thanm）；`npm run build` 和 `git diff --check` 通过。未新增永久测试或运行浏览器交互。
