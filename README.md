# live-anm

**东方 ANM v8 播放器** —— 用 JavaScript + WebGL 复刻 TH16《鬼形兽》的 ANM 子系统，
在浏览器里直接放 `.anm` 动画脚本。

零依赖的纯 ESM，**304 个测试**，不需要构建工具就能跑。

## 这是什么

`.anm` 是东方 Project 从 TH06 起使用的精灵动画格式：一个文件里装着贴图、精灵切片表，
以及一套**字节码脚本**——每个精灵由一台小型虚拟机驱动，逐帧执行 `pos` / `rotate` /
`scaleTime` / `createChild` 这样的指令。游戏里几乎所有会动的东西（子弹、敌人、UI、
符卡背景、菜单）都是 ANM 脚本画出来的。

本项目把那台虚拟机和它的渲染管线整个搬到了浏览器里：

| 层 | 内容 | 状态 |
| --- | --- | --- |
| 格式层 | `.anm` v8 解析、THTX 贴图解码（format 1/3/5/7 → RGBA8） | ✅ |
| 层 A · VM | **135 / 135 条 opcode**、36 个脚本变量、12 组帧尾插值器、父子 VM 树 | ✅ |
| 层 B · 渲染 | sprite 四边形几何、帧尾几何三族、D3D9 → WebGL 状态映射 | 🟡 部分 |
| 宿主 | VM 列表、layer 排序、子树回收、全局序号解析 | ✅ |
| Web | 拖进 `.anm` 就能播 | 见 [`web/`](web/) |

**层 B 还缺**：`draw_vm` 的 mode 4 / 8 / 15、rect 族、poly 族的顶点计算——播放器遇到它们
会跳过并显示原因，不会崩。详见 `OVERVIEW.md`。

## 不含任何版权数据

**本仓库不包含、也不会包含任何 ZUN 的游戏数据**——没有 `.anm` 文件、没有贴图、没有一个字节。
网页版靠**你自己上传**手里的文件；测试夹具全部是自造的合成数据。

## 跑起来

```bash
npm test          # 304 个测试，零依赖，只要有 node
```

网页版是**纯静态**的，不需要构建（Vue 走 import map 从 CDN 取，`src/` 本来就是浏览器
能直接 import 的 ESM）。**在仓库根目录**起个静态服务器即可——`web/` 里用 `../src/...`
引用运行时，所以站点根必须是仓库根：

```bash
python3 -m http.server 8080          # 然后打开 http://localhost:8080/web/
```

## 保真度

目标是「**能跑、看着像**」而不是逐像素等同真机。每条实现都对着 TH16 v1.00a
（`th16.exe`，imagebase `0x400000`）的一手反汇编写，代码注释里带着具体地址与文档章节号，
例如：

```js
// 09 §3.2：`scale.y` = 环的中心半径、`scale.x` = 环宽
// （`th16:0x4636e7`–`th16:0x46370a`）
```

这些 `09 §3.2` 形式的引用指向一份**独立的逆向知识库**（`engine/anm/th16/01-format.md` …
`10-sprite-geometry.md`），它不在本仓库里。引用保留成文本而不是链接，是因为那份知识库
目前不公开；但**每条引用都写明了文档号 + 节号 + 机器码地址**，足以让人自行复核。

**有意偏离真机的地方**一律显式记在代码与 `OVERVIEW.md` 里，不假装没有。例如：
贴图不做 `entry.format` 的降位转换（比真机更准）、`sprite(-1)` 不加载 `ascii.anm` 的
系统贴图（真机会换，这里按「不使用图像」处理）。

## 跟社区实现的两处已知分歧

- **RGB565 不抄 thanm**。thanm `image.c` 的蓝通道位运算有 bug（三项都写成 `<< 16`，掩码
  却在 bit18/17/16 ⇒ 前两项恒为 0），**蓝通道永远到不了 255**，纯白解出 `(255,255,249)`；
  65536 个取值里 99.6% 与 GPU 不同。真机把 RGB565 交给 D3D9 纹理、扩位由 GPU 做，
  所以这里走标准高位复制。`{ rgb565: 'thanm' }` 可切回去对拍。
- **blend mode 4 不是 Screen**。thpages 记作 `Screen? (S + D − SD)`，实际是 `S + D − 2SD`
  ——白叠白给**黑**而不是白。详见 `src/render/D3D9-MAPPING.md` §2.1。

## 目录

```
src/format/   anm-v8.js（.anm 解析） thtx.js（贴图解码）
src/vm/       core.js（VM 骨架）+ 六个 opcode 组，共 135 条
src/render/   geometry.js（顶点计算） render-state.js（D3D9→WebGL） webgl.js
src/host/     manager.js（VM 列表 / layer / 子树回收）
web/          Vue 壳子，拖进 .anm 就能播
tests/        304 个
tools/        opcode 状态矩阵生成器
```

## 许可

代码 MIT。ANM 格式与东方 Project 的一切权利归上海爱丽丝幻乐团 / ZUN 所有。
