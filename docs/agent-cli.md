# Coding agent CLI

需要 Node.js 22。在仓库根目录执行 `node bin/anm.mjs`，或使用 `npm run anm --` 别名。
这是仓库内工具，不需要全局安装。格式检查、脚本编辑和 VM 执行只使用 Node 内置模块及 `src/`，不需要 `npm ci` 或浏览器。

## 查看、编辑和运行

```bash
node bin/anm.mjs inspect input.anm --json
node bin/anm.mjs script dump input.anm --script 0 -o script.txt
# 编辑 script.txt，然后写入另一个 ANM：
node bin/anm.mjs script replace input.anm --script 0 --source script.txt -o edited.anm --json
node bin/anm.mjs run edited.anm --script 0 --steps 60 --position 320,240 --json
```

`inspect` 返回 entry/script/sprite 元数据。`--script`、`--sprite` 都是跨 entry 累计、从 0 开始的 `index`；原始 `id` 是另一个字段，可能为负，不能代替序号。

脚本文本默认使用 thanm 风格语法，支持标签；dump/replace 均可通过 `--syntax raw` 切换到原始指令语法。两次操作应使用相同语法。这里只处理一个脚本，不支持完整 thanm 文件语言。

replace 只汇编选中的脚本，保留其原 ID，其余脚本指令、Sprite 和内嵌 THTX 参与文件重建。语法错误会返回行号，不写输出。输出必须与输入使用不同的解析后路径；已有输出默认拒绝覆盖，`--force` 可明确覆盖。

ANM 输出会重建文件布局和偏移，不承诺任意文件逐字节保留。现有文本表示对未使用的 mask 位、负零、非有限浮点和未知负 opcode 有限制；非 ASCII entry 名及未建模的保留字段也有既有限制。raw 数字跳转不会随插入指令自动调整，编辑跳转建议使用 thanm 标签。源码注释和标签名称不会写进 ANM。

`run --steps 0` 只创建 VM；`--steps 1` 执行第一次 manager step，也就是脚本 time=0。默认宿主位置为 `(0,0,0)`。结果包含根 VM 的最终状态和仍存活的 VM 摘要，根被删除后仍可查看它的状态；数值不经过网页显示的四位小数舍入。未知 opcode 和最终帧绘制跳过项见 `warnings`，不代表所有真机渲染路径均已支持。

## 给 agent 的 JSON

加上 `--json` 后，stdout 只有一个结果对象，错误和成功均可直接解析；日志写入 stderr。若使用 npm 别名并解析 stdout，应加 `--silent`，避免 npm 自己的脚本提示。

```bash
node bin/anm.mjs inspect input.anm --json | node --input-type=module -e '
let text = "";
for await (const chunk of process.stdin) text += chunk;
const result = JSON.parse(text);
if (!result.ok) { console.error(result.error); process.exitCode = 1; }
else console.log(result.data.scripts);
'
npm run --silent anm -- inspect input.anm --json
```

```json
{"ok":true,"data":{"path":"/absolute/path/frame.png","bytes":121,"mimeType":"image/png","width":8,"height":8},"warnings":[]}
```

失败格式为 `{"ok":false,"error":{"code":"USAGE","message":"…","details":{}}}`，其中 details 可省略。退出码：0 成功，2 参数错误，1 文件、汇编、运行或渲染失败。图片直接保存到文件，结果不含 base64。

## 一条命令导出 PNG / GIF

渲染先使用项目已有依赖构建浏览器页面：

```bash
npm ci                    # 尚未安装网页依赖时执行
npm run build             # 生成 dist/agent.html 和资源
```

导出适配器复用调用环境已有的 **Node Playwright 或 playwright-core**。未指定模块路径时，从调用方当前目录正常解析这两个包；找不到时，明确传入已有包的绝对目录或入口文件。

```bash
node bin/anm.mjs render edited.anm --script 0 --frame 60 -o preview.png \
  --playwright-module /absolute/path/node_modules/playwright-core --json

node bin/anm.mjs gif edited.anm --script 0 --duration 3 --fps 20 \
  --width 640 --height 480 --position 320,240 --crop 160,120,320,240 \
  -o animation.gif --playwright-module /absolute/path/node_modules/playwright --json

node bin/anm.mjs sprite edited.anm --sprite 0 -o sprite.png \
  --playwright-module /absolute/path/node_modules/playwright --json
```

这些路径是示例，替换为 agent 环境中的真实位置。项目不安装 Playwright，不自动下载浏览器，也不扫描 agent 私有配置。默认使用所选 SDK 已有的 Chromium；可加 `--channel chrome` / `--channel msedge` 使用已安装产品，或加 `--browser-path /absolute/path/to/chromium` 指定可执行文件。两种选择互斥，浏览器版本须与外部 SDK 兼容；启动失败会返回 `BROWSER_UNAVAILABLE` 和原因。

