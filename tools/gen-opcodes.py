#!/usr/bin/env python3
"""从 OVERVIEW.md 的 opcode 状态矩阵生成 src/opcodes.js（名字表）。

矩阵是单一事实源；这个脚本只是把它的前三列摘出来给运行时用，避免两处各写一份名字。
改了矩阵之后重跑：  python3 tools/gen-opcodes.py
"""
import re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
rows = re.findall(r'^\| (\d+) \| ([A-Za-z+ ]+) \| `([^`]+)` \|',
                  (ROOT / 'OVERVIEW.md').read_text(encoding='utf8'), re.M)
if len(rows) != 135:
    sys.exit(f'从矩阵里只解出 {len(rows)} 行，期望 135 —— 矩阵格式变了？')
body = '\n'.join(f"  {op}: ['{name}', '{grp.strip()}']," for op, grp, name in rows)
out = ROOT / 'src' / 'opcodes.js'
text = out.read_text(encoding='utf8')
new = re.sub(r'export const OPCODES = \{.*?\n\};', 'export const OPCODES = {\n' + body + '\n};', text, flags=re.S)
out.write_text(new, encoding='utf8')
print(f'{out} 已更新（{len(rows)} 条）')
