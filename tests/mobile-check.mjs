/* Validação mobile — abre a aplicação em Chrome headless com viewport de
   celular (393×852 e 320×568) e mede na prática: touch targets ≥ 44px,
   barra fixa, topbar compacta, footer sem sobreposição e ausência de
   overflow horizontal. Zero dependências npm (mesma base do smoke.mjs). */
import { createServer } from 'node:http';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

const iniciarServidor = () => new Promise((resolve) => {
  const srv = createServer(async (req, res) => {
    try {
      let caminho = new URL(req.url, 'http://localhost').pathname;
      if (caminho === '/') caminho = '/index.html';
      const corpo = await readFile(join(raiz, caminho.replace(/^\/+/, '')));
      res.writeHead(200, { 'Content-Type': MIME[extname(caminho)] || 'application/octet-stream' });
      res.end(corpo);
    } catch { res.writeHead(404).end(); }
  });
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});

function acharChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidatos = process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  const achado = candidatos.find((c) => existsSync(c));
  if (!achado) throw new Error('Chrome não encontrado. Defina CHROME_PATH.');
  return achado;
}

const lancarChrome = (chrome, perfil) => new Promise((resolve, reject) => {
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', `--user-data-dir=${perfil}`, '--remote-debugging-port=0', 'about:blank',
  ]);
  let stderr = '';
  const timer = setTimeout(() => reject(new Error(`Chrome não expôs o DevTools em 20s.\n${stderr}`)), 20000);
  proc.stderr.on('data', (d) => {
    stderr += d;
    const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(timer); resolve({ proc, wsUrl: m[1] }); }
  });
  proc.on('error', (e) => { clearTimeout(timer); reject(e); });
});

const conectarCDP = (wsUrl) => new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  let proximoId = 1;
  const pendentes = new Map();
  const esperasEvento = [];
  ws.addEventListener('open', () => resolve({
    enviar(method, params = {}, sessionId) {
      const id = proximoId++;
      return new Promise((res, rej) => {
        pendentes.set(id, { res, rej });
        ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      });
    },
    aguardarEvento(method, timeoutMs = 15000) {
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`Timeout aguardando ${method}`)), timeoutMs);
        esperasEvento.push({ method, res: (p) => { clearTimeout(timer); res(p); } });
      });
    },
    fechar: () => ws.close(),
  }));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pendentes.has(msg.id)) {
      const { res, rej } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
      return;
    }
    if (msg.method) {
      for (let i = esperasEvento.length - 1; i >= 0; i--) {
        if (esperasEvento[i].method === msg.method) esperasEvento.splice(i, 1)[0].res(msg.params);
      }
    }
  });
  ws.addEventListener('error', () => reject(new Error('Falha no WebSocket do DevTools.')));
});

