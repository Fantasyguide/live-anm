import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// 注意：package.json 是 "type": "module"，所以这个配置文件是 ESM——**没有 `__dirname`**。
// 路径一律用 `new URL(..., import.meta.url)`。
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('web'),
  plugins: [vue()],
  // `@engine` = 仓库根的 src/（引擎运行时）。web 层用别名引它，免得写一串 ../../ ——
  // 组件挪个目录就全断。Node 侧的测试不经 Vite，仍用相对路径，两边互不影响。
  resolve: { alias: { '@engine': here('src') } },
  // GitHub Pages 把站点挂在 /<repo>/ 下，base 不能是默认的 '/'，否则打包出来的资源路径会 404。
  // 本地 dev / preview 不受影响；要换路径用 BASE_PATH= 覆盖。
  base: process.env.BASE_PATH ?? '/live-anm/',
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: { main: here('web/index.html'), selftest: here('web/selftest.html'), agent: here('web/agent.html') },
    },
  },
});
