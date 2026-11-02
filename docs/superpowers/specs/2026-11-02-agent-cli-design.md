# Coding agent CLI 与浏览器渲染接口设计

状态：用户于 2026-11-02 确认实施，首版已实现。代码基线为 `ee78645`，工作区另有已实现但未提交的分页、拖拽和 Sprite 预览；本次实现保留了这些改动。使用入口见 [CLI 使用说明](../../agent-cli.md)，验收记录见实施计划。

## 目标与已确认方向

让 coding agent 可以检查 ANM、修改单个脚本、运行 VM，并生成 PNG/GIF 查看结果。网页与命令行共用现有格式、VM 和 WebGL 实现。

用户已同意以下方向：核心 CLI 不依赖浏览器；渲染接口可由 agent 已有的浏览器工具调用；一条命令导出使用环境中已有的 Playwright 和浏览器。不自动安装 Playwright、不下载浏览器，不读取 agent 私有配置来猜测环境。

下面的命令、文件划分和本机结果传输方式随实施计划获确认；实际验证情况在计划中记录。

## 调研结论

| 能力 | 当前入口 | 对计划的影响 |
| --- | --- | --- |
| 格式读写 | `src/format/anm-v8.js`、`anm-v8-write.js` | 纯 Node 可用；直接传 Buffer，不传其 `.buffer` |
| 脚本文本 | `src/asm.js`、`src/thanm-syntax.js` | 复用 raw/thanm 两种脚本语法，不实现完整 thanm 文件语言 |
| 宿主与 VM | `src/host/manager.js` | 使用现有 manager，保留子 VM、帧尾和固定初值随机流 |
| 图像渲染 | `web/src/player.js`、`gif-export.js` | 依赖 Canvas/WebGL，增加薄浏览器入口；不重写原生渲染器 |
| Sprite 图片 | `decodeThtx` 与 `SpritePreview.vue` | 从当前 entry 原始贴图取像素；资产 PNG 保留透明度，不烘焙棋盘格 |
| 构建 | `vite.config.js`、`scripts/postbuild.mjs` | 在现有构建中增加独立 agent 页面，不加载编辑器或 Vue 页面状态 |

重要的代码事实：

- script/sprite 参数一律是跨 entry 的全局运行序号，原始 `id` 仅作元数据，可以为负。
- 单脚本替换不能调用 `web/src/doc.js:docToBytes`：该函数会重新汇编全部脚本。`tests/vm-core.test.js` 使用的 timing 夹具实际含参数数目不同于正式签名的指令；CLI 必须让未编辑脚本保持原始指令数组。
- `buildAnmFile` 保留模型已解析的元数据、ID、无贴图状态和整块 THTX 字节，但会重建布局、偏移和结束标记。不是字节级原址编辑，不承诺任意文件逐字节不变。
- 文本格式也不承诺任意位模式无损：当前 emit/parse 对未使用的 mask 位、浮点负零、非有限浮点及未知负 opcode 有限制。raw 文本的数字跳转不会随插入自动调整；默认推荐 thanm 标签语法。
- 非 ASCII entry 名的读写编码、未建模保留字段也是既有限制。本计划记录这些限制，不因此改造文件格式或新增通用修复机制。
- `flattenFile` 会解码全部贴图，因此 inspect/dump/replace 不调用它；run/动画渲染沿用现有解码范围。
- `spawn()` 不执行脚本；第一次 manager.step 才执行 time=0。图像帧号与 manager 步数必须分别定义。
- VM 有父子循环引用、函数和脚本表，JSON 输出使用明确字段投影；不直接 stringify VM。

## 方案比较与推荐

| 方案 | 主要取舍 | 结论 |
| --- | --- | --- |
| 项目统一安装 Playwright 与浏览器 | 容易固定环境，但重复安装，不符合复用用户环境的偏好 | 不采用 |
| CLI 只调用外部 Node Playwright | 一条命令方便，但只有浏览器工具或 Python Playwright 的 agent 无法直接用它 | 作为可选适配器 |
| 核心 CLI＋浏览器 JS 接口＋可选适配器 | 多一个薄渲染页面，但覆盖已有工具和已有 SDK 两种环境 | 推荐 |

