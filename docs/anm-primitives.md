# TH16 无贴图矩形与多边形

适用版本：TH16 v1.00a，imagebase `0x400000`。以下结论来自 renkolab 已有 Ghidra 工程导出，按 Listing 核查，未从其他游戏版本外推。

## 一手依据

关联仓库的阅读入口是 `tooling/ghidra/README.md`、`games/th16.v1.00a/INDEX.md` 和 `engine/anm/th16/09-drawing.md`。本机已有导出位于 renkolab 的 `local/th16.v1.00a/state/`；`data/functions.jsonl` 提供反编译，`f/<八位地址>.html` 同时提供反编译与完整 Listing。

| 指令 | mode | 绘制函数 | 输出 |
| --- | ---: | --- | --- |
| 603 drawRect | 16 | `0x468c70` | 平涂矩形 |
| 606 drawRectGrad | 20 | `0x468c70` | 左右渐变矩形 |
| 607 drawRectShadow | 21 | `0x469570` → `0x468c70` 两次 | 扩大半透明底图 + 平涂矩形 |
| 608 drawRectShadowGrad | 22 | 同上 | 扩大半透明底图 + 渐变矩形 |
| 613 drawLine | 26 | `0x469330` | 一条线段 |
| 612 drawRectBorder | 27 | `0x468fc0` | 闭合矩形边框 |
| 604 drawPoly | 17 | `0x469640` | 三角扇填充多边形 |
| 605 drawPolyBorder | 18 | `0x469a00` | 闭合多边形边框 |
| 611 drawRing | 19 | `0x469bd0` | 内外圈三角带 |

分发器为 `AnmManager::draw_vm` (`0x468490`)。矩形参数准备见 `0x468722–0x468809`，多边形见 `0x4689b3–0x468a80`；极坐标计算为 `0x469e00`。

**反编译的隐含参数不能省略**：这些 helper 使用 ECX=manager、XMM1=中心 X、XMM2=中心 Y、XMM3=宽／半径；栈参数包括高／环宽、Z 旋转、颜色、锚点或边数。旧反编译原型遗漏了 XMM3，必须结合调用点 Listing 读取。

## 位置、尺寸与继承

以下乘加按原指令落点取 float32。设原始尺寸 `spriteSize=(w,h)`：

- 矩形宽／圆的中心半径 = `w * scale.x`；矩形高／环宽 = `h * scale.y`。
- 若直接父 VM（`+0x5b0`）存在且 `flagsHi & 0x10000` 为零：两者再乘父的 `scale.x/y`，旋转再加父的 `rotation.z`。只读直接父，不累计所有祖先。
- 分辨率 mode=1 时尺寸乘 `D`，mode=2 时乘 `D/2`；其余尺寸不变，特别是 mode=3/4。
- 不读取 `scale2`、`anchorOffset`、父颜色或 UV。
- 中心位置由 `get_own_transformed_pos` (`0x406c40`) 单独计算。它的位置分辨率规则是 mode=1/3 乘 D，mode=2/4 乘 D/2，和尺寸规则不同。复用播放器的 `finalPos`；该函数已有的宿主原点模拟范围保持不变。
- 全部输出顶点 `z=0,rhw=1`，忽略中心的 Z；没有 sprite 路径的半像素偏移。

## 矩形、阴影与线

每轴尺寸 s 的锚点范围：0=`[-s/2,s/2]`，1=`[0,s]`，2=`[-s,0]`。局部角点经 Z 旋转后加中心位置，角序为 TL/TR/BL/BR。非法锚点 3 的原分支退化为重合点：矩形横纵坐标均取高，线段横坐标取旋转角；不赋予新语义。