/* Medições feitas dentro da página em viewport mobile (393×852). */
const ROTEIRO_MOBILE = `(async () => {
  const passos = [];
  const ok = (nome, cond, detalhe = '') => passos.push({ nome, ok: !!cond, detalhe: String(detalhe) });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
  const visivel = (sel) => { const r = rect(sel); return !!r && r.width > 0 && r.height > 0; };

  for (let i = 0; i < 50 && !document.getElementById('formEscala'); i++) await espera(100);
  localStorage.removeItem('pmgoEscalas');

  // lança uma escala para materializar a tabela/ações
  const ini = document.getElementById('escalaInicio');
  ini.value = '2026-07-06T07:00';
  ini.dispatchEvent(new Event('change', { bubbles: true }));
  const dur = document.getElementById('escalaDuracao');
  dur.value = '14';
  dur.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('btnSubmit').click();
  await espera(400);

  // 1. barra fixa mobile visível e com ações ≥ 44px
  ok('Barra fixa mobile visível', visivel('.mobile-bar'));
  const share = rect('#mobileShare');
  ok('Botão compartilhar da barra ≥ 44px', share && share.width >= 44 && share.height >= 44, share && Math.round(share.width) + '×' + Math.round(share.height));
  const add = rect('#mobileAdd');
  ok('Botão "Nova escala" ≥ 44px de altura', add && add.height >= 44, add && Math.round(add.height) + 'px');

  // 2. topbar compacta: agenda-action oculta no mobile
  ok('Topbar compacta (agenda-action oculta)', !visivel('.agenda-action'));

  // 3. touch targets da topbar ≥ 44px
  const csv = rect('#btnExportCsv');
  ok('Botões da topbar ≥ 44px', csv && csv.height >= 44, csv && Math.round(csv.width) + '×' + Math.round(csv.height));
  const tema = rect('#btnTheme');
  ok('Botão de tema ≥ 44px', tema && tema.width >= 44 && tema.height >= 44, tema && Math.round(tema.width) + '×' + Math.round(tema.height));

  // 4. ações da escala (tabela em modo cartão) ≥ 44px
  const acao = rect('#listaEscalas .escala-actions .btn-icon');
  ok('Botões de ação da escala ≥ 44px', acao && acao.width >= 44 && acao.height >= 44, acao && Math.round(acao.width) + '×' + Math.round(acao.height));

  // 5. filtro de mês e importação ≥ 44px
  const filtro = rect('#filtroMes');
  ok('Filtro de mês ≥ 44px', filtro && filtro.height >= 44, filtro && Math.round(filtro.height) + 'px');
  const imp = rect('#btnImportIcs');
  ok('Botão Importar .ics ≥ 44px', imp && imp.height >= 44, imp && Math.round(imp.height) + 'px');

  // 6. tabela em modo cartão (thead oculto)
  const thead = document.querySelector('.escala-table thead');
  ok('Tabela em modo cartão no mobile', thead && getComputedStyle(thead).display === 'none');

  // 7. sem overflow horizontal
  ok('Sem rolagem horizontal', document.documentElement.scrollWidth <= window.innerWidth + 1,
     document.documentElement.scrollWidth + ' vs ' + window.innerWidth);

  // 8. footer com folga para a barra fixa
  const footPad = parseFloat(getComputedStyle(document.querySelector('.site-footer')).paddingBottom);
  const barra = rect('.mobile-bar');
  ok('Footer com folga para a barra fixa', barra && footPad >= barra.height, Math.round(footPad) + 'px de padding vs barra ' + (barra && Math.round(barra.height)) + 'px');

  // 8b. métricas premium: só o card de Valor + resumo em texto
  const cardsVis = [...document.querySelectorAll('.metric-card')].filter((c) => getComputedStyle(c).display !== 'none').length;
  ok('Só o card de Valor visível no mobile', cardsVis === 1, cardsVis + ' card(s)');
  const mResumo = document.getElementById('metricResumoMobile');
  ok('Resumo das métricas visível (Xh · N escalas)', !!mResumo && getComputedStyle(mResumo).display !== 'none' && /escala/.test(mResumo.textContent), mResumo && mResumo.textContent);

  // 8c. lista premium: cards enxutos no lugar da tabela
  ok('Tabela oculta no mobile', getComputedStyle(document.querySelector('.table-wrap')).display === 'none');
  ok('Cards de escala visíveis no mobile', getComputedStyle(document.querySelector('.escala-cards')).display !== 'none');
  const cardVal = document.querySelector('.escala-card .ec-value');
  ok('Card de escala mostra o valor', !!cardVal && cardVal.textContent.includes('R$'), cardVal && cardVal.textContent);
  const cardAcao = rect('.escala-card .escala-actions .btn-icon');
  ok('Ações do card ≥ 44px', cardAcao && cardAcao.width >= 44 && cardAcao.height >= 44, cardAcao && Math.round(cardAcao.width) + '×' + Math.round(cardAcao.height));

  // 9. bottom sheet de lançamento: abre por "Nova escala", fecha pelo X
  const painel = document.querySelector('.launch-panel');
  const btnAdd = document.getElementById('mobileAdd');
  ok('Sheet fechado por padrão', !!painel && !painel.classList.contains('is-open') && getComputedStyle(painel).visibility === 'hidden');
  btnAdd.click();
  await espera(350);
  ok('Nova escala abre o bottom sheet', painel.classList.contains('is-open') && getComputedStyle(painel).visibility === 'visible');
  ok('Backdrop visível ao abrir', document.getElementById('mobileLaunchBackdrop').classList.contains('is-open'));
  ok('Fundo travado (body lock)', document.body.classList.contains('mobile-sheet-open'));
  ok('aria-expanded=true ao abrir', btnAdd.getAttribute('aria-expanded') === 'true');
  const painelRect = painel.getBoundingClientRect();
  ok('Painel ancorado ao rodapé da tela', Math.abs(painelRect.bottom - window.innerHeight) <= 1, Math.round(painelRect.bottom) + ' vs ' + window.innerHeight);

  // 10. duração 14h calcula término e o espelho legível aparece (não depende do repaint do datetime-local)
  const iniS = document.getElementById('escalaInicio');
  iniS.value = '2026-07-10T18:00';
  iniS.dispatchEvent(new Event('change', { bubbles: true }));
  const durS = document.getElementById('escalaDuracao');
  durS.value = '14';
  durS.dispatchEvent(new Event('change', { bubbles: true }));
  await espera(30);
  ok('Duração 14h preenche o término (valor)', document.getElementById('escalaFim').value === '2026-07-11T08:00', document.getElementById('escalaFim').value);
  const resumo = document.getElementById('fimResumo');
  ok('Espelho legível do término visível', !!resumo && resumo.textContent.includes('11/07') && getComputedStyle(resumo).display !== 'none', resumo && resumo.textContent);
  const lResumo = document.getElementById('launchResumo');
  ok('Resumo do lançamento no sheet (14h · 1 PM · AC4 · R$)', !!lResumo && getComputedStyle(lResumo).display !== 'none' && /14h/.test(lResumo.textContent) && /R\\$/.test(lResumo.textContent), lResumo && lResumo.textContent);

  // 11. chips de duração rápida (mobile): clicar 24h ativa o chip e recalcula término
  const chip24 = [...document.querySelectorAll('#durChips .dur-chip')].find((c) => c.dataset.horas === '24');
  ok('Chips de duração visíveis no mobile', getComputedStyle(document.getElementById('durChips')).display !== 'none');
  ok('Select de duração oculto no mobile', getComputedStyle(document.querySelector('#fieldDuracao > .control')).display === 'none');
  chip24.click();
  await espera(30);
  ok('Chip 24h fica ativo ao tocar', chip24.classList.contains('is-active') && document.getElementById('escalaDuracao').value === '24');
  ok('Chip 24h recalcula término', document.getElementById('escalaFim').value === '2026-07-11T18:00', document.getElementById('escalaFim').value);

  // 12. stepper de Qtd. PM
  const qtd = document.getElementById('escalaQtdPm');
  qtd.value = '1';
  document.getElementById('qtdPlus').click();
  document.getElementById('qtdPlus').click();
  ok('Stepper + aumenta Qtd. PM', qtd.value === '3', qtd.value);
  document.getElementById('qtdMinus').click();
  ok('Stepper - diminui Qtd. PM', qtd.value === '2', qtd.value);
  qtd.value = '1'; document.getElementById('qtdMinus').click();
  ok('Stepper não passa de 1 (mínimo)', qtd.value === '1', qtd.value);

  // 13. título do sheet e ícones dos campos
  ok('Título do sheet "Nova escala AC4"', document.getElementById('mobileLaunchTitle').textContent.trim() === 'Nova escala AC4');
  ok('Ícones dos campos visíveis no mobile', getComputedStyle(document.querySelector('#fieldInicio .field-ico')).display !== 'none');

  document.getElementById('mobileLaunchClose').click();
  await espera(350);
  ok('Botão fechar recolhe o sheet', !painel.classList.contains('is-open'));
  ok('Fundo destravado ao fechar', !document.body.classList.contains('mobile-sheet-open'));
  ok('aria-expanded=false ao fechar', btnAdd.getAttribute('aria-expanded') === 'false');

  // 14. instalar app sempre disponível via Compartilhar → Instalar
  const inst = document.getElementById('shareInstallOpt');
  ok('Opção "Instalar" disponível no Compartilhar', !!inst && !inst.classList.contains('hidden'));

  localStorage.removeItem('pmgoEscalas');
  return JSON.stringify(passos);
})()`;

