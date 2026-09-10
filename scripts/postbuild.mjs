// 打包之后，把**未打包的运行时源码**原样也放一份到 dist/src/。
//
// 打包产物里 src/ 已经被 Rollup 揉进 chunk 了，读不出来。而这个项目的卖点之一就是
// 「引擎知识的可执行形式」——保留一份可直接 import 的 ESM，别人能
// `import('https://.../live-anm/src/vm/core.js')` 拿去用，也方便对着看。
// 代价只有几十 KB。
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, 'dist'), { recursive: true });
await cp(join(root, 'src'), join(root, 'dist/src'), { recursive: true });
console.log('postbuild: src/ → dist/src/（未打包的运行时，可直接 import）');
