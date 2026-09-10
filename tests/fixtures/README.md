# 测试夹具

这些 `.anm` 是**合成的**，**不含任何游戏数据**：

- `*.anm.txt` 是手写的 thanm 源码；
- 里面引用的贴图是 `build-fixtures.sh` 用 Python 现生成的 8×8 纯色 PNG；
- `*.anm` 是用 thanm 把两者编译出来的产物。

**为什么把编译产物也提交进来**：`build-fixtures.sh` 需要 thanm 可执行文件，而它不是本仓库的
依赖（在上游的逆向工作台里）。夹具总共只有 24 KB，且逐字节都是自造的——直接入库能让
`npm test` 在任何只装了 node 的机器上跑通，比让每个人先去装一套 thtk 工具链划算得多。

要重新生成（改了 `.anm.txt` 之后），需要 thanm：

```bash
THANM=/path/to/thanm ./tests/build-fixtures.sh
```
