# vendor/

`vue.esm-browser.prod.js` —— Vue 3.5.13 的浏览器 ESM 完整构建（含模板编译器，
所以 `app.js` 里可以直接写 `template:` 字符串），原样取自 npm 上的 `vue@3.5.13`。

**为什么不用 CDN**：本项目原本从 jsDelivr 取 Vue，但实测在国内网络下 `cdn.jsdelivr.net`
经常不可达（开发机上直接 SSL 断连）。播放器是个纯静态页面，为了一个依赖引入一个
随时可能连不上的外部单点不划算——160 KB 直接进库，页面从此**没有任何外部请求**，
断网也能跑。

Vue 采用 MIT 许可（© 2018-present Yuxi (Evan) You and Vue contributors）。
