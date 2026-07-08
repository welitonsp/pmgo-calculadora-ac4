/* Regenera assets/icon-192.png e icon-512.png a partir de assets/icon.svg,
   já otimizados (PNG indexado, paleta <=256 cores — técnica do pngquant),
   usando só o que vem no ambiente do projeto: Chrome headless (rasteriza o
   SVG) + zlib nativo do Node (comprime). Sem dependências npm nem pngquant.

   Uso: node tools/optimize-icons.mjs   (CHROME_PATH sobrepõe a detecção)

   Por que existe: o Chrome exporta canvas->PNG sem otimização (fica maior que
   o original); este script extrai os pixels crus e codifica um PNG indexado
   compacto. Rode-o sempre que icon.svg mudar e depois faça o bump de versão. */
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAMANHOS = [192, 512];

function acharChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidatos = process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe',
       'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  const achado = candidatos.find((c) => existsSync(c));
  if (!achado) throw new Error('Chrome não encontrado. Defina CHROME_PATH.');
  return achado;
}

/* ---------------- median-cut para <=256 cores (RGBA) ---------------- */
function quantize(px, maxColors = 256) {
  const map = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3];
    const e = map.get(key);
    if (e) e.n++; else map.set(key, { r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3], n: 1 });
  }
  let buckets = [[...map.values()]];
  const range = (bk, ch) => { let mn = 255, mx = 0; for (const c of bk) { const v = c[ch]; if (v < mn) mn = v; if (v > mx) mx = v; } return mx - mn; };
  while (buckets.length < maxColors) {
    let bi = -1, best = -1, bch = 'r';
    buckets.forEach((bk, idx) => {
      if (bk.length < 2) return;
      for (const ch of ['r', 'g', 'b', 'a']) {
        const rg = range(bk, ch) * Math.log2(bk.reduce((s, c) => s + c.n, 0) + 1);
        if (rg > best) { best = rg; bi = idx; bch = ch; }
      }
    });
    if (bi < 0) break;
    const bk = buckets[bi];
    bk.sort((x, y) => x[bch] - y[bch]);
    const total = bk.reduce((s, c) => s + c.n, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < bk.length; i++) { acc += bk[i].n; if (acc >= total / 2) { cut = Math.max(1, Math.min(bk.length - 1, i + 1)); break; } }
    buckets.splice(bi, 1, bk.slice(0, cut), bk.slice(cut));
  }
  return buckets.map((bk) => {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (const c of bk) { r += c.r * c.n; g += c.g * c.n; b += c.b * c.n; a += c.a * c.n; n += c.n; }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n) };
  });
}
const nearest = (pal, r, g, b, a) => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    const d = (p.r - r) ** 2 + (p.g - g) ** 2 + (p.b - b) ** 2 + ((p.a - a) ** 2) * 1.5;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
};

/* ---------------- codificação PNG indexado ---------------- */
const CRCT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodeIndexedPNG(px, size, pal) {
  const idx = Buffer.alloc(size * size);
  const cache = new Map();
  for (let p = 0, i = 0; i < px.length; i += 4, p++) {
    const key = (px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3];
    let v = cache.get(key);
    if (v === undefined) { v = nearest(pal, px[i], px[i + 1], px[i + 2], px[i + 3]); cache.set(key, v); }
    idx[p] = v;
  }
  const raw = Buffer.alloc(size * (size + 1)); // filtro 0 (none) por scanline
  for (let y = 0; y < size; y++) { raw[y * (size + 1)] = 0; idx.copy(raw, y * (size + 1) + 1, y * size, y * size + size); }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 3; // 8 bits, indexed
  const plte = Buffer.alloc(pal.length * 3); pal.forEach((c, i) => { plte[i * 3] = c.r; plte[i * 3 + 1] = c.g; plte[i * 3 + 2] = c.b; });
  const trns = Buffer.from(pal.map((c) => c.a));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- Chrome headless: SVG -> RGBA cru ---------------- */
async function comChrome(svgB64, fn) {
  const perfil = await mkdtemp(join(tmpdir(), 'ac4-icons-'));
  const proc = spawn(acharChrome(), ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${perfil}`, '--remote-debugging-port=0', 'about:blank']);
  try {
    const wsUrl = await new Promise((res, rej) => { let s = ''; const t = setTimeout(() => rej(new Error('Chrome não expôs o DevTools em 20s.')), 20000); proc.stderr.on('data', (d) => { s += d; const m = s.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } }); });
    const ws = new WebSocket(wsUrl); let id = 1; const pend = new Map(); const evwait = [];
    await new Promise((r) => ws.addEventListener('open', r));
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; } if (m.method) { for (let i = evwait.length - 1; i >= 0; i--) if (evwait[i].method === m.method) evwait.splice(i, 1)[0].res(m.params); } });
    const send = (method, params = {}, sid) => new Promise((res, rej) => { const i = id++; pend.set(i, { res, rej }); ws.send(JSON.stringify(sid ? { id: i, method, params, sessionId: sid } : { id: i, method, params })); });
    const wait = (method, ms = 15000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + method)), ms); evwait.push({ method, res: (p) => { clearTimeout(t); res(p); } }); });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
    const carregou = wait('Page.loadEventFired');
    await send('Page.navigate', { url: 'about:blank' }, sessionId);
    await carregou;
    const rgba = async (size) => {
      const script = `(async()=>{const img=new Image();img.src='data:image/svg+xml;base64,${svgB64}';await img.decode();const c=document.createElement('canvas');c.width=${size};c.height=${size};const ctx=c.getContext('2d');ctx.imageSmoothingQuality='high';ctx.clearRect(0,0,${size},${size});ctx.drawImage(img,0,0,${size},${size});const d=ctx.getImageData(0,0,${size},${size}).data;let bin='';const CH=8192;for(let i=0;i<d.length;i+=CH){bin+=String.fromCharCode.apply(null,d.subarray(i,i+CH));}return btoa(bin);})()`;
      const r = await send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
      return Buffer.from(r.result.value, 'base64');
    };
    return await fn(rgba);
  } finally {
    proc.kill();
    await rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}

const svg = await readFile(join(raiz, 'assets/icon.svg'), 'utf8');
const svgB64 = Buffer.from(svg, 'utf8').toString('base64');
await comChrome(svgB64, async (rgba) => {
  for (const size of TAMANHOS) {
    const px = await rgba(size);
    const pal = quantize(px, 256);
    const png = encodeIndexedPNG(px, size, pal);
    await writeFile(join(raiz, 'assets', `icon-${size}.png`), png);
    console.log(`assets/icon-${size}.png => ${(png.length / 1024).toFixed(1)} KB (${pal.length} cores)`);
  }
});
console.log('\nÍcones regenerados. Lembre-se de bumpar a versão se forem para produção.');