/* iPhone: o Safari não dispara o evento nativo, então o banner de instalação
   deve aparecer proativamente e a opção Instalar deve estar acessível. */
const ROTEIRO_IOS = `(async () => {
  const passos = [];
  const ok = (nome, cond, detalhe = '') => passos.push({ nome, ok: !!cond, detalhe: String(detalhe) });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !document.getElementById('formEscala'); i++) await espera(100);
  ok('iOS detectado como iPhone', /iphone/i.test(navigator.userAgent));
  const banner = document.getElementById('pwaBanner');
  ok('iOS: banner de instalação aparece no carregamento', !!banner && !banner.classList.contains('hidden'));
  const inst = document.getElementById('shareInstallOpt');
  ok('iOS: opção Instalar disponível', !!inst && !inst.classList.contains('hidden'));
  return JSON.stringify(passos);
})()`;

/* Em 320px o interesse é só overflow e a barra não estourar. */
const ROTEIRO_320 = `(async () => {
  const passos = [];
  const ok = (nome, cond, detalhe = '') => passos.push({ nome, ok: !!cond, detalhe: String(detalhe) });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !document.getElementById('formEscala'); i++) await espera(100);
  ok('320px: sem rolagem horizontal', document.documentElement.scrollWidth <= window.innerWidth + 1,
     document.documentElement.scrollWidth + ' vs ' + window.innerWidth);
  const barra = document.querySelector('.mobile-bar')?.getBoundingClientRect();
  ok('320px: barra fixa cabe na tela', barra && barra.width <= window.innerWidth + 1,
     barra && Math.round(barra.width) + 'px');
  return JSON.stringify(passos);
})()`;

