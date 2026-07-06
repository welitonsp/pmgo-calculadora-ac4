/* Smoke test de interface — abre a aplicação real em Chrome headless via
   DevTools Protocol (CDP) e valida o fluxo principal do usuário:
   lançar escala com duração automática → tabela → totais → persistência → .ics.

   Zero dependências npm: servidor HTTP e WebSocket nativos do Node (≥ 22).
   Uso: node tests/smoke.mjs   (CHROME_PATH sobrepõe a detecção do binário) */
import { createServer } from 'node:http';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------ servidor estático */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

function iniciarServidor() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        let caminho = new URL(req.url, 'http://localhost').pathname;
        if (caminho === '/') caminho = '/index.html';
        const arquivo = join(raiz, caminho.replace(/^\/+/, ''));
        const corpo = await readFile(arquivo);
        res.writeHead(200, { 'Content-Type': MIME[extname(arquivo)] || 'application/octet-stream' });
        res.end(corpo);
      } catch {
        res.writeHead(404).end('não encontrado');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* ------------------------------------------------ chrome headless */
function acharChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidatos = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  const achado = candidatos.find((c) => existsSync(c));
  if (!achado) throw new Error('Chrome não encontrado. Defina CHROME_PATH.');
  return achado;
}

function lancarChrome(chrome, perfil) {
  return new Promise((resolve, reject) => {
    const proc = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--disable-extensions', `--user-data-dir=${perfil}`,
      '--remote-debugging-port=0', 'about:blank',
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
}

/* ------------------------------------------------ cliente CDP mínimo */
function conectarCDP(wsUrl) {
  return new Promise((resolve, reject) => {
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
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
        return;
      }
      if (msg.method) {
        for (let i = esperasEvento.length - 1; i >= 0; i--) {
          if (esperasEvento[i].method === msg.method) {
            esperasEvento.splice(i, 1)[0].res(msg.params);
          }
        }
      }
    });
    ws.addEventListener('error', (e) => reject(new Error(`WebSocket: ${e.message || 'falha'}`)));
  });
}

/* ------------------------------------------------ roteiro do smoke test
   Executado dentro da página; retorna JSON com os passos e resultados. */
const ROTEIRO = `(async () => {
  const passos = [];
  const ok = (nome, cond, detalhe = '') => passos.push({ nome, ok: !!cond, detalhe: String(detalhe) });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  // aguarda a inicialização do app (formulário renderizado e listeners ativos)
  for (let i = 0; i < 50 && !document.getElementById('formEscala'); i++) await espera(100);
  localStorage.removeItem('pmgoEscalas');

  ok('Formulário de lançamento presente', !!document.getElementById('formEscala'));
  ok('Métricas presentes', !!document.getElementById('totValor'));

  // 1. duração automática: seg 06/07 07:00 + 14h => 21:00 do mesmo dia
  const ini = document.getElementById('escalaInicio');
  ini.value = '2026-07-06T07:00';
  ini.dispatchEvent(new Event('change', { bubbles: true }));
  const dur = document.getElementById('escalaDuracao');
  dur.value = '14';
  dur.dispatchEvent(new Event('change', { bubbles: true }));
  ok('Duração 14h preenche término automaticamente',
     document.getElementById('escalaFim').value === '2026-07-06T21:00',
     document.getElementById('escalaFim').value);

  // 2. submeter e conferir tabela + totais (14h azul diurna = R$ 420,00)
  document.getElementById('btnSubmit').click();
  await espera(400);
  ok('Escala aparece na tabela', document.querySelectorAll('#listaEscalas tbody tr').length === 1);
  ok('Total de horas = 14h', document.getElementById('totHoras').textContent === '14h',
     document.getElementById('totHoras').textContent);
  ok('Valor estimado = R$ 420,00',
     document.getElementById('totValor').textContent.replace(/\\u00a0/g, ' ').includes('420,00'),
     document.getElementById('totValor').textContent);

  // 3. persistência em localStorage
  const salvas = JSON.parse(localStorage.getItem('pmgoEscalas') || '[]');
  ok('Escala persistida em localStorage', salvas.length === 1);

  // 4. exportação .ics válida (RFC 5545)
  const ics = window.__ac4ValidarICS();
  ok('Arquivo .ics gerado é válido', ics.ok && ics.eventos === 1, JSON.stringify(ics.falhas || []));

  // 5. remoção limpa o estado
  document.querySelector('#listaEscalas [data-acao="remover"]').click();
  await espera(300);
  ok('Remoção limpa a lista', JSON.parse(localStorage.getItem('pmgoEscalas') || '[]').length === 0);

  localStorage.removeItem('pmgoEscalas');
  return JSON.stringify(passos);
})()`;

/* ------------------------------------------------ execução */
const servidor = await iniciarServidor();
const porta = servidor.address().port;
const perfil = await mkdtemp(join(tmpdir(), 'ac4-smoke-'));
let chrome;

try {
  chrome = await lancarChrome(acharChrome(), perfil);
  const cdp = await conectarCDP(chrome.wsUrl);

  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
  await cdp.enviar('Page.enable', {}, sessionId);
  await cdp.enviar('Runtime.enable', {}, sessionId);
  const carregou = cdp.aguardarEvento('Page.loadEventFired');
  await cdp.enviar('Page.navigate', { url: `http://127.0.0.1:${porta}/` }, sessionId);
  await carregou;

  const avaliacao = await cdp.enviar('Runtime.evaluate', {
    expression: ROTEIRO,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);

  if (avaliacao.exceptionDetails) {
    throw new Error(`Erro na página: ${JSON.stringify(avaliacao.exceptionDetails, null, 2)}`);
  }

  const passos = JSON.parse(avaliacao.result.value);
  console.table(passos.map(({ nome, ok, detalhe }) => ({ passo: nome, ok, detalhe })));

  const falhas = passos.filter((p) => !p.ok);
  if (falhas.length) {
    console.error(`SMOKE TEST FALHOU: ${falhas.length} passo(s) com erro.`);
    process.exitCode = 1;
  } else {
    console.log(`SMOKE TEST OK — ${passos.length} passos aprovados.`);
  }
  cdp.fechar();
} finally {
  chrome?.proc.kill();
  servidor.close();
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
}
