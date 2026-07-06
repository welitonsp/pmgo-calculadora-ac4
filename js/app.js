/* ==========================================================================
   Calculadora AC4 — v31
   Módulo principal: estado, UI, persistência e exportações.
   Regras de negócio, formatação e agenda vivem em js/modules/.
   ========================================================================== */
import {
  fmtMoeda, fmtHoras, fmtHorasCheias, fmtDataHora, fmtData, fmtDiaSemana, fmtHora,
  combinarDataHoraLocal, parseDateTimeLocal, formatarDataHoraInput, toInputLocal,
  calcularTerminoPorDuracao, validarIntervaloEscala, toInputMonth, fmtMesRef, escapeHTML,
} from './modules/formato.mjs';
import {
  PORTARIA_ATUAL, VALORES_OFICIAIS, labelOrigem,
  calcularEscala as calcularEscalaBase,
} from './modules/calculo.mjs';
import {
  ICS_DOMAIN, dataICS, desdobrarLinhasICS, parseICS,
  montarICS as montarICSBase,
  validarICS as validarICSBase,
  gerarLinkGoogleAgenda as gerarLinkGoogleAgendaBase,
} from './modules/agenda.mjs';

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };

  const STORAGE = {
    escalas:   'pmgoEscalas',
    config:    'pmgoConfig',
    theme:     'pmgoTheme',
    pwaBanner: 'pmgoPwaBanner',
  };

  /* ------------------------------------------------------------ estado */
  let escalas = [];
  let editandoId = null;
  let ultimaExcluida = null;
  let filtroMes = '';
  let deferredInstallPrompt = null;

  function baixarArquivoAgenda(lista, mensagem = 'Arquivo .ics gerado para importar no Google Agenda.') {
    const arquivo = montarICS(lista);
    if (!arquivo.eventos) {
      toast('Não há escalas válidas para gerar o arquivo .ics.', { erro: true });
      return null;
    }
    baixar(arquivo.conteudo, 'escalas-ac4.ics', 'text/calendar;charset=utf-8');
    const total = `${arquivo.eventos} evento${arquivo.eventos === 1 ? '' : 's'}`;
    const ignoradas = arquivo.ignoradas
      ? ` ${arquivo.ignoradas} escala${arquivo.ignoradas === 1 ? '' : 's'} inválida${arquivo.ignoradas === 1 ? '' : 's'} foram ignoradas.`
      : '';
    toast(`${mensagem} ${total}.${ignoradas}`);
    return arquivo;
  }

  /* -------------------------------------------- tabela de valores */
  const parseMoedaCampo = (id) => {
    const campo = $(id);
    const raw = String((campo ? campo.value : VALORES_OFICIAIS[id]) || '').trim().replace(',', '.');
    if (!raw) return NaN;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : NaN;
  };
  const tabelaVazia = () => ({ portaria: '', valores: { AD: 0, AN: 0, VD: 0, VN: 0 } });

  function lerTabelaAtual() {
    return { portaria: PORTARIA_ATUAL, valores: { AD: parseMoedaCampo('valAD'), AN: parseMoedaCampo('valAN'), VD: parseMoedaCampo('valVD'), VN: parseMoedaCampo('valVN') } };
  }

  function validarTabelaAtual() {
    const tabela = lerTabelaAtual();
    let ok = true;
    const marca = (id, invalido) => {
      const item = $(id) && $(id).closest('.field, .tariff-item');
      if (item) item.classList.toggle('invalid', invalido);
      if (invalido) ok = false;
    };
    Object.entries({ valAD: 'AD', valAN: 'AN', valVD: 'VD', valVN: 'VN' })
      .forEach(([id, key]) => marca(id, !Number.isFinite(tabela.valores[key])));
    if (!ok) { toast('Confira os valores da tabela antes de calcular.', { erro: true }); return null; }
    return tabela;
  }

  const tabelaParaCalculo = () => {
    const atual = lerTabelaAtual();
    return Object.values(atual.valores).every(Number.isFinite) ? atual : tabelaVazia();
  };

  /* Pontes para os módulos — injetam a tabela vigente lida do DOM,
     mantendo as assinaturas originais nos pontos de uso. */
  const calcularEscala = (e) => calcularEscalaBase(e, tabelaParaCalculo());
  const montarICS = (lista) => montarICSBase(lista, tabelaParaCalculo());
  const gerarLinkGoogleAgenda = (e) => gerarLinkGoogleAgendaBase(e, tabelaParaCalculo());

  /* --------------------------------------------- persistência */
  function salvar() {
    localStorage.setItem(STORAGE.escalas, JSON.stringify(escalas));
    sessionStorage.removeItem(STORAGE.escalas);
  }

  function salvarConfig() {
    const val = (id) => ($(id) ? $(id).value : VALORES_OFICIAIS[id]);
    localStorage.setItem(STORAGE.config, JSON.stringify({ ad: val('valAD'), an: val('valAN'), vd: val('valVD'), vn: val('valVN') }));
    render();
  }

  function carregar() {
    Object.entries(VALORES_OFICIAIS).forEach(([id, v]) => { if ($(id)) $(id).value = v; });
    salvarConfig();
    try {
      const legado = sessionStorage.getItem(STORAGE.escalas);
      if (legado) { const p = JSON.parse(legado); if (Array.isArray(p) && p.length) localStorage.setItem(STORAGE.escalas, legado); sessionStorage.removeItem(STORAGE.escalas); }
      const e = JSON.parse(localStorage.getItem(STORAGE.escalas) || '[]');
      if (Array.isArray(e)) escalas = e.filter((x) => x && x.inicio && x.fim);
    } catch { escalas = []; }
  }

  /* --------------------------------------------------------------- tema */
  function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema;
    localStorage.setItem(STORAGE.theme, tema);
    $('icon-sun')?.classList.toggle('hidden', tema !== 'dark');
    $('icon-moon')?.classList.toggle('hidden', tema === 'dark');
  }

  function initTema() {
    const salvo = localStorage.getItem(STORAGE.theme);
    aplicarTema(salvo || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE.theme)) aplicarTema(e.matches ? 'dark' : 'light');
    });
  }

  /* --------------------------------------------------------------- toast */
  function toast(msg, { erro = false, acao = null } = {}) {
    const region = $('toastRegion');
    const el = document.createElement('div');
    el.className = 'toast' + (erro ? ' error' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${escapeHTML(msg)}</span>`;
    if (acao) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = acao.rotulo;
      btn.addEventListener('click', () => { acao.fn(); el.remove(); });
      el.appendChild(btn);
    }
    region.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity 0.3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, acao ? 6000 : 3500);
  }

  /* ---------------------------------------- dialog de confirmação */
  function dialogConfirmar(mensagem, { textoOk = 'Confirmar', perigoso = true } = {}) {
    return new Promise((resolve) => {
      const dlg = $('dialogConfirm');
      if (!dlg) { resolve(window.confirm(mensagem)); return; }
      $('dialogMsg').textContent = mensagem;
      $('dialogOk').textContent = textoOk;
      $('dialogOk').className = `btn ${perigoso ? 'btn-danger-soft' : 'btn-primary'}`;
      dlg.showModal();

      let resolvido = false;
      function finalizar(valor) {
        if (resolvido) return;
        resolvido = true;
        $('dialogOk').removeEventListener('click', onOk);
        $('dialogCancel').removeEventListener('click', onCancel);
        dlg.removeEventListener('click', onBackdrop);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        resolve(valor);
      }
      function onOk()     { finalizar(true); }
      function onCancel() { finalizar(false); }
      function onBackdrop(e) { if (e.target === dlg) finalizar(false); }
      /* Esc fecha o <dialog> nativamente sem passar pelos botões —
         sem este handler a Promise ficaria pendente e os listeners vazariam. */
      function onClose()  { finalizar(false); }
      $('dialogOk').addEventListener('click', onOk);
      $('dialogCancel').addEventListener('click', onCancel);
      dlg.addEventListener('click', onBackdrop);
      dlg.addEventListener('close', onClose);
    });
  }

  const haptic = (p = 10) => { try { navigator.vibrate?.(p); } catch {} };

  function escalasOrdenadas() {
    let lista = [...escalas].sort((a, b) => (parseDateTimeLocal(a.inicio) || new Date(a.inicio)) - (parseDateTimeLocal(b.inicio) || new Date(b.inicio)));
    if (filtroMes) lista = lista.filter((e) => toInputMonth(parseDateTimeLocal(e.inicio) || new Date(e.inicio)) === filtroMes);
    return lista;
  }

  /* -------------------------------------------------- testes de regressão */
  window.__ac4Testes = function () {
    const h = (n) => n * 60;
    const casos = [
      { caso: '1 sex 03/07 18h→sáb 8h (14h)',  inicio: '2026-07-03T18:00', fim: '2026-07-04T08:00', AD: 0,         AN: 0,    VD: h(7),  VN: h(7),  centavos: 59500 },
      { caso: '2 sáb 04/07 8h→dom 8h (24h)',   inicio: '2026-07-04T08:00', fim: '2026-07-05T08:00', AD: 0,         AN: 0,    VD: h(17), VN: h(7),  centavos: 99500 },
      { caso: 'Azul dia: seg 06/07 8h→18h',     inicio: '2026-07-06T08:00', fim: '2026-07-06T18:00', AD: h(10),     AN: 0,    VD: 0,     VN: 0,     centavos: 30000 },
      { caso: 'Azul noite: seg 06/07 22h→ter 5h',inicio:'2026-07-06T22:00', fim: '2026-07-07T05:00', AD: 0,         AN: h(7), VD: 0,     VN: 0,     centavos: 23100 },
      { caso: 'Início qui, vira sex 02/07 20h→sex 6h', inicio: '2026-07-02T20:00', fim: '2026-07-03T06:00', AD: h(3), AN: h(7), VD: 0, VN: 0, centavos: 32100 },
    ];
    const resultados = casos.map((c) => {
      const r = calcularEscala({ inicio: c.inicio, fim: c.fim });
      const ok = ['AD','AN','VD','VN'].every((k) => r.cont[k] === c[k]) && r.valorCentavos === c.centavos;
      return { caso: c.caso, ok, esperado: fmtMoeda(c.centavos), obtido: fmtMoeda(r.valorCentavos) };
    });
    if (console.table) console.table(resultados);
    return resultados.every((r) => r.ok) ? 'TODOS OS CASOS OK' : resultados;
  };

  window.__ac4TestesLancamento = function () {
    const resultados = [];
    const add = (caso, ok, detalhes = '') => resultados.push({ caso, ok: Boolean(ok), detalhes });
    const idsCampos = ['escalaInicio', 'escalaFim', 'escalaDuracao', 'escalaQtdPm', 'escalaDescricao', 'escalaOrigem'];
    const snapshot = {
      escalas: JSON.parse(JSON.stringify(escalas)),
      filtroMes,
      local: localStorage.getItem(STORAGE.escalas),
      session: sessionStorage.getItem(STORAGE.escalas),
      campos: Object.fromEntries(idsCampos.map((id) => [id, $(id)?.value ?? ''])),
    };

    try {
      const inicio12 = formatarDataHoraInput(combinarDataHoraLocal('2026-07-05', '08:00'));
      const fim12 = calcularTerminoPorDuracao(inicio12, 12);
      const inicio14 = formatarDataHoraInput(combinarDataHoraLocal('2026-07-10', '18:00'));
      const fim14 = calcularTerminoPorDuracao(inicio14, 14);
      const inicio24 = formatarDataHoraInput(combinarDataHoraLocal('2026-07-05', '08:00'));
      const fim24 = calcularTerminoPorDuracao(inicio24, 24);

      add('Combinar data + hora inicial', inicio12 === '2026-07-05T08:00', inicio12);
      add('Calcular término de 12h', fim12 === '2026-07-05T20:00', fim12);
      add('Calcular término de 14h com virada de dia', fim14 === '2026-07-11T08:00', fim14);
      add('Calcular término de 24h com virada de dia', fim24 === '2026-07-06T08:00', fim24);
      add('Aceitar término maior que início', validarIntervaloEscala(inicio24, fim24).ok);
      add('Rejeitar término igual ao início', !validarIntervaloEscala(inicio24, inicio24).ok);
      add('Rejeitar término anterior ao início', !validarIntervaloEscala(fim24, inicio24).ok);

      const escalaTeste = {
        id: 'teste-lancamento-ac4',
        inicio: inicio24,
        fim: fim24,
        descricao: 'Escala AC4',
        origem: 'AC4',
        qtdPm: 1,
        tabela: lerTabelaAtual(),
      };
      add('Simular criação de objeto de escala', escalaTeste.inicio === '2026-07-05T08:00' && escalaTeste.fim === '2026-07-06T08:00' && escalaTeste.origem === 'AC4');

      escalas = [];
      filtroMes = '';
      escalas.push(escalaTeste);
      salvar();
      const gravadas = JSON.parse(localStorage.getItem(STORAGE.escalas) || '[]');
      add('Adicionar escala válida ao estado', escalas.length === 1 && escalas[0].id === escalaTeste.id);
      add('Storage grava e recupera escalas', gravadas.length === 1 && gravadas[0].fim === '2026-07-06T08:00');

      render();
      const linhas = document.querySelectorAll('#listaEscalas tbody tr').length;
      add('Renderizar lista/tabela após adicionar escala', linhas === 1, `${linhas} linha(s)`);
      add('Totais recalculados após adicionar escala', $('totHoras')?.textContent === '24h' && $('totValor')?.textContent !== 'R$ 0,00', `${$('totHoras')?.textContent} / ${$('totValor')?.textContent}`);
    } finally {
      escalas = snapshot.escalas;
      filtroMes = snapshot.filtroMes;
      if (snapshot.local === null) localStorage.removeItem(STORAGE.escalas);
      else localStorage.setItem(STORAGE.escalas, snapshot.local);
      if (snapshot.session === null) sessionStorage.removeItem(STORAGE.escalas);
      else sessionStorage.setItem(STORAGE.escalas, snapshot.session);
      Object.entries(snapshot.campos).forEach(([id, valor]) => { if ($(id)) $(id).value = valor; });
      render();
    }

    if (console.table) console.table(resultados);
    return resultados.every((r) => r.ok) ? 'TODOS OS TESTES DE LANCAMENTO OK' : resultados;
  };

  /* --------------------------------------------------------------- ações */
  function lerQtdPm() {
    const val = parseInt($('escalaQtdPm')?.value || '1', 10);
    return Number.isFinite(val) && val >= 1 ? val : 1;
  }

  function validarFormulario() {
    const inicio = $('escalaInicio').value;
    const fim    = $('escalaFim').value;
    const intervalo = validarIntervaloEscala(inicio, fim);
    let ok = true;

    const marca = (fieldId, invalido) => {
      $(fieldId).classList.toggle('invalid', invalido);
      const ctrl = $(fieldId).querySelector('.control');
      if (ctrl) ctrl.setAttribute('aria-invalid', invalido ? 'true' : 'false');
      if (invalido) ok = false;
    };
    marca('fieldInicio', !intervalo.ok && intervalo.campo === 'inicio');
    marca('fieldFim', !intervalo.ok && intervalo.campo === 'fim');

    if (!ok) {
      toast(intervalo.mensagem || 'Confira os campos obrigatórios da escala.', { erro: true });
      return null;
    }

    const campoDesc = $('escalaDescricao');
    const descricao = (campoDesc && campoDesc.value.trim()) || 'Escala AC4';
    const origem = $('escalaOrigem')?.value || 'AC4';
    const qtdPm = lerQtdPm();
    return { inicio, fim, descricao, origem, qtdPm };
  }

  async function submeterFormulario() {
    const dados = validarFormulario();
    if (!dados) return;

    const duracaoHoras = (parseDateTimeLocal(dados.fim) - parseDateTimeLocal(dados.inicio)) / 3600000;
    if (duracaoHoras > 24) {
      const ok = await dialogConfirmar(
        `A escala tem ${duracaoHoras.toFixed(1)} horas de duração. Confirma?`,
        { textoOk: 'Confirmar', perigoso: false }
      );
      if (!ok) return;
    }

    const tabelaAtual = validarTabelaAtual();
    if (!tabelaAtual) return;

    haptic(10);

    if (editandoId !== null) {
      const idx = escalas.findIndex((e) => e.id === editandoId);
      if (idx >= 0) escalas[idx] = { ...escalas[idx], ...dados, tabela: escalas[idx].tabela || tabelaAtual };
      cancelarEdicao();
      toast('Escala atualizada.');
    } else {
      escalas.push({ id: Date.now() + Math.random(), ...dados, tabela: tabelaAtual });
      if ($('escalaDescricao')) $('escalaDescricao').value = '';
      if ($('escalaQtdPm'))    $('escalaQtdPm').value = '1';
      if ($('escalaOrigem'))   $('escalaOrigem').value = 'AC4';
      toast('Escala adicionada.');
    }
    salvar();
    render();
  }

  function editarEscala(id) {
    const e = escalas.find((x) => x.id === id);
    if (!e) return;
    editandoId = id;
    $('escalaInicio').value = e.inicio;
    $('escalaFim').value   = e.fim;
    if ($('escalaDuracao')) $('escalaDuracao').value = '';
    if ($('escalaQtdPm'))    $('escalaQtdPm').value = e.qtdPm || 1;
    if ($('escalaDescricao')) $('escalaDescricao').value = e.descricao === 'Escala AC4' ? '' : (e.descricao || '');
    if ($('escalaOrigem'))   $('escalaOrigem').value = e.origem || 'AC4';
    $('btnSubmit').textContent = 'Salvar alterações';
    $('btnCancelEdit').classList.remove('hidden');
    $('formTitle').lastChild.textContent = ' Editar escala';
    document.querySelector('.launch-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('escalaInicio').focus();
  }

  function cancelarEdicao() {
    editandoId = null;
    if ($('escalaDescricao')) $('escalaDescricao').value = '';
    if ($('escalaQtdPm'))    $('escalaQtdPm').value = '1';
    if ($('escalaOrigem'))   $('escalaOrigem').value = 'AC4';
    $('btnSubmit').textContent = 'Adicionar escala';
    $('btnCancelEdit').classList.add('hidden');
    $('formTitle').lastChild.textContent = ' Lançar escala';
    ['fieldInicio', 'fieldFim'].forEach((f) => {
      $(f).classList.remove('invalid');
      $(f).querySelector('.control')?.removeAttribute('aria-invalid');
    });
  }

  function duplicarEscala(id) {
    const e = escalas.find((x) => x.id === id);
    if (!e) return;
    const umDia = 24 * 3600000;
    escalas.push({
      ...e,
      id: Date.now() + Math.random(),
      inicio: toInputLocal(new Date((parseDateTimeLocal(e.inicio) || new Date(e.inicio)).getTime() + umDia)),
      fim:    toInputLocal(new Date((parseDateTimeLocal(e.fim) || new Date(e.fim)).getTime() + umDia)),
    });
    haptic([10, 30, 10]);
    salvar(); render();
    toast('Escala duplicada para o dia seguinte.');
  }

  function removerEscala(id) {
    const e = escalas.find((x) => x.id === id);
    if (!e) return;
    ultimaExcluida = e;
    escalas = escalas.filter((x) => x.id !== id);
    if (editandoId === id) cancelarEdicao();
    haptic([10, 20]);
    salvar(); render();
    toast('Escala removida.', {
      acao: { rotulo: 'Desfazer', fn: () => { if (ultimaExcluida) { escalas.push(ultimaExcluida); ultimaExcluida = null; salvar(); render(); } } },
    });
  }

  async function limparTudo() {
    if (!escalas.length) return;
    const ok = await dialogConfirmar(`Remover todas as ${escalas.length} escala${escalas.length === 1 ? '' : 's'}? Esta ação não pode ser desfeita.`);
    if (!ok) return;
    escalas = []; cancelarEdicao(); salvar(); render();
    toast('Todas as escalas foram removidas.');
  }

  /* -------------------------------------------------------- filtro por mês */
  function atualizarSelectMes() {
    const sel = $('filtroMes');
    if (!sel) return;
    const meses = new Set(escalas.map((e) => toInputMonth(parseDateTimeLocal(e.inicio) || new Date(e.inicio))));
    const antigo = sel.value;
    sel.innerHTML = '<option value="">Todos os meses</option>';
    [...meses].sort().forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = fmtMesRef(m);
      if (m === antigo) opt.selected = true;
      sel.appendChild(opt);
    });
    filtroMes = meses.has(antigo) ? antigo : '';
    if (sel.value !== filtroMes) sel.value = filtroMes;
  }

  /* ------------------------------------------------------- compartilhar */
  function gerarTextoResumo() {
    const lista = escalasOrdenadas();
    if (!lista.length) return '';
    const resultados = lista.map((e) => ({ e, r: calcularEscala(e) }));
    const totMins  = resultados.reduce((s, x) => s + x.r.mins, 0);
    const totValor = resultados.reduce((s, x) => s + x.r.valorCentavos * (x.e.qtdPm || 1), 0);

    const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const SEP = '─────────────────────';

    const dataCompleta = (iso) => {
      const d = new Date(iso);
      return `${DIAS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    };

    let texto = `📋 *SIMULAÇÃO DE ESCALAS — AC4 / PMGO*\n${SEP}\n\n`;

    resultados.forEach(({ e, r }, i) => {
      const qtd       = e.qtdPm || 1;
      const isVerm    = r.minVermelha > 0;
      const tipoEmoji = isVerm ? '🔴' : '🔵';
      const tipoNome  = isVerm ? 'Vermelha' : 'Azul';
      const mesmodia  = fmtData(e.inicio) === fmtData(e.fim);
      const fimStr    = mesmodia
        ? fmtHora(e.fim)
        : `${fmtHora(e.fim)} (${DIAS[new Date(e.fim).getDay()]}, ${String(new Date(e.fim).getDate()).padStart(2, '0')}/${String(new Date(e.fim).getMonth() + 1).padStart(2, '0')})`;

      if (lista.length > 1) {
        texto += `*${i + 1}. Escala ${tipoNome} ${tipoEmoji}*\n`;
      } else {
        texto += `*Escala ${tipoNome} ${tipoEmoji}*\n`;
      }

      texto += `📅 ${dataCompleta(e.inicio)}\n`;
      texto += `🕐 ${fmtHora(e.inicio)} → ${fimStr}\n`;

      if (r.minNoturno > 0 && r.minDiurno > 0) {
        texto += `⏱ ${fmtHoras(r.mins)}  |  Diurno: ${fmtHorasCheias(r.minDiurno)}  /  Noturno: ${fmtHorasCheias(r.minNoturno)}\n`;
      } else {
        texto += `⏱ ${fmtHoras(r.mins)} (${r.minNoturno > 0 ? 'Noturno' : 'Diurno'})\n`;
      }

      const unidStr = e.descricao && e.descricao !== 'Escala AC4' ? e.descricao : '—';
      const oriStr  = (e.origem || 'AC4').replace('CONVENIO_', 'Conv. ').replace('FAZENDARIO_SEC_ECON', 'Fazendário/Sec.Econ.');
      texto += `📍 Unidade: ${unidStr}  |  Origem: ${oriStr}\n`;

      if (qtd > 1) {
        texto += `👮 ${qtd} PMs  ·  ${fmtMoeda(r.valorCentavos)}/PM\n`;
        texto += `💰 *${fmtMoeda(r.valorCentavos * qtd)}* (total ${qtd} PMs)\n`;
      } else {
        texto += `💰 *${fmtMoeda(r.valorCentavos)}*\n`;
      }

      if (i < resultados.length - 1) texto += `\n${SEP}\n\n`;
    });

    if (lista.length > 1) {
      texto += `\n${SEP}\n`;
      texto += `📊 *TOTAL — ${lista.length} escalas*\n`;
      texto += `⏱ ${fmtHoras(totMins)}  |  💰 *${fmtMoeda(totValor)}*\n`;
      texto += `${SEP}\n`;
    }

    texto += `\n⚠️ _Portaria SSP n.º 621/2026 · Valor simulado_\n`;
    texto += `_Sujeito à conferência administrativa — AC4 PMGO_`;
    return texto;
  }

  async function compartilharWhatsApp() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de compartilhar.', { erro: true }); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(gerarTextoResumo())}`, '_blank', 'noopener');
  }

  async function compartilharNativo() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de compartilhar.', { erro: true }); return; }
    try { await navigator.share({ title: 'Relatório AC4', text: gerarTextoResumo() }); }
    catch (e) { if (e.name !== 'AbortError') compartilharWhatsApp(); }
  }

  async function copiarResumo() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de copiar.', { erro: true }); return; }
    try {
      await navigator.clipboard.writeText(gerarTextoResumo());
      haptic([10, 10]);
      toast('Resumo copiado para a área de transferência!');
    } catch { toast('Não foi possível copiar automaticamente.', { erro: true }); }
  }

  function abrirShareSheet() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de compartilhar.', { erro: true }); return; }
    const dlg = $('dialogShare');
    if (!dlg) { compartilharWhatsApp(); return; }
    const nativeBtn = $('shareNative');
    if (nativeBtn) nativeBtn.style.display = navigator.share ? '' : 'none';
    dlg.showModal();
  }

  /* ------------------------------------------------- importação de .ics */
  let importEventos = [];

  const normalizarBusca = (s) =>
    String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function eventoPreSelecionado(ev) {
    const de  = $('impDataIni')?.value || '';
    const ate = $('impDataFim')?.value || '';
    const dia = ev.inicio.slice(0, 10);
    if (de && dia < de) return false;
    if (ate && dia > ate) return false;
    const palavras = ($('impPalavras')?.value || '')
      .split(',').map((p) => normalizarBusca(p.trim())).filter(Boolean);
    if (!palavras.length) return true;
    const alvo = normalizarBusca(ev.resumo);
    return palavras.some((p) => alvo.includes(p));
  }

  function atualizarListaImportacao() {
    const lista = $('impLista');
    if (!lista) return;
    lista.innerHTML = importEventos.map((ev, i) => {
      const marcado = eventoPreSelecionado(ev);
      const r = calcularEscala({ inicio: ev.inicio, fim: ev.fim });
      return `
        <label class="import-item${marcado ? '' : ' fora'}">
          <input type="checkbox" data-idx="${i}" ${marcado ? 'checked' : ''}>
          <span>
            <span class="t">${escapeHTML(ev.resumo || 'Evento sem título')}</span><br>
            <span class="d">${fmtDataHora(ev.inicio)} → ${fmtDataHora(ev.fim)} · ${fmtHoras(r.mins)} · ${fmtMoeda(r.valorCentavos)}</span>
          </span>
        </label>`;
    }).join('');
    atualizarStatusImportacao();
    lista.querySelectorAll('input[type="checkbox"]').forEach((c) =>
      c.addEventListener('change', atualizarStatusImportacao));
  }

  function atualizarStatusImportacao() {
    const marcados = document.querySelectorAll('#impLista input:checked').length;
    if ($('impStatus')) $('impStatus').textContent =
      `${marcados} de ${importEventos.length} evento${importEventos.length === 1 ? '' : 's'} selecionado${marcados === 1 ? '' : 's'}.`;
  }

  function confirmarImportacao() {
    const marcados = [...document.querySelectorAll('#impLista input:checked')]
      .map((c) => importEventos[Number(c.dataset.idx)]).filter(Boolean);
    if (!marcados.length) { toast('Selecione ao menos um evento para importar.', { erro: true }); return; }
    const tabelaAtual = validarTabelaAtual();
    if (!tabelaAtual) return;

    const existentes = new Set(escalas.map((e) => `${e.inicio}|${e.fim}`));
    let novos = 0, duplicados = 0;
    marcados.forEach((ev) => {
      const chave = `${ev.inicio}|${ev.fim}`;
      if (existentes.has(chave)) { duplicados++; return; }
      existentes.add(chave);
      escalas.push({
        id: Date.now() + Math.random(),
        inicio: ev.inicio,
        fim: ev.fim,
        descricao: (ev.resumo || '').slice(0, 80) || 'Escala AC4',
        origem: 'AC4',
        qtdPm: 1,
        tabela: tabelaAtual,
      });
      novos++;
    });

    $('dialogImport')?.close();
    haptic([10, 30, 10]);
    salvar(); render();
    const extra = duplicados ? ` ${duplicados} já existia${duplicados === 1 ? '' : 'm'} e fo${duplicados === 1 ? 'i' : 'ram'} ignorada${duplicados === 1 ? '' : 's'}.` : '';
    toast(`${novos} escala${novos === 1 ? '' : 's'} importada${novos === 1 ? '' : 's'} da agenda.${extra}`);
  }

  async function lerArquivoImportacao() {
    const arquivo = $('impArquivo')?.files?.[0];
    if (!arquivo) return;
    try {
      const { eventos, ignorados } = parseICS(await arquivo.text());
      if (!eventos.length) {
        toast(`Nenhum evento com data e hora válidas no arquivo.${ignorados ? ` (${ignorados} sem horário ou inválidos)` : ''}`, { erro: true });
        return;
      }
      importEventos = eventos.sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
      atualizarListaImportacao();
      if (ignorados) toast(`${ignorados} evento${ignorados === 1 ? '' : 's'} sem horário fo${ignorados === 1 ? 'i' : 'ram'} ignorado${ignorados === 1 ? '' : 's'} (dia inteiro ou inválido).`);
      $('dialogImport')?.showModal();
    } catch {
      toast('Não foi possível ler o arquivo. Confira se é um .ics válido.', { erro: true });
    }
  }

  function initImportacao() {
    on('btnImportIcs', 'click', () => { if ($('impArquivo')) { $('impArquivo').value = ''; $('impArquivo').click(); } });
    on('impArquivo', 'change', lerArquivoImportacao);
    on('impConfirmar', 'click', confirmarImportacao);
    on('impCancelar', 'click', () => $('dialogImport')?.close());
    ['impDataIni', 'impDataFim', 'impPalavras'].forEach((id) => {
      on(id, 'input', atualizarListaImportacao);
      on(id, 'change', atualizarListaImportacao);
    });
  }

  /* ----------------------------------------------------------- render */
  function render() {
    atualizarSelectMes();
    const lista = escalasOrdenadas();
    const resultados = lista.map((e) => ({ e, r: calcularEscala(e) }));

    const totMins    = resultados.reduce((s, x) => s + x.r.mins, 0);
    const totDiurno  = resultados.reduce((s, x) => s + x.r.minDiurno, 0);
    const totNoturno = resultados.reduce((s, x) => s + x.r.minNoturno, 0);
    const totValor   = resultados.reduce((s, x) => s + x.r.valorCentavos * (x.e.qtdPm || 1), 0);

    $('totHoras').textContent    = fmtHoras(totMins);
    $('totDiurnas').textContent  = fmtHorasCheias(totDiurno);
    $('totNoturnas').textContent = fmtHorasCheias(totNoturno);
    $('totValor').textContent    = fmtMoeda(totValor);
    $('mobileTotal').textContent = fmtMoeda(totValor);
    $('pctDiurnas').textContent  = totMins ? `${((totDiurno  / totMins) * 100).toFixed(1).replace('.', ',')}% do total` : '0% do total';
    $('pctNoturnas').textContent = totMins ? `${((totNoturno / totMins) * 100).toFixed(1).replace('.', ',')}% do total` : '0% do total';

    const sufixo = filtroMes ? ` em ${fmtMesRef(filtroMes)}` : ' no período';
    $('totQtd').textContent = `${lista.length} escala${lista.length === 1 ? '' : 's'}${sufixo}`;
    $('btnClearAll').classList.toggle('hidden', escalas.length === 0);

    const container = $('listaEscalas');
    if (!lista.length) {
      const msg = filtroMes ? 'Nenhuma escala neste mês. Selecione outro período.' : 'Preencha o formulário acima para iniciar o cálculo.';
      container.innerHTML = `
        <div class="empty-state">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>
          </svg>
          <h3>Nenhuma escala lançada</h3>
          <p>${escapeHTML(msg)}</p>
        </div>`;
      return;
    }

    let html = `
      <div class="table-wrap">
        <table class="escala-table">
          <thead><tr>
            <th>Dia</th><th>Data</th><th>Início</th><th>Término</th>
            <th>Tipo</th><th>Horas</th><th>Valor</th><th>Ações</th>
          </tr></thead>
          <tbody>`;

    resultados.forEach(({ e, r }) => {
      const qtd = e.qtdPm || 1;
      const valorTotal = r.valorCentavos * qtd;
      const tipoChips = [];
      if (r.minVermelha > 0) tipoChips.push('<span class="chip chip-red">Vermelha</span>');
      if (r.minVermelha < r.mins) tipoChips.push('<span class="chip chip-blue">Azul</span>');
      tipoChips.push(r.minNoturno > 0
        ? `<span class="chip chip-night">${fmtHorasCheias(r.minNoturno)} noturno</span>`
        : '<span class="chip chip-day">Diurno</span>');
      if (qtd > 1) tipoChips.push(`<span class="chip chip-neutral">${qtd} PMs</span>`);
      const origemLabel = (e.origem || 'AC4').replace('CONVENIO_', 'Conv. ').replace('FAZENDARIO_SEC_ECON', 'Fazendário');
      tipoChips.push(`<span class="chip chip-origem">${escapeHTML(origemLabel)}</span>`);

      const fimStr = fmtData(e.inicio) === fmtData(e.fim) ? fmtHora(e.fim) : `${fmtData(e.fim)} ${fmtHora(e.fim)}`;
      const unidadeTexto = e.descricao && e.descricao !== 'Escala AC4' ? e.descricao : '-';
      const unidadeNota = `<span class="table-note">Unidade: ${escapeHTML(unidadeTexto)}</span>`;

      html += `
        <tr>
          <td data-label="Dia">${fmtDiaSemana(e.inicio)}</td>
          <td data-label="Data">${fmtData(e.inicio)}${unidadeNota}</td>
          <td data-label="Início">${fmtHora(e.inicio)}</td>
          <td data-label="Término">${fimStr}</td>
          <td data-label="Tipo"><div class="chips">${tipoChips.join('')}</div></td>
          <td data-label="Horas">${fmtHoras(r.mins)}</td>
          <td data-label="Valor" class="value-cell">${fmtMoeda(valorTotal)}${qtd > 1 ? `<span class="table-note">${fmtMoeda(r.valorCentavos)}/PM</span>` : ''}</td>
          <td data-label="Ações">
            <div class="escala-actions">
              <button class="btn-icon gcal" data-acao="agenda" data-id="${e.id}" title="Adicionar ao Google Agenda" aria-label="Adicionar ao Google Agenda">
                <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 13v4M10 15h4"/></svg>
              </button>
              <button class="btn-icon" data-acao="duplicar" data-id="${e.id}" title="Duplicar para o dia seguinte" aria-label="Duplicar">
                <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
              </button>
              <button class="btn-icon" data-acao="editar" data-id="${e.id}" title="Editar" aria-label="Editar">
                <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
              <button class="btn-icon delete" data-acao="remover" data-id="${e.id}" title="Excluir" aria-label="Excluir">
                <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    });
    html += '</tbody>';
    if (lista.length > 1) {
      html += `
        <tfoot>
          <tr class="table-total-row">
            <td colspan="5">Total geral (${lista.length} escalas)</td>
            <td>${fmtHoras(totMins)}</td>
            <td class="value-cell">${fmtMoeda(totValor)}</td>
            <td></td>
          </tr>
        </tfoot>`;
    }
    html += '</table></div>';
    container.innerHTML = html;

  }

  /* ------------------------------------------------------- exportações */

  /* Popula #printReport e chama window.print() */
  function imprimirRelatorio() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de imprimir.', { erro: true }); return; }

    const resultados = lista.map((e) => ({ e, r: calcularEscala(e) }));
    const totMins    = resultados.reduce((s, x) => s + x.r.mins, 0);
    const totDiurno  = resultados.reduce((s, x) => s + x.r.minDiurno, 0);
    const totNoturno = resultados.reduce((s, x) => s + x.r.minNoturno, 0);
    const totValor   = resultados.reduce((s, x) => s + x.r.valorCentavos * (x.e.qtdPm || 1), 0);

    const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    $('prDate').textContent = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    $('prSummary').innerHTML = [
      `<div><span class="pr-label">Escalas:</span> <strong>${lista.length}</strong></div>`,
      `<div><span class="pr-label">Horas totais:</span> <strong>${fmtHoras(totMins)}</strong></div>`,
      `<div><span class="pr-label">H. diurnas:</span> <strong>${fmtHorasCheias(totDiurno)}</strong></div>`,
      `<div><span class="pr-label">H. noturnas:</span> <strong>${fmtHorasCheias(totNoturno)}</strong></div>`,
      `<div><span class="pr-label">Valor estimado:</span> <strong>${fmtMoeda(totValor)}</strong></div>`,
    ].join('');

    let rows = '';
    resultados.forEach(({ e, r }, i) => {
      const qtd      = e.qtdPm || 1;
      const valor    = r.valorCentavos * qtd;
      const mesmodia = fmtData(e.inicio) === fmtData(e.fim);
      const fimStr   = mesmodia ? fmtHora(e.fim) : `${fmtData(e.fim)} ${fmtHora(e.fim)}`;
      const unidade  = e.descricao && e.descricao !== 'Escala AC4' ? escapeHTML(e.descricao) : '—';
      const origem   = escapeHTML(labelOrigem(e.origem));
      const valorCell = qtd > 1
        ? `${fmtMoeda(valor)}<small>${fmtMoeda(r.valorCentavos)}/PM</small>`
        : fmtMoeda(valor);
      rows += `
        <tr>
          <td class="pr-num">${i + 1}</td>
          <td class="pr-center">${DIAS[new Date(e.inicio).getDay()]}</td>
          <td>${fmtData(e.inicio)}</td>
          <td class="pr-center">${fmtHora(e.inicio)}</td>
          <td>${fimStr}</td>
          <td class="pr-center">${fmtHoras(r.mins)}</td>
          <td>${unidade}</td>
          <td>${origem}</td>
          <td class="pr-center">${fmtHorasCheias(r.minDiurno)}</td>
          <td class="pr-center">${fmtHorasCheias(r.minNoturno)}</td>
          <td class="pr-valor">${valorCell}</td>
        </tr>`;
    });

    const totalRow = lista.length > 1 ? `
      <tfoot>
        <tr class="pr-total-row">
          <td colspan="8">TOTAL GERAL</td>
          <td class="pr-center">${fmtHorasCheias(totDiurno)}</td>
          <td class="pr-center">${fmtHorasCheias(totNoturno)}</td>
          <td class="pr-valor">${fmtMoeda(totValor)}</td>
        </tr>
      </tfoot>` : '';

    $('prTableWrap').innerHTML = `
      <table class="pr-table">
        <thead>
          <tr>
            <th>N.º</th><th>Dia</th><th>Data</th><th>Início</th>
            <th>Término</th><th>Duração</th><th>Unidade</th>
            <th>Origem Remunerado</th><th>H. Diurnas</th>
            <th>H. Noturnas</th><th>Valor Estimado</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        ${totalRow}
      </table>`;

    window.print();
  }

  /* Botão principal da topbar — pergunta ao usuário e abre o Google Calendar */
  async function abrirAgendaGoogle() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de salvar na agenda.', { erro: true }); return; }

    if (lista.length > 1) {
      const okMulti = await dialogConfirmar(
        `Gerar um arquivo .ics com as ${lista.length} escalas para importar no Google Agenda?`,
        { textoOk: 'Gerar arquivo .ics', perigoso: false }
      );
      if (!okMulti) return;
      haptic(10);
      baixarArquivoAgenda(lista, 'Arquivo .ics gerado com todas as escalas para o Google Agenda.');
      return;
    }

    const ok = await dialogConfirmar(`Deseja salvar a escala "${lista[0].descricao}" no Google Agenda?`, { textoOk: 'Abrir Google Agenda', perigoso: false });
    if (!ok) return;

    haptic(10);
    window.open(gerarLinkGoogleAgenda(lista[0]), '_blank', 'noopener');
  }

  /* Download .ics para importação manual — acessível pelo share sheet */
  function exportarICS() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de gerar o arquivo .ics.', { erro: true }); return; }
    baixarArquivoAgenda(lista, 'Arquivo gerado. Use "Importar" na Agenda Google.');
  }

  async function abrirAgendaGoogleItem(id) {
    const e = escalas.find((x) => x.id === id);
    if (!e) return;
    const ok = await dialogConfirmar(
      `Deseja salvar a escala "${e.descricao}" no Google Agenda?`,
      { textoOk: 'Abrir Google Agenda', perigoso: false }
    );
    if (!ok) return;
    haptic(10);
    window.open(gerarLinkGoogleAgenda(e), '_blank', 'noopener');
  }

  function exportarCSV() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de exportar CSV.', { erro: true }); return; }
    const sep = ';';
    const num = (cent) => (cent / 100).toFixed(2).replace('.', ',');
    const linhas = [['Unidade', 'Origem', 'Início', 'Término', 'Qtd. PM', 'Horas', 'H. diurnas', 'H. noturnas', 'Portaria', 'Valor/PM (R$)', 'Valor total (R$)'].join(sep)];
    let total = 0;
    lista.forEach((e) => {
      const r = calcularEscala(e);
      const qtd = e.qtdPm || 1;
      const valorTotal = r.valorCentavos * qtd;
      total += valorTotal;
      linhas.push([
        `"${(e.descricao || 'Escala AC4').replace(/"/g, '""')}"`,
        `"${(e.origem || 'AC4').replace(/"/g, '""')}"`,
        fmtDataHora(e.inicio), fmtDataHora(e.fim),
        qtd,
        (r.mins / 60).toFixed(2).replace('.', ','),
        (r.minDiurno  / 60).toFixed(2).replace('.', ','),
        (r.minNoturno / 60).toFixed(2).replace('.', ','),
        `"${(r.tabela.portaria || '').replace(/"/g, '""')}"`,
        num(r.valorCentavos),
        num(valorTotal),
      ].join(sep));
    });
    linhas.push(['TOTAL', '', '', '', '', '', '', '', '', '', num(total)].join(sep));
    baixar('﻿' + linhas.join('\r\n'), 'escalas-ac4.csv', 'text/csv;charset=utf-8');
    toast('Planilha CSV gerada.');
  }

  function baixar(conteudo, nome, tipo) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* -------------------------------------------- validar ICS (debug) */
  window.__ac4ValidarICS = function (entrada) {
    const fonte = Array.isArray(entrada) ? entrada : escalasOrdenadas();
    const resultado = validarICSBase(fonte, tabelaParaCalculo());
    if (resultado.falhas.length && console.table) console.table(resultado.falhas);
    return resultado;
  };

  window.__ac4TestesAgendamento = function () {
    const casos = [
      { id: 'agenda-2027-08-03', inicio: '2027-08-03T18:00', fim: '2027-08-04T08:00', descricao: 'Escala 03/08/2027', origem: 'AC4', qtdPm: 1 },
      { id: 'agenda-2026-08-05', inicio: '2026-08-05T08:00', fim: '2026-08-06T08:00', descricao: 'Escala 05/08/2026', origem: 'AC4', qtdPm: 1 },
    ];
    const arquivo = montarICS(casos);
    const linhas = desdobrarLinhasICS(arquivo.conteudo);
    const eventos = linhas.filter((l) => l === 'BEGIN:VEVENT').length;
    const uids = linhas.filter((l) => l.startsWith('UID:')).map((l) => l.slice(4));
    const esperado = [
      `DTSTART:${dataICS(casos[0].inicio)}`,
      `DTEND:${dataICS(casos[0].fim)}`,
      `DTSTART:${dataICS(casos[1].inicio)}`,
      `DTEND:${dataICS(casos[1].fim)}`,
    ];
    const resultados = [
      { caso: 'Gera dois eventos no mesmo arquivo .ics', ok: arquivo.eventos === 2 && eventos === 2 },
      { caso: 'Inclui as datas da escala de 03/08/2027', ok: linhas.includes(esperado[0]) && linhas.includes(esperado[1]) },
      { caso: 'Inclui as datas da escala de 05/08/2026', ok: linhas.includes(esperado[2]) && linhas.includes(esperado[3]) },
      { caso: 'Gera UIDs estáveis e únicos', ok: uids.length === 2 && new Set(uids).size === 2 && uids.every((uid) => uid.endsWith(`@${ICS_DOMAIN}`)) },
      { caso: 'Validação iCalendar aprova múltiplas escalas', ok: window.__ac4ValidarICS(casos).ok },
    ];
    if (console.table) console.table(resultados);
    return resultados.every((r) => r.ok) ? 'TODOS OS TESTES DE AGENDAMENTO OK' : resultados;
  };

  window.__ac4TestesImportacao = function () {
    const fixture = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Teste//PT-BR',
      // 1. flutuante (hora local) com vírgula escapada no SUMMARY
      'BEGIN:VEVENT', 'UID:imp-1@teste', 'DTSTAMP:20260701T000000Z',
      'DTSTART:20260810T180000', 'DTEND:20260811T080000',
      'SUMMARY:Extra AC4 - Est\\, dio', 'END:VEVENT',
      // 2. UTC (sufixo Z) — deve converter para o fuso local
      'BEGIN:VEVENT', 'UID:imp-2@teste', 'DTSTAMP:20260701T000000Z',
      'DTSTART:20260812T210000Z', 'DTEND:20260813T090000Z',
      'SUMMARY:Plantao escala', 'END:VEVENT',
      // 3. dia inteiro (VALUE=DATE) — deve ser ignorado
      'BEGIN:VEVENT', 'UID:imp-3@teste', 'DTSTAMP:20260701T000000Z',
      'DTSTART;VALUE=DATE:20260815', 'DTEND;VALUE=DATE:20260816',
      'SUMMARY:Feriado', 'END:VEVENT',
      // 4. término antes do início — deve ser ignorado
      'BEGIN:VEVENT', 'UID:imp-4@teste', 'DTSTAMP:20260701T000000Z',
      'DTSTART:20260820T100000', 'DTEND:20260820T080000',
      'SUMMARY:Invalido', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const { eventos, ignorados } = parseICS(fixture);
    const utcIni = toInputLocal(new Date(Date.UTC(2026, 7, 12, 21, 0)));
    const utcFim = toInputLocal(new Date(Date.UTC(2026, 7, 13, 9, 0)));
    const resultados = [
      { caso: 'Extrai 2 eventos válidos e ignora 2', ok: eventos.length === 2 && ignorados === 2 },
      { caso: 'Evento flutuante mantém hora local', ok: eventos[0]?.inicio === '2026-08-10T18:00' && eventos[0]?.fim === '2026-08-11T08:00' },
      { caso: 'SUMMARY desescapado corretamente', ok: eventos[0]?.resumo === 'Extra AC4 - Est, dio' },
      { caso: 'Evento UTC convertido para fuso local', ok: eventos[1]?.inicio === utcIni && eventos[1]?.fim === utcFim },
      { caso: 'Evento importado gera escala calculável', ok: calcularEscala({ inicio: eventos[0].inicio, fim: eventos[0].fim }).mins === 14 * 60 },
    ];
    if (console.table) console.table(resultados);
    return resultados.every((r) => r.ok) ? 'TODOS OS TESTES DE IMPORTACAO OK' : resultados;
  };

  /* -------------------------------------------- PWA install prompt */
  function initPWA() {
    const jaInstalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (jaInstalado) return;

    const dismissed = localStorage.getItem(STORAGE.pwaBanner);
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

    const mostrarBotaoInstalar = () => $('shareInstallOpt')?.classList.remove('hidden');
    const ocultarBotaoInstalar = () => $('shareInstallOpt')?.classList.add('hidden');

    if (isIOS) mostrarBotaoInstalar();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (!dismissed) $('pwaBanner')?.classList.remove('hidden');
      mostrarBotaoInstalar();
    });

    on('shareInstallOpt', 'click', async () => {
      $('dialogShare')?.close();
      haptic(10);
      if (isIOS) {
        await dialogConfirmar(
          'No Safari: toque em ↑ Compartilhar → "Adicionar à Tela de Início" para instalar o app.',
          { textoOk: 'Entendi', perigoso: false }
        );
        return;
      }
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (outcome === 'accepted') {
        ocultarBotaoInstalar();
        $('pwaBanner')?.classList.add('hidden');
        toast('App instalado! Acesse pela tela inicial.');
      }
    });

    on('pwaBannerInstall', 'click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('pwaBanner')?.classList.add('hidden');
      if (outcome === 'accepted') {
        ocultarBotaoInstalar();
        toast('App instalado! Acesse pela tela inicial.');
      }
    });

    on('pwaBannerClose', 'click', () => {
      $('pwaBanner')?.classList.add('hidden');
      localStorage.setItem(STORAGE.pwaBanner, '1');
    });
  }

  /* -------------------------------------------------------------- init */
  function init() {
    initTema();
    carregar();
    initPWA();

    $('escalaInicio').value = toInputLocal(new Date());

    on('formEscala', 'submit', (ev) => { ev.preventDefault(); submeterFormulario(); });
    on('btnCancelEdit', 'click', cancelarEdicao);

    on('btnTheme', 'click', () =>
      aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    on('btnPrint',     'click', imprimirRelatorio);
    on('btnExportIcs', 'click', abrirAgendaGoogle);
    on('btnExportCsv', 'click', exportarCSV);
    on('btnShare',     'click', abrirShareSheet);

    on('mobileAdd', 'click', () => {
      document.querySelector('.launch-panel')?.scrollIntoView({ behavior: 'smooth' });
      $('escalaInicio').focus();
    });
    on('mobileShare', 'click', abrirShareSheet);

    on('shareWA',     'click', () => { $('dialogShare')?.close(); compartilharWhatsApp(); });
    on('shareNative', 'click', () => { $('dialogShare')?.close(); compartilharNativo(); });
    on('shareCopy',   'click', () => { $('dialogShare')?.close(); copiarResumo(); });
    on('shareGoogleOpt', 'click', () => {
      $('dialogShare')?.close();
      const lista = escalasOrdenadas();
      if (!lista.length) { toast('Adicione escalas antes de compartilhar.', { erro: true }); return; }
      if (lista.length === 1) {
        abrirAgendaGoogleItem(lista[0].id);
      } else {
        baixarArquivoAgenda(lista, 'Arquivo .ics gerado com todas as escalas para o Google Agenda.');
      }
    });
    on('shareIcsOpt', 'click', () => { $('dialogShare')?.close(); exportarICS(); });
    on('shareCsvOpt', 'click', () => { $('dialogShare')?.close(); exportarCSV(); });
    on('sharePdfOpt', 'click', () => { $('dialogShare')?.close(); imprimirRelatorio(); });
    on('shareClose',  'click', () => $('dialogShare')?.close());

    on('btnClearAll', 'click', limparTudo);
    on('filtroMes', 'change', () => { filtroMes = $('filtroMes')?.value || ''; render(); });
    initImportacao();

    const aplicarDuracao = () => {
      const horas = Number($('escalaDuracao')?.value || 0);
      if (!horas) return false;
      const fim = calcularTerminoPorDuracao($('escalaInicio')?.value || '', horas);
      if (!fim) return false;
      $('escalaFim').value = fim;
      $('fieldFim').classList.remove('invalid');
      $('fieldFim').querySelector('.control')?.removeAttribute('aria-invalid');
      return true;
    };
    on('escalaDuracao', 'input', aplicarDuracao);
    on('escalaDuracao', 'change', aplicarDuracao);
    on('escalaInicio',  'input', aplicarDuracao);
    on('escalaInicio',  'change', aplicarDuracao);
    const marcarDuracaoPersonalizada = () => { if ($('escalaDuracao')) $('escalaDuracao').value = ''; };
    on('escalaFim', 'input', marcarDuracaoPersonalizada);
    on('escalaFim', 'change', marcarDuracaoPersonalizada);

    on('listaEscalas', 'click', (ev) => {
      const btn = ev.target.closest('[data-acao]');
      if (!btn) return;
      const id = parseFloat(btn.dataset.id);
      if (btn.dataset.acao === 'remover')        removerEscala(id);
      else if (btn.dataset.acao === 'editar')    editarEscala(id);
      else if (btn.dataset.acao === 'duplicar')  duplicarEscala(id);
      else if (btn.dataset.acao === 'agenda')    abrirAgendaGoogleItem(id);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submeterFormulario(); }
      if (e.key === 'Escape' && editandoId !== null) cancelarEdicao();
    });

    render();

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    const ano = new Date().getFullYear();
    document.querySelectorAll('.footer-year').forEach((el) => { el.textContent = ano; });
    const printYear = $('printYear');
    if (printYear) printYear.textContent = ano;
  });
})();