Playwright 支持本机 Chrome/Edge channel，也允许明确指定浏览器可执行文件；自定义 Chromium 版本不能保证兼容。Node 中“全局装过包”不等于 ESM import 能解析到它，应允许明确给出模块目录。[Playwright 浏览器支持](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)、[launch 参数](https://playwright.dev/docs/api/class-browsertype#browser-type-launch)、[Node 模块解析](https://nodejs.org/api/esm.html#no-node_path)。

agent 只有平台浏览器工具时，使用页面 JS 接口；不尝试从 CLI 反向调用其 MCP 工具。现成工具需要具备执行页面 JS 的能力，并能访问本机渲染服务。不同容器或远程浏览器的 localhost 不一定相通，网络转发由运行环境处理。[Playwright 页面执行模型](https://playwright.dev/docs/evaluating)。

CDP 也可连接既有 Chromium，但范围和能力不同；第一版不增加第三套连接模式，有明确使用场景后另议。[CDP 支持与限制](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)。

## 系统边界

```text
bin/anm.mjs → cli/main.js → cli/core.js → 现有 src/ 格式、汇编、宿主
                     ├→ cli/render-server.js → 本机静态 agent 页面与结果文件
                     └→ cli/browser-runner.js → 环境提供的 Node Playwright
                                                   ↓ 调用同一页面 JS API
web/agent.html → web/src/agent-api.js → 现有 player / GIF、PNG、Sprite 导出
网页 Vue 组件 ─────────────────────→ 同一播放器及图像导出逻辑
```

Node 侧使用 Node 22 和内置 fs/path/http/util/module；不引入 CLI 框架或声明 Playwright 为依赖。现有 gifenc/Vite 用于浏览器资源构建；文本命令无需 npm ci 或网页构建。

首版从本仓库执行 `node bin/anm.mjs ...`，另加 `npm run anm -- ...` 别名；不改变 package.private、不发布 npm 包。以下 `anm` 是入口的简写。

## 命令与输出契约

| 命令 | 首版行为 |
| --- | --- |
| `anm inspect input.anm [--json]` | entry/script/sprite 元数据与全局序号，不输出贴图像素或全部指令 |
| `anm script dump input.anm --script 7 [--syntax thanm\|raw] [-o script.txt] [--json]` | 默认 thanm；无 -o 输出脚本文本，JSON 模式将文本置于 data.text |
| `anm script replace input.anm --script 7 --source script.txt -o edited.anm [--syntax thanm\|raw] [--force] [--json]` | 仅汇编指定脚本，保留其原始 ID，其余脚本原样参与结构重建 |
| `anm run input.anm --script 7 --steps 60 [--position 0,0] [--json]` | manager 推进指定步数，输出根 VM 最终状态及当前活跃 VM 摘要 |
| `anm serve input.anm --out-dir ./renders [--port 0] [--force] [--json]` | 前台运行本机渲染服务，输出 URL，交给 agent 自己的浏览器工具 |
| `anm render input.anm --script 7 --frame 60 -o preview.png [...]` | 可选适配器生成一个动画 PNG |
| `anm gif input.anm --script 7 -o demo.gif [...]` | 可选适配器生成动画 GIF |
| `anm sprite input.anm --sprite 7 -o sprite.png [...]` | 可选适配器生成原尺寸静态切片 PNG |

通用约定：

- `--json` 的成功输出为单个 `{ok:true,data,warnings:[]}`，失败为 `{ok:false,error:{code,message,details?}}`；进度和日志只写 stderr。serve 启动后只输出一次 ready JSON，后续日志仍走 stderr。
- 退出码：0 成功；2 参数用法错误；1 文件、汇编、运行或渲染失败。serve 正常终止关闭服务；具体信号退出遵循 Node 惯例。
- 首版错误 code 使用 USAGE、INPUT_READ_FAILED、ANM_PARSE_FAILED、ASSEMBLY_FAILED、OUTPUT_EXISTS、OUTPUT_WRITE_FAILED、RUN_FAILED、ASSETS_NOT_BUILT、BROWSER_UNAVAILABLE、RENDER_FAILED；WebGL 缺失归 RENDER_FAILED，并在 message 说明原因。不建立复杂异常框架。
- 现有输出默认拒绝覆盖；`--force` 明确允许。replace 要求不同于输入的输出路径，首版不提供原地编辑、备份或恢复队列。
- 汇编错误和必要的二进制字段范围错误（例如 s16 时间溢出）不写输出文件；不扩大成全文件修复框架。
- inspect 的 JSON 含 summary、entries、scripts、sprites；script/sprite 记录含 index、entryIndex、indexInEntry、id，原始指令及 rgba 不在 inspect 输出中。
- run 默认 entityPos=(0,0,0)，steps=0 不执行，steps=1 执行一次；根 VM 被回收后仍报告其最终状态。摘要保留原始数值，不套用网页的四位小数格式。
- run 摘要字段为 scriptIndex、pc、time、alive、i/f、pos/rotation/scale、spriteId、layer、flagsLo/flagsHi；根状态单列。子 VM 的 scriptIndex 按指令数组引用反查。
- 未知 opcode 的既有 no-op 行为和不支持的系统／几何行为不得被宣称为完整支持。run 可报告文件中的未注册指令；绘制跳过项转换为无循环引用的 warnings，并注明是最终帧的诊断。

## 渲染参数与复用

动画默认画布 640×480、position 为画布中心、黑底、固定 60Hz 推进。`--position x,y` 可覆盖默认值；与 run 对照时显式传同一位置。

- render 的 `--frame F` 是从 0 起算的图像帧，执行 F+1 次 step 后取图。要求 F 为非负整数。
- GIF 默认 3 秒、20fps、循环；沿用现有 0.1–30 秒、10/20/30fps 和百分之一秒延时处理，`--once` 可关闭循环。
- 动画 PNG/GIF 支持 `--width`、`--height`、`--position`、`--crop x,y,w,h`；裁剪在完整渲染后执行，原点左上，不移动动画坐标。
- Sprite PNG 只依赖对应 entry 的解码，保留 alpha；尺寸取 ceil(w/h)，不使用网页的四倍展示放大或棋盘背景。无内嵌图、非正宽高时返回明确错误；静态越界部分透明。
- 新 PNG 导出与现有 GIF 共用必要的像素读取、裁剪和上下翻转逻辑；仅抽出两者实际需要的 capture 小模块，不调整 VM 或渲染模式实现。
- 每次渲染使用独立 manager/canvas，固定初值随机流，包含脚本生成的子／根 VM。运行时异常终止该次导出；现有 skipped 行为以 warnings 报告，不伪称完整真机画面。

## 自有浏览器工具模式

`serve` 使用 Node HTTP，只绑定 127.0.0.1，port=0 由系统选端口。读取明确指定的一个 ANM，仅提供构建后的 agent 页面、必要静态资源和结果保存入口，不提供任意文件浏览。

在现有 Vite 多入口构建中增加 `web/agent.html`，产物为 dist/agent.html。缺产物时返回 `ASSETS_NOT_BUILT`，提示先运行 npm ci / npm run build；不隐式构建或安装。沿用 /live-anm/ 默认 base；自定义 BASE_PATH 构建时，通过 serve/render/gif/sprite 的 `--base` 传入同值。

页面公开：

```js
window.liveAnm.ready; // Promise，读取当前 ANM 后可用
await window.liveAnm.renderFrame({ scriptIndex: 7, frame: 60, output: 'preview.png' });
await window.liveAnm.exportGif({ scriptIndex: 7, duration: 3, fps: 20, output: 'demo.gif' });
await window.liveAnm.exportSprite({ spriteIndex: 7, output: 'sprite.png' });
```

三个调用均接受上述适用的画布／位置／裁剪参数，返回与 CLI 一致的结果对象。图片 Blob 直接 POST 回同源服务，由服务写入指定 out-dir；HTTP 保存结果只返回 `{path,bytes}`，页面 API 再合并实际渲染所得的 mimeType、width、height（GIF 另有 frames/duration）等元数据。服务不需要另装图片解码器。不把大段 base64 或二进制塞进 agent 的工具文本结果。

API 中 position 使用 `{x,y,z}`（z 默认0），映射到播放器 entityPos；crop 使用 `{x,y,width,height}`，坐标为画布左上原点的整数。GIF 的 loop 为布尔值，结果 duration 是实际编码延时累计后的秒数，frames 是实际输出帧数。

HTTP 只需 input GET、静态资源 GET、artifact POST：文件名限定为单个 .png/.gif basename，输出目录由启动命令决定；POST 校验同源 Origin。复用 CLI 的覆盖约定。不加入账户、会话数据库、任务注册表、排队、自动重试或恢复协议；调用方按顺序 await。

serve 是当前任务的前台进程，Ctrl+C 退出；不注册后台守护进程，不改 VPS、代理或现有发布配置。浏览器页可显示简短 ready/错误文本，不加载编辑器，也不借用 IndexedDB 草稿。

## 可选一条命令模式

render/gif/sprite 接受 `--playwright-module /绝对路径/node_modules/playwright`，也允许包入口文件及 playwright-core。无该参数时只尝试从调用方 cwd 正常解析已存在的 playwright 或 playwright-core；不扫描全盘／全局配置，不执行 npx 安装。

通过 createRequire.resolve 得到包入口，再用文件 URL 动态导入，兼容常见 CJS default / ESM 导出，并确认 chromium.launch 可调用。不会误把 Python Playwright 当作 Node 模块；Python 环境可使用 serve＋页面 API。

浏览器选择：`--browser-path` 明确指定可执行文件，或 `--channel chrome|msedge` 使用已安装产品，两者互斥；均不指定时使用这个外部 Playwright 已有的 Chromium 默认配置。模块或浏览器不存在即失败并给出设置方法，绝不自动下载。

适配器启动本次服务和独立浏览器，等待 ready，只调用页面 API；结束关闭自己创建的页面、浏览器和服务，不接管用户的普通浏览器资料或现有标签。没有可用 WebGL 时明确失败，不另建原生 GL 兼容层。

## 验证与明确暂缓项

核心命令的永久测试只覆盖新增契约：全局序号、多 entry 单脚本替换、未编辑特殊指令及 THTX 保留、错误不写出、JSON/退出码、VM 步数与根状态。HTTP 测试使用真实本机服务和临时目录，不搭建新的大范围端到端环境。

有现成环境时，用一个合成 ANM 直接调用浏览器 API，验证带方向差异的 PNG 裁剪、GIF 解码及透明 Sprite 输出。PNG/GIF 用环境已有的独立解码能力核对尺寸、像素与时长。不点击网页编辑器、不跑交互流程；云端 CI 不新增浏览器下载或耗时工作流。

实施实测：Node v22.22.1；默认测试 399 项，398 通过、1 跳过。本仓库 cwd 无法直接解析 Playwright，按用户要求搜索机器后找到已有 Playwright 1.63.0 与缓存 Chromium 1243；无需安装即可启动。真实页面 API 验证了 PNG 裁剪与上下方向、Sprite 透明度、GIF 的 3 帧及 30/40/30ms 延时和循环，并通过完整 CLI 生成 PNG。未自动操作网页编辑控件，未新增浏览器 CI。

暂缓：MCP Server、npm 发布、原生无浏览器渲染、CDP 适配、远程服务部署、批量任务队列、任意格式位级无损重写、系统 ascii.anm／缺失渲染模式补齐。它们不是完成首版的前置任务。

## 一手资料

- [Node parseArgs（20 起稳定）](https://nodejs.org/api/util.html#utilparseargsconfig)
- [Node createRequire](https://nodejs.org/api/module.html#modulecreaterequirefilename)
- [Playwright Library](https://playwright.dev/docs/library)
- 浏览器、模块解析、页面执行与 CDP 的具体依据见前文对应链接。资料访问于 2026-11-02；设计提案与已验证事实已分别标明。