- 平涂矩形四角都是 color1。
- 渐变矩形四角为 `color1/color2/color1/color2`，沿局部 X 方向，不受 `colorMode` 控制。
- 阴影先用最终宽高各加 1 绘制，中心、锚点与旋转不变；颜色仅 alpha 整数右移一位，RGB 原样保留。然后绘制原尺寸原色。加 1 发生在父缩放与分辨率换算之后。证据 `0x4695a5/0x4695df`，两次调用 `0x4695ec/0x469623`。
- 矩形边框顺序 TL/TR/BR/BL/TL，颜色 `C1/C2/C2/C1/C1`；线段从局部左端到右端，颜色 C1/C2。仅当 `flagsLo & 0x60000` 非零才使用 color2，否则 C2=color1。
- 线段忽略高与垂直锚点。边框和线段是设备像素宽的线，宽度不随 VM 缩放或分辨率放大。

## 多边形与环

边数取绘制时的 `I0`；起始角取上述 Z 旋转。`step=float32(float32(2π)/I0)`。每轮先生成顶点，再累加 step 并按原版最多 34 次的归一循环处理到 `[-π,π]`。初始角不提前归一，最后闭合点也重新计算，不复制首点。

- 填充多边形：一个中心点 color1 + `n+1` 个外围点 color2，三角扇，n 个三角形。
- 多边形边框：`n+1` 个外围点，全部 color1，n 条相邻线段。
- 环：`inner=radius-width/2`、`outer=radius+width/2`。每角依次写内、外两点，全部 color1，共 `2(n+1)` 个顶点和 `2n` 个三角形。
- 三者都不读取 `colorMode`，不把非等比缩放解释成椭圆，也不钳制负的内半径或环宽。

## 绘制状态及旧文更正

FVF=`0x44`（XYZRHW|DIFFUSE），stride=20，无 UV。`COLOROP/ALPHAOP=SELECTARG2`、ARG2=DIFFUSE，所以纹理不参与颜色计算。混合和 alpha test 仍沿用逐 VM 状态。

旧 `09-drawing.md` §4.4 中“矩形排入 sprite 批量缓冲，经 TRIANGLELIST flush”不准确。`0x468f82–0x468fa2` 明确直接提交 `DrawPrimitiveUP(TRIANGLESTRIP,2,buf,20)`；矩形边框为 LINESTRIP/4 段，单线为 LINESTRIP/1 段。多边形依次为 TRIANGLEFAN/n、LINESTRIP/n、TRIANGLESTRIP/2n。各 helper 在即时绘制前先 flush 已排队的 sprite。

播放器将扇形／带展开成三角形、线带展开成独立线段，并保留 VM 和阴影两遍的顺序。`geometry.textured=false` 让宿主和网页播放器允许未选 sprite、没有源贴图的彩色图元。shader 通过 `uTextured` 选择顶点色或纹理乘顶点色；无贴图分支给活动 sampler 绑定 renderer 自有的 1×1 纹理。

一个 script 可以完全不调用 `sprite()`，例如在默认 thanm 视图中：

```text
0:
    rgb(255, 80, 80);
    drawRect(100, 60);
    stop();
```

`stop()` 保留画面；若脚本直接结束，VM 会按原有规则回收。切回需要纹理的渲染模式后仍需有效 sprite。

## 兼容范围

- `n<=0` 在原版会导致无有效画面保证的 D3D 请求；播放器明确返回空几何。n=1/2 保留自然退化，不另要求 n≥3。
- JS 三角函数与 x87 FSINCOS 的末位精度，以及 D3D9 与 WebGL 的线段端点覆盖可能不同。几何测试使用数值容差；不宣称逐像素一致。
- 本次不新增游戏原点、特殊回调、3D 变换、随机数或其他渲染模式。
- Node 测试验证坐标、颜色、顶点拓扑和提交状态；真实游戏画面还需独立对照，不能由 mock GL 通过推定。
- 本次已有检查及构建通过；详细 Node 结果为 361 通过、1 跳过（缺少 thanm）。浏览器静态预览确认九个无 sprite、无源贴图脚本均能绘制，WebGL 无错误；未执行页面自动交互或原游戏画面对照。
