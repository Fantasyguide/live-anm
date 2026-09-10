// 浏览器自测：Node 里的测试用的是 mock GL——能验「设了哪些状态、顶点怎么摆」，
// **验不了真实 GL 的行为**（shader 能不能编译、混合对不对、读回来的像素是什么）。
//
// 夹具是**当场用 buildAnm 造的**，不是挑一个现成的测试夹具。第一版挑了
// `settings-ops.anm`，结果它只有 1 个 sprite 却执行 `300 sprite(3)`——越界，宿主直接
// 跳过不画，`readPixels` 自然全黑，看起来像「管线断了」其实是夹具选错。自己造才控制得住。
import './style.css';
import { loadAnm, createPlayer } from './player.js';
import { buildAnm } from '@engine/format/anm-v8-write.js';

const app = document.getElementById('app');
app.innerHTML = `
  <div class="wrap" style="padding:20px">
    <h1 style="font-size:16px">live-anm 浏览器自测</h1>
    <p class="dim" style="max-width:64em">
      Node 里的 319 个测试用的是 mock GL。<b>真实 WebGL 的行为只有浏览器能验</b>——
      这一页跑完整管线：合成一个 .anm → 解析 → 贴图解码 → VM → 几何 → WebGL 提交 →
      <code>readPixels</code> 读回，确认「确实画上去了」而不是只跑通了调用。
    </p>
    <canvas id="c" class="stage"></canvas>
    <div id="out" class="code" style="margin-top:12px"></div>
  </div>`;

const out = document.getElementById('out');
const rows = [];
let failed = 0;
const say = (ok, msg) => {
  if (!ok) failed++;
  rows.push(`<div style="color:${ok ? '#9ece6a' : '#f7768e'}">${ok ? '✓' : '✗'} ${msg}</div>`);
  out.innerHTML = rows.join('');
};

const W = 320, H = 240;

async function run() {
  try {
    // 32×32 的纯品红贴图 + 一个 16×16 的 sprite；脚本只做「选 sprite」然后停在未来的 nop 上。
    const TEX = 32, rgba = new Uint8Array(TEX * TEX * 4);
    for (let i = 0; i < TEX * TEX; i++) {
      rgba[i * 4] = 255; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255;
    }
    const bytes = buildAnm({
      name: 'selftest.png', width: TEX, height: TEX, rgba,
      sprites: [{ x: 0, y: 0, w: 16, h: 16 }],
      scripts: [{ instructions: [
        { time: 0, opcode: 300, args: [0] },   // sprite(0)
        { time: 999, opcode: 0, args: [] },    // 停在未来的 nop 上，别跑到脚本尾隐式 delete
      ] }],
    });
    say(bytes.length > 0, `合成 .anm：${bytes.length} 字节`);

    const file = loadAnm(bytes);
    say(file.sprites.length === 1 && file.scripts.length === 1,
      `解析：${file.entries.length} entry / ${file.sprites.length} sprite / ${file.scripts.length} script`);

    const t = file.textures[0];
    say(t?.rgba?.[0] === 255 && t?.rgba?.[1] === 0 && t?.rgba?.[2] === 255,
      `THTX 解码：${t?.width}×${t?.height} format=${t?.format} → 首像素 rgba(${[...t.rgba.slice(0, 4)]})`);

    const canvas = document.getElementById('c');
    const p = createPlayer(canvas, file, { width: W, height: H });
    say(true, 'WebGL 上下文 + shader 编译链接通过');

    p.spawn(0, { entityPos: { x: W / 2, y: H / 2, z: 0 } });
    for (let i = 0; i < 5; i++) p.step();
    p.render();
    say(p.errors.length === 0,
      `跑 5 帧：运行时异常 ${p.errors.length} 个${p.errors[0] ? ' — ' + p.errors[0].message.slice(0, 160) : ''}`);

    // ★ 这一条以前写成了恒真的 `say(true, ...)`——正是它让「drawList 0 项」看着像通过。
    const drawn = p.manager.drawList().length;
    const skipped = p.manager.skipped;
    say(drawn > 0, `drawList ${drawn} 项 · skipped ${skipped.length} 项`
      + (skipped.length ? ' — ' + skipped.map((s) => s.reason).join(' / ').slice(0, 200) : ''));

    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, magenta = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] || px[i + 1] || px[i + 2]) n++;
      if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200) magenta++;
    }
    say(n > 0, `readPixels：非黑像素 ${n} 个`);
    // sprite 16×16、中心锚点 ⇒ 应该正好 256 个品红像素。数目对得上，说明**几何也对**，
    // 不只是「画了点什么」。
    say(magenta === 256, `品红像素 ${magenta} 个（期望 256 = 16×16 的 sprite）`);

    say(failed === 0, failed === 0 ? '全部通过 —— 真实 WebGL 路径可用' : `${failed} 项未通过`);
  } catch (e) {
    say(false, '异常：' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}
run();
