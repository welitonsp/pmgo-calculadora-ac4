/* ==========================================================================
   Calculadora AC4 — v51
   Módulo principal: estado, UI, persistência e exportações.
   Regras de negócio, formatação e agenda vivem em js/modules/.
   ========================================================================== */
import {
  fmtMoeda, fmtHoras, fmtDataHora, fmtData, fmtDiaSemana, fmtHora,
  combinarDataHoraLocal, parseDateTimeLocal, formatarDataHoraInput, toInputLocal,
  calcularTerminoPorDuracao, validarIntervaloEscala, toInputMonth, fmtMesRef, escapeHTML,
} from './modules/formato.mjs';
import {
  PORTARIA_ATUAL, VALORES_OFICIAIS, labelOrigem,
  calcularEscala as calcularEscalaBase,
} from './modules/calculo.mjs';
import {
  ICS_DOMAIN, dataICS, desdobrarLinhasICS,
  montarICS as montarICSBase,
  validarICS as validarICSBase,
  gerarLinkGoogleAgenda as gerarLinkGoogleAgendaBase,
  gerarLinkOutlookAgenda as gerarLinkOutlookAgendaBase,
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
  let submetendo = false;
  let sheetAberto = false;

  /* ---------------------------------------- bottom sheet mobile (lançamento) */
  const isMobileViewport = () => window.matchMedia('(max-width: 760px)').matches;

  function setMobileSheetOpen(aberto) {
    sheetAberto = aberto;
    document.querySelector('.launch-panel')?.classList.toggle('is-open', aberto);
    $('mobileLaunchBackdrop')?.classList.toggle('is-open', aberto);
    document.body.classList.toggle('mobile-sheet-open', aberto);
    $('mobileAdd')?.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  }

  function abrirPainelLancamentoMobile({ foco = false } = {}) {
    setMobileSheetOpen(true);
    /* O foco automático em mobile pode abrir teclado/picker e deslocar o sheet.
       Mantemos a opção para fluxos específicos, mas sem usar por padrão. */
    if (foco) window.setTimeout(() => $('escalaInicio')?.focus({ preventScroll: true }), 260);
  }

  function fecharPainelLancamentoMobile({ devolverFoco = true } = {}) {
    if (!sheetAberto) return;
    setMobileSheetOpen(false);
    if (devolverFoco) $('mobileAdd')?.focus();
  }

  function baixarArquivoAgenda(lista, mensagem = 'Arquivo .ics gerado para importar na sua agenda.') {
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
  const gerarLinkOutlookAgenda = (e, corporativo) => gerarLinkOutlookAgendaBase(e, tabelaParaCalculo(), corporativo);

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
      { caso: 'Início qui, vira sex 02/07 20h→sex 6h', inicio: '2026-07-02T20:00', fim: '2026-07-03T06:00', AD: h(2), AN: h(7), VD: h(1), VN: 0, centavos: 33100 },
      /* Fronteiras (§10 da auditoria) — dom→seg cruzando 05h, 1 min, término 00:00, bissexto */
      { caso: 'Fronteira dom→seg: dom 05/07 20h→seg 08h', inicio: '2026-07-05T20:00', fim: '2026-07-06T08:00', AD: h(3), AN: 0,    VD: h(2), VN: h(7), centavos: 48500 },
      { caso: 'Escala de 1 minuto (seg 06/07 10:00)',      inicio: '2026-07-06T10:00', fim: '2026-07-06T10:01', AD: 1,    AN: 0,    VD: 0,    VN: 0,    centavos: 50 },
      { caso: 'Término 00:00 (seg 06/07 22h→ter 00:00)',   inicio: '2026-07-06T22:00', fim: '2026-07-07T00:00', AD: 0,    AN: h(2), VD: 0,    VN: 0,    centavos: 6600 },
      { caso: 'Bissexto: ter 29/02/2028 08h→18h',          inicio: '2028-02-29T08:00', fim: '2028-02-29T18:00', AD: h(10),AN: 0,    VD: 0,    VN: 0,    centavos: 30000 },
      { caso: 'Vermelha madrugada: sex 03/07 22h→sáb 06h', inicio: '2026-07-03T22:00', fim: '2026-07-04T06:00', AD: 0,    AN: 0,    VD: h(1), VN: h(7), centavos: 35500 },
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
      add('Aceitar duração no limite de 192h', validarIntervaloEscala('2026-07-05T08:00', '2026-07-13T08:00').ok);
      const acimaLimite = validarIntervaloEscala('2026-07-05T08:00', '2036-07-05T08:00');
      add('Rejeitar duração acima de 192h (typo de ano)', !acimaLimite.ok && acimaLimite.campo === 'fim', acimaLimite.mensagem);

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
    /* Mesmo teto do stepper (999) também para valor digitado à mão. */
    return Number.isFinite(val) && val >= 1 ? Math.min(999, val) : 1;
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
    /* Reentrância: duplo toque/Ctrl+Enter repetido não deve processar duas vezes.
       O botão é desabilitado no clique e reabilitado no finally. */
    if (submetendo) return;
    submetendo = true;
    const btn = $('btnSubmit');
    if (btn) btn.disabled = true;
    try {
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
      /* No mobile, salvar com sucesso fecha o bottom sheet. */
      if (isMobileViewport()) fecharPainelLancamentoMobile();
    } finally {
      submetendo = false;
      if (btn) btn.disabled = false;
    }
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
    sincronizarTodosControlesDataHora();
    $('btnSubmit').textContent = 'Salvar alterações';
    $('btnCancelEdit').classList.remove('hidden');
    $('formTitle').lastChild.textContent = ' Editar escala';
    setTituloSheet('Editar escala');
    atualizarResumoFim();
    atualizarChipsDuracao();
    atualizarResumoLancamento();
    if (isMobileViewport()) {
      /* já vem preenchido — não sobrescrever com data/hora atual */
      abrirPainelLancamentoMobile();
    } else {
      document.querySelector('.launch-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('escalaInicio').focus();
    }
  }

  /* Espelho legível do término. O datetime-local não repinta em alguns
     navegadores mobile quando o valor é setado por JS (cálculo da duração);
     este texto garante que o usuário veja o término calculado. */
  function atualizarResumoFim() {
    const el = $('fimResumo');
    if (!el) return;
    const v = $('escalaFim')?.value || '';
    el.textContent = parseDateTimeLocal(v) ? `${fmtDiaSemana(v)}, ${fmtDataHora(v)}` : '';
  }

  /* Resumo compacto do lançamento (mobile): "14h · 1 PM · AC4 · R$ 595,00".
     Usa o calcularEscala existente sobre os valores atuais do formulário. */
  function atualizarResumoLancamento() {
    const el = $('launchResumo');
    if (!el) return;
    const inicio = $('escalaInicio')?.value || '';
    const fim = $('escalaFim')?.value || '';
    const intervalo = validarIntervaloEscala(inicio, fim);
    if (!intervalo.ok) { el.textContent = ''; el.classList.add('vazio'); return; }
    const r = calcularEscala({ inicio, fim });
    const qtd = lerQtdPm();
    const origem = labelOrigem($('escalaOrigem')?.value || 'AC4');
    el.textContent = `${fmtHoras(r.mins)} · ${qtd} PM · ${origem} · ${fmtMoeda(r.valorCentavos * qtd)}`;
    el.classList.remove('vazio');
  }

  function sincronizarControlesDataHora(id) {
    const valor = $(id)?.value || '';
    const normalizado = parseDateTimeLocal(valor) ? formatarDataHoraInput(parseDateTimeLocal(valor)) : '';
    const data = $(`${id}Data`);
    const hora = $(`${id}Hora`);
    if (data) data.value = normalizado ? normalizado.slice(0, 10) : '';
    if (hora) hora.value = normalizado ? normalizado.slice(11, 16) : '';
  }

  function sincronizarTodosControlesDataHora() {
    sincronizarControlesDataHora('escalaInicio');
    sincronizarControlesDataHora('escalaFim');
  }

  function aplicarPartesDataHora(id, tipoEvento = 'input') {
    const data = $(`${id}Data`)?.value || '';
    const hora = $(`${id}Hora`)?.value || '';
    const combinado = combinarDataHoraLocal(data, hora);
    const campo = $(id);
    if (!campo || !combinado) return false;
    campo.value = formatarDataHoraInput(combinado);
    campo.dispatchEvent(new Event(tipoEvento, { bubbles: true }));
    return true;
  }

  /* Chips de duração rápida (mobile): refletem #escalaDuracao — mesma fonte de
     verdade do <select> do desktop, sem lógica de cálculo paralela. */
  function atualizarChipsDuracao() {
    const val = $('escalaDuracao')?.value || '';
    document.querySelectorAll('#durChips .dur-chip').forEach((c) => {
      const ativo = c.dataset.horas === val;
      c.classList.toggle('is-active', ativo);
      c.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }

  const setTituloSheet = (txt) => { const el = $('mobileLaunchTitle'); if (el) el.textContent = txt; };

  function cancelarEdicao() {
    editandoId = null;
    setTituloSheet('Nova escala AC4');
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
        texto += `⏱ ${fmtHoras(r.mins)}  |  Diurno: ${fmtHoras(r.minDiurno)}  /  Noturno: ${fmtHoras(r.minNoturno)}\n`;
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

  /* Botões de ação de uma escala — reusados na tabela (desktop) e nos
     cards enxutos (mobile). A delegação em #listaEscalas trata ambos. */
  const botoesAcaoHTML = (id) => `
    <div class="escala-actions">
      <button class="btn-icon gcal" data-acao="agenda" data-id="${id}" title="Adicionar esta escala à agenda" aria-label="Adicionar esta escala à agenda">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 13v4M10 15h4"/></svg>
      </button>
      <button class="btn-icon" data-acao="duplicar" data-id="${id}" title="Duplicar para o dia seguinte" aria-label="Duplicar">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
      </button>
      <button class="btn-icon" data-acao="editar" data-id="${id}" title="Editar" aria-label="Editar">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      </button>
      <button class="btn-icon delete" data-acao="remover" data-id="${id}" title="Excluir" aria-label="Excluir">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
      </button>
    </div>`;

  const fmtDiaSemanaLinha = (iso) =>
    fmtDiaSemana(iso)
      .split('-')
      .map((parte) => parte ? parte[0].toLocaleUpperCase('pt-BR') + parte.slice(1) : parte)
      .join('-');
  const fmtMoedaLinha = (centavos) => fmtMoeda(centavos).replace(/\u00a0/g, ' ');

  const botoesCardMobileHTML = (id) => `
    <div class="ec-card-actions" aria-label="Ações da escala">
      <button class="ec-action-btn" data-acao="editar" data-id="${id}" type="button">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        <span>Editar</span>
      </button>
      <button class="ec-action-btn" data-acao="duplicar" data-id="${id}" type="button">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
        <span>Duplicar</span>
      </button>
      <button class="ec-action-btn delete" data-acao="remover" data-id="${id}" type="button">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        <span>Excluir</span>
      </button>
    </div>`;

  /* Card de escala (mobile): leitura confortável + ações grandes.
     Estrutura própria — o desktop segue usando a tabela, sem alteração. */
  const cardEscalaHTML = (e, r) => {
    const qtd = e.qtdPm || 1;
    const valorTotal = r.valorCentavos * qtd;
    const inicio = parseDateTimeLocal(e.inicio) || new Date(e.inicio);
    const dia = String(inicio.getDate()).padStart(2, '0');
    const mes = inicio.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
    const fimStr = fmtData(e.inicio) === fmtData(e.fim) ? fmtHora(e.fim) : `${fmtData(e.fim)} ${fmtHora(e.fim)}`;
    const resumo = `${fmtData(e.inicio)} - ${fmtDiaSemanaLinha(e.inicio)} - ${fmtHoras(r.mins)} - ${fmtMoedaLinha(valorTotal)}`;
    return `
      <div class="escala-card" role="listitem" aria-label="${escapeHTML(resumo)}">
        <div class="ec-card-main">
          <div class="ec-date-badge" aria-hidden="true">
            <strong>${dia}</strong>
            <span>${escapeHTML(mes)}</span>
          </div>
          <div class="ec-card-info">
            <div class="ec-weekday">${fmtDiaSemanaLinha(e.inicio)}</div>
            <div class="ec-detail-row">
              <span>${fmtData(e.inicio)}</span>
              <span>${fmtHora(e.inicio)} → ${fimStr}</span>
            </div>
            <div class="ec-duration">${fmtHoras(r.mins)}${qtd > 1 ? ` · ${qtd} PMs` : ''}</div>
          </div>
          <div class="ec-money">
            <span>${fmtMoedaLinha(valorTotal)}</span>
          </div>
        </div>
        ${botoesCardMobileHTML(e.id)}
      </div>`;
  };

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
    $('totDiurnas').textContent  = fmtHoras(totDiurno);
    $('totNoturnas').textContent = fmtHoras(totNoturno);
    $('totValor').textContent    = fmtMoeda(totValor);
    $('mobileTotal').textContent = fmtMoeda(totValor);
    $('pctDiurnas').textContent  = totMins ? `${((totDiurno  / totMins) * 100).toFixed(1).replace('.', ',')}% do total` : '0% do total';
    $('pctNoturnas').textContent = totMins ? `${((totNoturno / totMins) * 100).toFixed(1).replace('.', ',')}% do total` : '0% do total';

    const sufixo = filtroMes ? ` em ${fmtMesRef(filtroMes)}` : ' no período';
    $('totQtd').textContent = `${lista.length} escala${lista.length === 1 ? '' : 's'}${sufixo}`;
    /* Resumo compacto do card de Valor (mobile): "96h · 8 escalas" */
    if ($('metricResumoMobile')) {
      $('metricResumoMobile').textContent = `${fmtHoras(totMins)} · ${lista.length} escala${lista.length === 1 ? '' : 's'}`;
    }
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
        ? `<span class="chip chip-night">${fmtHoras(r.minNoturno)} noturno</span>`
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
          <td data-label="Ações">${botoesAcaoHTML(e.id)}</td>
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

    /* Cards enxutos (mobile) — vêm antes da tabela no DOM; CSS mostra um ou
       outro conforme a largura. Mesma fonte de dados, sem tocar no desktop. */
    const cardsMobile = `<div class="escala-cards" role="list" aria-label="Escalas lançadas">${resultados.map(({ e, r }) => cardEscalaHTML(e, r)).join('')}</div>`;
    container.innerHTML = cardsMobile + html;
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
      `<div><span class="pr-label">H. diurnas:</span> <strong>${fmtHoras(totDiurno)}</strong></div>`,
      `<div><span class="pr-label">H. noturnas:</span> <strong>${fmtHoras(totNoturno)}</strong></div>`,
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
          <td class="pr-center">${fmtHoras(r.minDiurno)}</td>
          <td class="pr-center">${fmtHoras(r.minNoturno)}</td>
          <td class="pr-valor">${valorCell}</td>
        </tr>`;
    });

    const totalRow = lista.length > 1 ? `
      <tfoot>
        <tr class="pr-total-row">
          <td colspan="8">TOTAL GERAL</td>
          <td class="pr-center">${fmtHoras(totDiurno)}</td>
          <td class="pr-center">${fmtHoras(totNoturno)}</td>
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

  /* ------------------------------------------------ agendamento
     Celular e desktop usam o MESMO dialog de provedores: tocar em "Google
     Agenda"/"Outlook" abre o evento já pré-preenchido (um toque em Salvar).
     "Baixar .ics" fica como alternativa para outras agendas (Apple, Samsung). */
  const PROVEDORES_AGENDA = [
    {
      id: 'google', nome: 'Google Agenda', hint: 'Abre com o evento pronto',
      classeIco: 'google',
      icone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m9.5 14.5 2-2v5"/></svg>',
      link: (e) => gerarLinkGoogleAgenda(e),
    },
    {
      id: 'outlook', nome: 'Outlook pessoal', hint: 'Conta Outlook.com',
      classeIco: 'outlook',
      icone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><circle cx="12" cy="15" r="2.6"/></svg>',
      link: (e) => gerarLinkOutlookAgenda(e, false),
    },
    {
      id: 'outlook365', nome: 'Outlook corporativo', hint: 'Conta Microsoft 365 (trabalho)',
      classeIco: 'outlook',
      icone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M9.5 17v-4.5h2.2a1.4 1.4 0 0 1 0 2.8H9.5"/></svg>',
      link: (e) => gerarLinkOutlookAgenda(e, true),
    },
  ];

  const ICONE_ICS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';

  function agendarEscalas(lista) {
    if (!lista.length) { toast('Adicione escalas antes de salvar na agenda.', { erro: true }); return; }
    abrirDialogAgenda(lista);
  }

  function abrirDialogAgenda(lista) {
    const dlg = $('dialogAgenda');
    if (!dlg) return;
    $('agendaSub').textContent = lista.length === 1
      ? `${lista[0].descricao} — ${fmtDataHora(lista[0].inicio)}`
      : `${lista.length} escalas selecionadas`;
    montarOpcoesProvedor(lista);
    dlg.showModal();
  }

  /* Alternativa universal: baixa o .ics (Apple Calendar, Samsung, etc.).
     No celular a mensagem orienta a abrir o arquivo; no desktop, a importar. */
  function baixarIcsDaAgenda(lista) {
    $('dialogAgenda')?.close();
    baixarArquivoAgenda(lista, isMobileViewport()
      ? 'Arquivo .ics gerado — toque nele (em Downloads) para abrir na agenda.'
      : 'Arquivo .ics gerado para importar na sua agenda.');
  }

  function montarOpcoesProvedor(lista) {
    const body = $('agendaBody');
    const provedores = PROVEDORES_AGENDA.map((p) => `
      <button class="agenda-prov" data-prov="${p.id}" type="button">
        <span class="agenda-prov-ico ${p.classeIco}" aria-hidden="true">${p.icone}</span>
        <span class="agenda-prov-txt">${p.nome}<small>${p.hint}</small></span>
      </button>`).join('');
    body.innerHTML = `${provedores}
      <button class="agenda-prov agenda-prov--ics" data-prov="ics" type="button">
        <span class="agenda-prov-ico ics" aria-hidden="true">${ICONE_ICS}</span>
        <span class="agenda-prov-txt">Baixar arquivo (.ics)<small>Apple, Samsung ou outra agenda</small></span>
      </button>`;
    body.querySelectorAll('.agenda-prov').forEach((btn) => {
      btn.addEventListener('click', () => {
        haptic(10);
        if (btn.dataset.prov === 'ics') { baixarIcsDaAgenda(lista); return; }
        const prov = PROVEDORES_AGENDA.find((p) => p.id === btn.dataset.prov);
        if (!prov) return;
        if (lista.length === 1) {
          window.open(prov.link(lista[0]), '_blank', 'noopener');
          $('dialogAgenda')?.close();
          return;
        }
        montarListaEscalasProvedor(lista, prov);
      });
    });
  }

  /* Agendas web só aceitam um evento por link: com várias escalas, cada uma
     vira um link clicável — evita bloqueio de pop-up e dá controle ao PM. */
  function montarListaEscalasProvedor(lista, prov) {
    const body = $('agendaBody');
    body.innerHTML = `
      <p class="agenda-hint">O ${prov.nome} abre uma escala por vez. Clique em cada uma para adicionar:</p>
      <div class="agenda-lista">
        ${lista.map((e) => `
          <a class="agenda-item" href="${escapeHTML(prov.link(e))}" target="_blank" rel="noopener">
            <span>${escapeHTML(e.descricao || 'Escala AC4')} — ${fmtDataHora(e.inicio)}</span>
          </a>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="agendaVoltar" type="button">‹ Escolher outra agenda</button>`;
    body.querySelectorAll('.agenda-item').forEach((a) => {
      a.addEventListener('click', () => a.classList.add('aberta'));
    });
    $('agendaVoltar')?.addEventListener('click', () => montarOpcoesProvedor(lista));
  }

  function agendarEscalaItem(id) {
    const e = escalas.find((x) => x.id === id);
    if (e) agendarEscalas([e]);
  }

  function exportarCSV() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de exportar CSV.', { erro: true }); return; }
    const sep = ';';
    const num = (cent) => (cent / 100).toFixed(2).replace('.', ',');
    /* Campos de texto livre passam por csvTextoSeguro antes das aspas —
       impede que "=..." digitado na Unidade vire fórmula no Excel. */
    const celTexto = (s) => `"${csvTextoSeguro(s).replace(/"/g, '""')}"`;
    const linhas = [['Unidade', 'Origem', 'Início', 'Término', 'Qtd. PM', 'Horas', 'H. diurnas', 'H. noturnas', 'Portaria', 'Valor/PM (R$)', 'Valor total (R$)'].join(sep)];
    let total = 0;
    lista.forEach((e) => {
      const r = calcularEscala(e);
      const qtd = e.qtdPm || 1;
      const valorTotal = r.valorCentavos * qtd;
      total += valorTotal;
      linhas.push([
        celTexto(e.descricao || 'Escala AC4'),
        celTexto(e.origem || 'AC4'),
        fmtDataHora(e.inicio), fmtDataHora(e.fim),
        qtd,
        (r.mins / 60).toFixed(2).replace('.', ','),
        (r.minDiurno  / 60).toFixed(2).replace('.', ','),
        (r.minNoturno / 60).toFixed(2).replace('.', ','),
        celTexto(r.tabela.portaria || ''),
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
      {
        caso: 'Link do Outlook pessoal com datas UTC e evento',
        ok: (() => {
          const url = new URL(gerarLinkOutlookAgenda(casos[0], false));
          return url.origin === 'https://outlook.live.com'
            && url.searchParams.get('rru') === 'addevent'
            && url.searchParams.get('startdt') === new Date(casos[0].inicio).toISOString()
            && url.searchParams.get('enddt') === new Date(casos[0].fim).toISOString()
            && url.searchParams.get('subject') === casos[0].descricao;
        })(),
      },
      {
        caso: 'Link do Outlook corporativo usa outlook.office.com',
        ok: new URL(gerarLinkOutlookAgenda(casos[0], true)).origin === 'https://outlook.office.com',
      },
    ];
    if (console.table) console.table(resultados);
    return resultados.every((r) => r.ok) ? 'TODOS OS TESTES DE AGENDAMENTO OK' : resultados;
  };

  /* -------------------------------------------- PWA install prompt */
  function initPWA() {
    const jaInstalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (jaInstalado) return;

    const dismissed = localStorage.getItem(STORAGE.pwaBanner);
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

    const mostrarBotaoInstalar = () => $('shareInstallOpt')?.classList.remove('hidden');
    const ocultarBotaoInstalar = () => $('shareInstallOpt')?.classList.add('hidden');

    /* Entrada de instalação sempre disponível via Compartilhar → Instalar,
       em qualquer navegador/sistema que ainda não esteja rodando instalado. */
    mostrarBotaoInstalar();

    const instrucaoManual = () => dialogConfirmar(
      isIOS
        ? 'No Safari: toque em ⬆︎ Compartilhar e depois em “Adicionar à Tela de Início” para instalar o app.'
        : 'Para instalar: abra o menu do navegador (⋮) e toque em “Instalar app” ou “Adicionar à tela inicial”.',
      { textoOk: 'Entendi', perigoso: false }
    );

    async function instalar() {
      /* Android/Chrome: usa o prompt nativo quando disponível. */
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (outcome === 'accepted') {
          ocultarBotaoInstalar();
          $('pwaBanner')?.classList.add('hidden');
          toast('App instalado! Acesse pela tela inicial.');
        }
        return;
      }
      /* iOS e demais casos sem prompt nativo: instrução passo a passo. */
      await instrucaoManual();
    }

    /* Banner proativo: no iOS já aparece no carregamento (não há evento nativo);
       no Android aparece quando o navegador sinaliza que dá para instalar. */
    if (isIOS && !dismissed) $('pwaBanner')?.classList.remove('hidden');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (!dismissed) $('pwaBanner')?.classList.remove('hidden');
      mostrarBotaoInstalar();
    });

    on('shareInstallOpt', 'click', () => { $('dialogShare')?.close(); haptic(10); instalar(); });
    on('pwaBannerInstall', 'click', instalar);
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
    sincronizarTodosControlesDataHora();

    on('formEscala', 'submit', (ev) => { ev.preventDefault(); submeterFormulario(); });
    on('btnCancelEdit', 'click', () => {
      cancelarEdicao();
      if (isMobileViewport()) fecharPainelLancamentoMobile();
    });

    on('btnTheme', 'click', () =>
      aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    on('btnPrint',     'click', imprimirRelatorio);
    on('btnExportCsv', 'click', exportarCSV);
    on('btnShare',     'click', abrirShareSheet);

    on('mobileAdd', 'click', () => {
      if (isMobileViewport()) {
        /* nova escala: pré-preenche o início com agora; ao editar, preserva */
        if (editandoId === null) {
          setTituloSheet('Nova escala AC4');
          $('escalaInicio').value = toInputLocal(new Date());
          aplicarDuracao();          /* recalcula término se já havia duração escolhida */
          sincronizarTodosControlesDataHora();
        }
        atualizarResumoLancamento();
        abrirPainelLancamentoMobile();
        return;
      }
      document.querySelector('.launch-panel')?.scrollIntoView({ behavior: 'smooth' });
      $('escalaInicio').focus();
    });
    on('mobileLaunchClose', 'click', () => fecharPainelLancamentoMobile());
    on('mobileLaunchBackdrop', 'click', () => fecharPainelLancamentoMobile());
    /* Sair da faixa mobile com o sheet aberto: destrava a rolagem do fundo */
    window.matchMedia('(max-width: 760px)').addEventListener('change', (e) => {
      if (!e.matches && sheetAberto) setMobileSheetOpen(false);
    });
    on('mobileShare', 'click', abrirShareSheet);

    on('shareWA',     'click', () => { $('dialogShare')?.close(); compartilharWhatsApp(); });
    on('shareNative', 'click', () => { $('dialogShare')?.close(); compartilharNativo(); });
    on('shareCopy',   'click', () => { $('dialogShare')?.close(); copiarResumo(); });
    on('shareIcsOpt', 'click', () => { $('dialogShare')?.close(); agendarEscalas(escalasOrdenadas()); });
    on('agendaCancelar', 'click', () => $('dialogAgenda')?.close());
    on('footerPrivacidade', 'click', (ev) => { ev.preventDefault(); $('dialogPrivacidade')?.showModal(); });
    on('privacidadeFechar', 'click', () => $('dialogPrivacidade')?.close());
    on('shareCsvOpt', 'click', () => { $('dialogShare')?.close(); exportarCSV(); });
    on('sharePdfOpt', 'click', () => { $('dialogShare')?.close(); imprimirRelatorio(); });
    on('shareClose',  'click', () => $('dialogShare')?.close());

    on('btnClearAll', 'click', limparTudo);
    on('filtroMes', 'change', () => { filtroMes = $('filtroMes')?.value || ''; render(); });

    const aplicarDuracao = () => {
      const horas = Number($('escalaDuracao')?.value || 0);
      if (!horas) return false;
      const fim = calcularTerminoPorDuracao($('escalaInicio')?.value || '', horas);
      if (!fim) return false;
      $('escalaFim').value = fim;
      sincronizarControlesDataHora('escalaFim');
      $('fieldFim').classList.remove('invalid');
      $('fieldFim').querySelector('.control')?.removeAttribute('aria-invalid');
      atualizarResumoFim();
      atualizarChipsDuracao();
      atualizarResumoLancamento();
      return true;
    };
    on('escalaDuracao', 'input', aplicarDuracao);
    on('escalaDuracao', 'change', aplicarDuracao);
    on('escalaInicio',  'input', aplicarDuracao);
    on('escalaInicio',  'change', aplicarDuracao);
    on('escalaInicio',  'input', () => sincronizarControlesDataHora('escalaInicio'));
    on('escalaInicio',  'change', () => sincronizarControlesDataHora('escalaInicio'));
    const marcarDuracaoPersonalizada = () => {
      if ($('escalaDuracao')) $('escalaDuracao').value = '';
      sincronizarControlesDataHora('escalaFim');
      atualizarResumoFim();
      atualizarChipsDuracao();
      atualizarResumoLancamento();
    };
    on('escalaFim', 'input', marcarDuracaoPersonalizada);
    on('escalaFim', 'change', marcarDuracaoPersonalizada);
    ['escalaInicio', 'escalaFim'].forEach((id) => {
      ['Data', 'Hora'].forEach((sufixo) => {
        on(`${id}${sufixo}`, 'input', () => aplicarPartesDataHora(id, 'input'));
        on(`${id}${sufixo}`, 'change', () => aplicarPartesDataHora(id, 'change'));
      });
    });
    /* Resumo do lançamento também depende de Qtd. PM e Origem */
    on('escalaQtdPm', 'input', atualizarResumoLancamento);
    on('escalaQtdPm', 'change', atualizarResumoLancamento);
    on('escalaOrigem', 'input', atualizarResumoLancamento);
    on('escalaOrigem', 'change', atualizarResumoLancamento);

    /* Chips de duração rápida (mobile) — escrevem no mesmo #escalaDuracao. */
    document.querySelectorAll('#durChips .dur-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        if ($('escalaDuracao')) $('escalaDuracao').value = chip.dataset.horas;
        aplicarDuracao();
        atualizarChipsDuracao();
      });
    });

    /* Stepper de Qtd. PM (mobile) — ajusta o mesmo #escalaQtdPm, faixa 1–999. */
    const ajustarQtd = (delta) => {
      const inp = $('escalaQtdPm');
      if (!inp) return;
      const atual = parseInt(inp.value || '1', 10);
      inp.value = Math.min(999, Math.max(1, (Number.isFinite(atual) ? atual : 1) + delta));
      atualizarResumoLancamento();
    };
    on('qtdMinus', 'click', () => ajustarQtd(-1));
    on('qtdPlus', 'click', () => ajustarQtd(1));

    on('listaEscalas', 'click', (ev) => {
      const btn = ev.target.closest('[data-acao]');
      if (!btn) return;
      const id = parseFloat(btn.dataset.id);
      if (btn.dataset.acao === 'remover')        removerEscala(id);
      else if (btn.dataset.acao === 'editar')    editarEscala(id);
      else if (btn.dataset.acao === 'duplicar')  duplicarEscala(id);
      else if (btn.dataset.acao === 'agenda')    agendarEscalaItem(id);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submeterFormulario(); }
      if (e.key === 'Escape') {
        if (editandoId !== null) cancelarEdicao();
        if (sheetAberto) fecharPainelLancamentoMobile();
      }
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
