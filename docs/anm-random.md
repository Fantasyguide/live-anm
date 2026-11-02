# TH16 ANM 随机数

一手依据：renkolab 的 `engine/_shared/math-and-prng.md` §3、`engine/anm/th16/03-math-jumps.md` §7.4 与 `04-variables.md` §5；参考模型为 `tooling/ghidra/scripts/th16_prng_model.py`。已对照现有 TH16 Ghidra 导出的 `prng_gameplay_draw`（`0x402be0`）及播种函数 `0x43b520`，未另行反汇编 exe。

每个状态是 16 位。一步先算 `t=((state XOR 0x9630)-0x6553) & 0xffff`，再令 `state=ROL16(t,2)`。一次 raw draw 走两步，返回 unsigned `(t1<<16)|t2`；拼的是旋转前的 t，不是新状态。

- 表现流 B（原地址 `0x4a6d80`）接 `vm.prng`，供 122/123/131、301 和变量 10010–10012/10022 使用。
- 回放流 A（`0x4a6d88`）接 `vm.prngReplay`，供变量 10030–10032 使用。
- 同一宿主的所有 VM 共享对应流；两条流独立推进。500–506 创建的 VM 在预跑前继承函数引用，不复制或重新播种。
- 现有 opcode/变量解析仍负责取模与浮点区间映射；本次仅补 raw draw 和宿主接线。

独立播放器每次创建 manager 时让两条流各从种子 0 开始，因此重建后序列可复现。生成器本身接受 16 位种子；未新增 manager 配置或前端控件。原游戏会用 `timeGetTime` 播种，并可能在 ANM 运行前已消费随机数；播放器不模拟整局启动预热或回放存取，不承诺与任意实机时刻的序列同步。底层直接使用 createVm 时仍需显式注入钩子。

固定序列测试的预期取自 renkolab 独立 Python 模型。例如 seed=`0x1234` 的前六次输出为 `1eb187a1,2363b669,ea43d9ec,8c30419f,2afad885,8ed4480f`。该算法已有静态一手依据；原研究尚未完成真机输出抓取对照。
