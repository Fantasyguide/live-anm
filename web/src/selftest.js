// 浏览器自测：Node 里的测试用的是 mock GL——能验「设了哪些状态、顶点怎么摆」，
// **验不了真实 GL 的行为**（shader 能不能编译、混合对不对、读回来的像素是什么）。
// 这一页用仓库自带的合成夹具（零版权字节）跑一遍完整管线并 readPixels 读回。
import './style.css';
import { loadAnm, createPlayer } from './player.js';
// Vite 的 ?url：把夹具当静态资源处理，dev 与打包后路径都对
import fixtureUrl from '../../tests/fixtures/settings-ops.anm?url';

const app = document.getElementById('app');
app.innerHTML = `
  <div class="wrap" style="padding:20px">
    <h1 style="font-size:16px">live-anm 浏览器自测</h1>
    <p class="dim" style="max-width:60em">
      Node 里的 312 个测试用的是 mock GL。<b>真实 WebGL 的行为只有浏览器能验</b>——
      这一页跑完整管线：解析 → 贴图解码 → VM → 几何 → WebGL 提交 → <code>readPixels</code> 读回，
      确认「确实画上去了」而不是只跑通了调用。
    </p>
    <canvas id="c" class="stage"></canvas>
    <div id="out" class="code" style="margin-top:12px"></div>
  </div>`;

const out = document.getElementById('out');
const rows = [];
const say = (ok, msg) => {
  rows.push(`<div style="color:${ok ? '#9ece6a' : '#f7768e'}">${ok ? '✓' : '✗'} ${msg}</div>`);
  out.innerHTML = rows.join('');
};

async function run() {
try {
  const bytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
  const file = loadAnm(bytes);
  say(file.entries.length > 0, `解析：${file.entries.length} entry / ${file.sprites.length} sprite / ${file.scripts.length} script`);

  const t = file.textures[0];
  say(!!t?.rgba, `THTX 解码：${t?.width}×${t?.height} format=${t?.format} → ${t?.rgba.length} 字节 RGBA`);

  const canvas = document.getElementById('c');
  const p = createPlayer(canvas, file, { width: 320, height: 240 });
  say(true, 'WebGL 上下文 + shader 编译链接通过');

  p.spawn(0, { entityPos: { x: 160, y: 120, z: 0 } });
  for (let i = 0; i < 5; i++) p.step();
  p.render();
  say(p.errors.length === 0,
    `跑 5 帧：运行时异常 ${p.errors.length} 个${p.errors[0] ? ' — ' + p.errors[0].message.slice(0, 140) : ''}`);
  say(true, `drawList ${p.manager.drawList().length} 项 · skipped ${p.manager.skipped.length} 项`);

  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const px = new Uint8Array(320 * 240 * 4);
  gl.readPixels(0, 0, 320, 240, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) n++;
  say(n > 0, `readPixels：非黑像素 ${n} 个 —— ${n > 0 ? '确实画上去了' : '画布全黑，管线在某处断了'}`);
} catch (e) {
  say(false, '异常：' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
}
}
run();