每条命令只创建和关闭本次的独立浏览器及本机服务，不连接已有用户标签。动画导出共用当前网页的播放器，包含脚本生成的子动画，仍受现有渲染器支持范围限制。

| 参数 | 动画 PNG / GIF 行为 |
| --- | --- |
| `--width` / `--height` | 默认 640×480，整数，范围 1–65535；实际尺寸还受浏览器能力限制 |
| `--position x,y[,z]` | 默认画布中心，z 默认 0；负数起始可写作 `--position=-10,20` |
| `--crop x,y,width,height` | 默认整张画布；完整渲染后按左上原点裁剪，整数矩形必须在画布内，不移动动画坐标 |
| `render --frame F` | 默认 0，执行 F+1 次 step 后取图；frame 0 对应 `run --steps 1` |
| `gif --duration` / `--fps` | 默认 3 秒、20fps；时长 0.1–30 秒，帧率 10/20/30；延时按 GIF 的百分之一秒精度编码 |
| `gif --once` | 关闭默认的循环播放 |

动画 PNG 和 GIF 使用黑底；`sprite` 仅解码所属 entry 的贴图，PNG 保留透明度。Sprite 尺寸为切片宽高的向上取整，不叠加棋盘格或网页预览的放大效果；切片越过贴图的部分透明，无内嵌图或非正宽高则报错。

`run` 默认位置是原点，动画导出默认居中。对照 VM 和图片时，请显式传入相同的 `--position`。

## 使用 agent 已有的浏览器工具

只有 Python Playwright、平台浏览器工具，或希望自行控制浏览器时，先启动本机服务：

```bash
node bin/anm.mjs serve edited.anm --out-dir ./renders --json
```

服务前台运行，只监听 `127.0.0.1`；默认由系统分配端口。stdout 输出一次 ready 结果，`data.url` 是页面地址，`data.outDir` 是结果目录。输入文件在启动时读入，修改 ANM 后需重启服务。Ctrl+C 退出，`--port` 可指定端口；需要覆盖结果时在启动命令加 `--force`。

让已有浏览器打开 `data.url`，执行页面 JS，无需操作任何网页按钮：

```js
await window.liveAnm.ready; // Promise<Result>；先检查 ok
await window.liveAnm.renderFrame({
  scriptIndex: 0, frame: 60, output: 'preview.png',
  width: 640, height: 480, position: { x: 320, y: 240 },
  crop: { x: 160, y: 120, width: 320, height: 240 },
});
await window.liveAnm.exportGif({
  scriptIndex: 0, duration: 3, fps: 20, loop: true, output: 'animation.gif',
});
await window.liveAnm.exportSprite({ spriteIndex: 0, output: 'sprite.png' });
```

三个方法均返回 Result；参数默认值与 CLI 一致。`output` 只能是单个 `.png` / `.gif` 文件名，结果写进服务指定的 out-dir。按顺序 await 调用即可。GIF 结果另含实际 `frames` 和延时累计后的 `duration`（秒）。

Python 示例使用环境已有的 Playwright 和浏览器，URL 替换为 serve 的输出：

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page()
        page.goto("http://127.0.0.1:PORT/live-anm/agent.html")
        ready = page.evaluate("() => window.liveAnm.ready")
        if not ready["ok"]:
            raise RuntimeError(ready["error"])
        result = page.evaluate("""() => window.liveAnm.renderFrame({
            scriptIndex: 0, frame: 0, output: 'preview.png'
        })""")
        print(result)
    finally:
        browser.close()
```

浏览器必须能访问这个 localhost；跨容器或远程浏览器需要运行环境提供网络转发。保存请求由页面向同源服务发送，不能绕过页面改成跨源写文件。

构建默认 base 是 `/live-anm/`。使用 `BASE_PATH=/custom/ npm run build` 时，serve/render/gif/sprite 均需传入相同的 `--base /custom/`。缺少构建产物时返回 `ASSETS_NOT_BUILT`，不会隐式安装或构建。

## 验证

```bash
npm test
npm run build
node scripts/smoke-agent-render.mjs --playwright-module /absolute/path/node_modules/playwright-core
```

最后一条是可选的真实渲染检查，需要现有浏览器支持 WebGL 和 GIF ImageDecoder。它只调用页面 API，以合成 ANM 验证 PNG 裁剪、方向、Sprite 透明度，以及 GIF 解码后的帧数、延时、循环。结果写入并保留在临时目录，不包含游戏数据；默认测试不启动浏览器。