const servidor = await iniciarServidor();
const porta = servidor.address().port;
const perfil = await mkdtemp(join(tmpdir(), 'ac4-mob-'));
let chrome;
let falhou = false;

async function rodarViewport(cdp, sessionId, porta, largura, altura, roteiro, titulo) {
  await cdp.enviar('Emulation.setDeviceMetricsOverride', {
    width: largura, height: altura, deviceScaleFactor: 2, mobile: true,
  }, sessionId);
  await cdp.enviar('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  const carregou = cdp.aguardarEvento('Page.loadEventFired');
  await cdp.enviar('Page.navigate', { url: `http://127.0.0.1:${porta}/` }, sessionId);
  await carregou;
  const avaliacao = await cdp.enviar('Runtime.evaluate', {
    expression: roteiro, awaitPromise: true, returnByValue: true,
  }, sessionId);
  if (avaliacao.exceptionDetails) throw new Error(JSON.stringify(avaliacao.exceptionDetails));
  const passos = JSON.parse(avaliacao.result.value);
  console.log(`\n=== ${titulo} ===`);
  console.table(passos.map(({ nome, ok, detalhe }) => ({ verificação: nome, ok, medida: detalhe })));
  if (passos.some((p) => !p.ok)) falhou = true;
}

try {
  chrome = await lancarChrome(acharChrome(), perfil);
  const cdp = await conectarCDP(chrome.wsUrl);
  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
  await cdp.enviar('Page.enable', {}, sessionId);
  await cdp.enviar('Runtime.enable', {}, sessionId);

  await rodarViewport(cdp, sessionId, porta, 393, 852, ROTEIRO_MOBILE, 'Celular 393×852 (padrão Android)');
  await rodarViewport(cdp, sessionId, porta, 320, 568, ROTEIRO_320, 'Celular 320×568 (mínimo)');

  /* iPhone: força o User-Agent de iOS para validar o fluxo de instalação do Safari. */
  await cdp.enviar('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }, sessionId);
  await rodarViewport(cdp, sessionId, porta, 390, 844, ROTEIRO_IOS, 'iPhone (instalação PWA)');

  console.log(falhou ? '\nVALIDAÇÃO MOBILE FALHOU.' : '\nVALIDAÇÃO MOBILE OK — todos os critérios atendidos.');
  process.exitCode = falhou ? 1 : 0;
  cdp.fechar();
} finally {
  chrome?.proc.kill();
  servidor.close();
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
}
