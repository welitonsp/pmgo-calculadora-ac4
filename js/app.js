/* ==========================================================================
   Calculadora AC4 — v14
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const on = (id, evt, fn) => {
    const el = $(id);
    if (el) el.addEventListener(evt, fn);
  };

  const STORAGE = {
    escalas: 'pmgoEscalas',
    config: 'pmgoConfig',
    theme: 'pmgoTheme',
    officer: 'pmgoOfficer',
    pwaBanner: 'pmgoPwaBanner',
  };

  /* ------------------------------------------------------------ estado */
  let escalas = [];
  let editandoId = null;
  let ultimaExcluida = null;
  let filtroMes = '';
  let deferredInstallPrompt = null;

  const PORTARIA_ATUAL = 'Portaria SSP nº 621/2026';
  const VALORES_OFICIAIS = { valAD: '30', valAN: '33', valVD: '40', valVN: '45' };

  /* -------------------------------------------------------- utilitários */
  const moedaBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtMoeda = (cent) => moedaBRL.format(cent / 100);

  const fmtHoras = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
  };

  const fmtHorasCheias = (mins) => `${Math.round(mins / 60)}h`;

  const fmtDataHora = (iso) =>
    new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });

  const fmtData = (iso) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const fmtDiaSemana = (iso) => {
    const nome = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long' });
    return nome[0].toUpperCase() + nome.slice(1);
  };

  const fmtHora = (iso) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const toInputLocal = (date) => {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };

  const toInputMonth = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  const fmtMesRef = (yyyymm) => {
    if (!yyyymm) return '';
    const [ano, mes] = yyyymm.split('-');
    const label = new Date(+ano, +mes - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return label[0].toUpperCase() + label.slice(1);
  };

  const escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICS_DOMAIN = 'calculadora-ac4-pmgo.github.io';
  const ICS_PRODID = '-//Calculadora AC4//PT-BR';
  const contarOctetos = (s) => {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  };

  function dobrarLinhaICS(linha) {
    const partes = [];
    let atual = '';
    Array.from(String(linha)).forEach((char) => {
      const tentativa = atual + char;
      if (atual && contarOctetos(tentativa) > 75) {
        partes.push(atual);
        atual = ` ${char}`;
      } else {
        atual = tentativa;
      }
    });
    if (atual || !partes.length) partes.push(atual);
    return partes.join('\r\n');
  }

  const escaparTextoICS = (valor) =>
    String(valor || '')
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');

  function dataICS(valor) {
    const data = new Date(valor);
    if (!Number.isFinite(data.getTime())) return '';
    return data.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function hashCurto(valor) {
    let hash = 0x811c9dc5;
    Array.from(String(valor)).forEach((char) => {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    });
    return (hash >>> 0).toString(36);
  }

  function uidEscalaICS(escala) {
    const origem = escala.id != null && escala.id !== ''
      ? String(escala.id)
      : hashCurto(`${escala.inicio}|${escala.fim}|${escala.descricao || ''}`);
    const seguro = origem.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80);
    return `ac4-${seguro || hashCurto(origem)}@${ICS_DOMAIN}`;
  }

  function escalaAgendaValida(escala) {
    const inicio = new Date(escala.inicio);
    const fim = new Date(escala.fim);
    return Number.isFinite(inicio.getTime()) &&
      Number.isFinite(fim.getTime()) &&
      fim.getTime() > inicio.getTime();
  }

  function montarICS(lista) {
    const dtstamp = dataICS(new Date());
    const linhas = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:${ICS_PRODID}`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    let eventos = 0;
    let ignoradas = 0;

    lista.forEach((escala) => {
      if (!escalaAgendaValida(escala)) { ignoradas += 1; return; }
      const resultado = calcularEscala(escala);
      const descricao = [
        'Escala AC4',
        `Início: ${fmtDataHora(escala.inicio)}`,
        `Término: ${fmtDataHora(escala.fim)}`,
        `Valor estimado: ${fmtMoeda(resultado.valorCentavos)}`,
        'Valor simulado, sujeito à conferência administrativa.',
      ].join('\n');

      linhas.push(
        'BEGIN:VEVENT',
        `UID:${uidEscalaICS(escala)}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dataICS(escala.inicio)}`,
        `DTEND:${dataICS(escala.fim)}`,
        `SUMMARY:${escaparTextoICS(escala.descricao || 'Escala AC4')}`,
        `DESCRIPTION:${escaparTextoICS(descricao)}`,
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
      eventos += 1;
    });

    linhas.push('END:VCALENDAR');
    return { conteudo: linhas.map(dobrarLinhaICS).join('\r\n'), eventos, ignoradas };
  }

  const parseMoedaCampo = (id) => {
    const campo = $(id);
    const raw = String((campo ? campo.value : VALORES_OFICIAIS[id]) || '').trim().replace(',', '.');
    if (!raw) return NaN;
    const valor = Number(raw);
    return Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) : NaN;
  };

  const tabelaVazia = () => ({ portaria: '', valores: { AD: 0, AN: 0, VD: 0, VN: 0 } });

  function lerTabelaAtual() {
    return {
      portaria: PORTARIA_ATUAL,
      valores: {
        AD: parseMoedaCampo('valAD'),
        AN: parseMoedaCampo('valAN'),
        VD: parseMoedaCampo('valVD'),
        VN: parseMoedaCampo('valVN'),
      },
    };
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
    if (!ok) {
      toast('Confira a portaria e todos os valores da tabela antes de calcular.', { erro: true });
      return null;
    }
    return tabela;
  }

  function tabelaParaCalculo(e) {
    void e;
    const atual = lerTabelaAtual();
    return Object.values(atual.valores).every(Number.isFinite) ? atual : tabelaVazia();
  }

  /* --------------------------------------------------------- persistência
     Escalas ficam em localStorage: sobrevivem ao fechamento do app/aba.
     Dados antigos em sessionStorage são automaticamente migrados. */
  function salvar() {
    localStorage.setItem(STORAGE.escalas, JSON.stringify(escalas));
    sessionStorage.removeItem(STORAGE.escalas); // limpa legado
  }

  function salvarConfig() {
    const val = (id) => ($(id) ? $(id).value : VALORES_OFICIAIS[id]);
    const config = { ad: val('valAD'), an: val('valAN'), vd: val('valVD'), vn: val('valVN') };
    localStorage.setItem(STORAGE.config, JSON.stringify(config));
    render();
  }

  function carregar() {
    Object.entries(VALORES_OFICIAIS).forEach(([id, valor]) => { if ($(id)) $(id).value = valor; });
    salvarConfig();
    try {
      // Migra dados salvos em sessionStorage (versão anterior)
      const legado = sessionStorage.getItem(STORAGE.escalas);
      if (legado) {
        const parsed = JSON.parse(legado);
        if (Array.isArray(parsed) && parsed.length) {
          localStorage.setItem(STORAGE.escalas, legado);
        }
        sessionStorage.removeItem(STORAGE.escalas);
      }
      const e = JSON.parse(localStorage.getItem(STORAGE.escalas) || '[]');
      if (Array.isArray(e)) escalas = e.filter((x) => x && x.inicio && x.fim);
    } catch { escalas = []; }
  }

  /* ----------------------------------------------------------------- tema */
  function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema;
    localStorage.setItem(STORAGE.theme, tema);
    if ($('icon-sun')) $('icon-sun').classList.toggle('hidden', tema !== 'dark');
    if ($('icon-moon')) $('icon-moon').classList.toggle('hidden', tema === 'dark');
  }

  function initTema() {
    const salvo = localStorage.getItem(STORAGE.theme);
    const prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    aplicarTema(salvo || (prefereEscuro ? 'dark' : 'light'));

    // Segue preferência do SO dinamicamente (quando o usuário não fixou tema)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE.theme)) {
        aplicarTema(e.matches ? 'dark' : 'light');
      }
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
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, acao ? 6000 : 3500);
  }

  /* -------------------------------------------- dialog de confirmação */
  function dialogConfirmar(mensagem, { textoOk = 'Confirmar', perigoso = true } = {}) {
    return new Promise((resolve) => {
      const dlg = $('dialogConfirm');
      if (!dlg) { resolve(window.confirm(mensagem)); return; }

      $('dialogMsg').textContent = mensagem;
      $('dialogOk').textContent = textoOk;
      $('dialogOk').className = `btn ${perigoso ? 'btn-danger-soft' : 'btn-primary'}`;
      dlg.showModal();

      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function onBackdrop(e) { if (e.target === dlg) { cleanup(); resolve(false); } }

      function cleanup() {
        $('dialogOk').removeEventListener('click', onOk);
        $('dialogCancel').removeEventListener('click', onCancel);
        dlg.removeEventListener('click', onBackdrop);
        if (dlg.open) dlg.close();
      }

      $('dialogOk').addEventListener('click', onOk);
      $('dialogCancel').addEventListener('click', onCancel);
      dlg.addEventListener('click', onBackdrop);
    });
  }

  /* ------------------------------------------------------- haptic feedback */
  const haptic = (pattern = 10) => { try { navigator.vibrate?.(pattern); } catch {} };

  /* -------------------------------------------------------- identificação */
  function carregarOfficer() {
    try { return JSON.parse(localStorage.getItem(STORAGE.officer) || '{}'); } catch { return {}; }
  }

  function salvarOfficer() {
    const data = {
      nome:      $('officerNome')?.value.trim()      || '',
      posto:     $('officerPosto')?.value.trim()     || '',
      matricula: $('officerMatricula')?.value.trim() || '',
      unidade:   $('officerUnidade')?.value.trim()   || '',
      mes:       $('officerMes')?.value              || '',
    };
    localStorage.setItem(STORAGE.officer, JSON.stringify(data));
    atualizarPreviewOfficer(data);
    atualizarPrintOfficer(data);
  }

  function atualizarPreviewOfficer(data) {
    const preview = $('officerPreview');
    if (!preview) return;
    const parts = [data.posto, data.nome].filter(Boolean);
    preview.textContent = parts.length ? `— ${parts.join(' ')}` : '';
  }

  function atualizarPrintOfficer(data) {
    const el = $('printOfficerInfo');
    if (!el) return;
    const parts = [
      data.posto, data.nome,
      data.matricula ? `Mat. ${data.matricula}` : '',
      data.unidade,
      data.mes ? `Ref.: ${fmtMesRef(data.mes)}` : '',
    ].filter(Boolean);
    el.textContent = parts.join(' · ') || 'Policial não identificado';
  }

  function initOfficer() {
    const data = carregarOfficer();
    if ($('officerNome'))      $('officerNome').value = data.nome || '';
    if ($('officerPosto'))     $('officerPosto').value = data.posto || '';
    if ($('officerMatricula')) $('officerMatricula').value = data.matricula || '';
    if ($('officerUnidade'))   $('officerUnidade').value = data.unidade || '';
    if ($('officerMes'))       $('officerMes').value = data.mes || toInputMonth(new Date());

    atualizarPreviewOfficer(data);
    atualizarPrintOfficer(data);

    ['officerNome', 'officerPosto', 'officerMatricula', 'officerUnidade', 'officerMes']
      .forEach((id) => on(id, 'input', salvarOfficer));
  }

  /* -------------------------------------------------------- filtro por mês */
  function atualizarSelectMes() {
    const sel = $('filtroMes');
    if (!sel) return;
    const meses = new Set();
    escalas.forEach((e) => {
      const d = new Date(e.inicio);
      meses.add(toInputMonth(d));
    });

    const antigo = sel.value;
    sel.innerHTML = '<option value="">Todos os meses</option>';
    [...meses].sort().forEach((m) => {
      const label = fmtMesRef(m);
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = label;
      if (m === antigo) opt.selected = true;
      sel.appendChild(opt);
    });

    if (antigo && !meses.has(antigo)) filtroMes = '';
    else filtroMes = sel.value;
  }

  /* ----------------------------------------------------------- cálculo
     Regras (Portaria SSP nº 621/2026):
     - Azul × Vermelha: definida pelo DIA DE INÍCIO (sex/sáb/dom = vermelha).
     - Noturno: [22:00, 05:00) — o minuto das 05:00 já é diurno. */
  function calcularEscala(e) {
    const ini = new Date(e.inicio);
    const fim = new Date(e.fim);
    const mins = Math.max(1, Math.round((fim - ini) / 60000));
    const cont = { AD: 0, AN: 0, VD: 0, VN: 0 };
    const tabela = tabelaParaCalculo(e);

    const diaInicio = ini.getDay();
    const vermelha = diaInicio === 5 || diaInicio === 6 || diaInicio === 0;

    for (let i = 0; i < mins; i++) {
      const m = new Date(ini.getTime() + i * 60000);
      const tempoDia = m.getHours() * 60 + m.getMinutes();
      const noturno = tempoDia >= 22 * 60 || tempoDia < 5 * 60;
      cont[vermelha ? (noturno ? 'VN' : 'VD') : (noturno ? 'AN' : 'AD')]++;
    }

    const centavosMinuto = Object.keys(cont)
      .reduce((s, k) => s + cont[k] * tabela.valores[k], 0);
    const valorCentavos = Math.round(centavosMinuto / 60);
    return {
      mins, cont,
      minDiurno: cont.AD + cont.VD,
      minNoturno: cont.AN + cont.VN,
      minVermelha: cont.VD + cont.VN,
      valorCentavos, tabela,
    };
  }

  function escalasOrdenadas() {
    let lista = [...escalas].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
    if (filtroMes) {
      lista = lista.filter((e) => toInputMonth(new Date(e.inicio)) === filtroMes);
    }
    return lista;
  }

  /* -------------------------------------------------- testes de regressão */
  window.__ac4Testes = function () {
    const h = (n) => n * 60;
    const casos = [
      { caso: '1 sex 03/07 18h→sáb 8h (14h)',  inicio: '2026-07-03T18:00', fim: '2026-07-04T08:00', AD: 0, AN: 0, VD: h(7),  VN: h(7),  centavos: 59500 },
      { caso: '2 sáb 04/07 8h→dom 8h (24h)',   inicio: '2026-07-04T08:00', fim: '2026-07-05T08:00', AD: 0, AN: 0, VD: h(17), VN: h(7),  centavos: 99500 },
      { caso: '3 sex 10/07 18h→sáb 8h (14h)',  inicio: '2026-07-10T18:00', fim: '2026-07-11T08:00', AD: 0, AN: 0, VD: h(7),  VN: h(7),  centavos: 59500 },
      { caso: '4 sáb 11/07 8h→dom 8h (24h)',   inicio: '2026-07-11T08:00', fim: '2026-07-12T08:00', AD: 0, AN: 0, VD: h(17), VN: h(7),  centavos: 99500 },
      { caso: '5 sex 17/07 18h→sáb 8h (14h)',  inicio: '2026-07-17T18:00', fim: '2026-07-18T08:00', AD: 0, AN: 0, VD: h(7),  VN: h(7),  centavos: 59500 },
      { caso: '6 sáb 18/07 8h→dom 8h (24h)',   inicio: '2026-07-18T08:00', fim: '2026-07-19T08:00', AD: 0, AN: 0, VD: h(17), VN: h(7),  centavos: 99500 },
      { caso: '7 sex 24/07 18h→sáb 8h (14h)',  inicio: '2026-07-24T18:00', fim: '2026-07-25T08:00', AD: 0, AN: 0, VD: h(7),  VN: h(7),  centavos: 59500 },
      { caso: 'Azul dia: seg 06/07 8h→18h (10h)',             inicio: '2026-07-06T08:00', fim: '2026-07-06T18:00', AD: h(10), AN: 0,    VD: 0, VN: 0, centavos: 30000 },
      { caso: 'Azul noite: seg 06/07 22h→ter 5h (7h)',        inicio: '2026-07-06T22:00', fim: '2026-07-07T05:00', AD: 0,    AN: h(7),  VD: 0, VN: 0, centavos: 23100 },
      { caso: 'Início qui, vira sex: qui 02/07 20h→sex 6h',   inicio: '2026-07-02T20:00', fim: '2026-07-03T06:00', AD: h(2) + h(1), AN: h(7), VD: 0, VN: 0, centavos: 32100 },
    ];
    const resultados = casos.map((c) => {
      const r = calcularEscala({ inicio: c.inicio, fim: c.fim });
      const ok = ['AD', 'AN', 'VD', 'VN'].every((k) => r.cont[k] === c[k]) && r.valorCentavos === c.centavos;
      return { caso: c.caso, ok, esperado: fmtMoeda(c.centavos), obtido: fmtMoeda(r.valorCentavos), 'azul dia': `${r.cont.AD/60}h`, 'azul noite': `${r.cont.AN/60}h`, 'verm. dia': `${r.cont.VD/60}h`, 'verm. noite': `${r.cont.VN/60}h` };
    });
    if (console.table) console.table(resultados);
    return resultados.every((r) => r.ok) ? 'TODOS OS CASOS OK' : resultados;
  };

  /* --------------------------------------------------------------- ações */
  function validarFormulario() {
    const inicio = $('escalaInicio').value;
    const fim = $('escalaFim').value;
    let ok = true;

    const marca = (fieldId, invalido) => {
      $(fieldId).classList.toggle('invalid', invalido);
      const ctrl = $(fieldId).querySelector('.control');
      if (ctrl) ctrl.setAttribute('aria-invalid', invalido ? 'true' : 'false');
      if (invalido) ok = false;
    };
    marca('fieldInicio', !inicio);
    marca('fieldFim', !fim || (inicio && new Date(fim) <= new Date(inicio)));

    if (!ok) return null;
    const campoDesc = $('escalaDescricao');
    const descricao = (campoDesc && campoDesc.value.trim()) || 'Escala AC4';
    return { inicio, fim, descricao };
  }

  async function submeterFormulario() {
    const dados = validarFormulario();
    if (!dados) return;

    const duracaoHoras = (new Date(dados.fim) - new Date(dados.inicio)) / 3600000;
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
    $('escalaFim').value = e.fim;
    if ($('escalaDuracao')) $('escalaDuracao').value = '';
    if ($('escalaDescricao')) {
      $('escalaDescricao').value = e.descricao === 'Escala AC4' ? '' : (e.descricao || '');
    }
    $('btnSubmit').textContent = 'Salvar alterações';
    $('btnCancelEdit').classList.remove('hidden');
    $('formTitle').lastChild.textContent = 'Editar escala';
    document.querySelector('.launch-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('escalaInicio').focus();
  }

  function cancelarEdicao() {
    editandoId = null;
    if ($('escalaDescricao')) $('escalaDescricao').value = '';
    $('btnSubmit').textContent = 'Adicionar escala';
    $('btnCancelEdit').classList.add('hidden');
    $('formTitle').lastChild.textContent = 'Lançar escala';
    ['fieldInicio', 'fieldFim'].forEach((f) => {
      $(f).classList.remove('invalid');
      const ctrl = $(f).querySelector('.control');
      if (ctrl) ctrl.removeAttribute('aria-invalid');
    });
  }

  function duplicarEscala(id) {
    const e = escalas.find((x) => x.id === id);
    if (!e) return;
    const ini = new Date(e.inicio);
    const fim = new Date(e.fim);
    const umDia = 24 * 3600000;
    escalas.push({
      ...e,
      id: Date.now() + Math.random(),
      inicio: toInputLocal(new Date(ini.getTime() + umDia)),
      fim: toInputLocal(new Date(fim.getTime() + umDia)),
    });
    haptic([10, 30, 10]);
    salvar();
    render();
    toast('Escala duplicada para o dia seguinte.');
  }

  function removerEscala(id) {
    const e = escalas.find((x) => x.id === id);
    if (!e) return;
    ultimaExcluida = e;
    escalas = escalas.filter((x) => x.id !== id);
    if (editandoId === id) cancelarEdicao();
    haptic([10, 20]);
    salvar();
    render();
    toast('Escala removida.', {
      acao: {
        rotulo: 'Desfazer',
        fn: () => {
          if (ultimaExcluida) {
            escalas.push(ultimaExcluida);
            ultimaExcluida = null;
            salvar();
            render();
          }
        },
      },
    });
  }

  async function limparTudo() {
    if (!escalas.length) return;
    const ok = await dialogConfirmar(
      `Remover todas as ${escalas.length} escala${escalas.length === 1 ? '' : 's'}? Esta ação não pode ser desfeita.`
    );
    if (!ok) return;
    escalas = [];
    cancelarEdicao();
    salvar();
    render();
    toast('Todas as escalas foram removidas.');
  }

  /* ---------------------------------------------------------- compartilhar */
  function gerarTextoResumo() {
    const lista = escalasOrdenadas();
    if (!lista.length) return '';
    const resultados = lista.map((e) => ({ e, r: calcularEscala(e) }));
    const totMins  = resultados.reduce((s, x) => s + x.r.mins, 0);
    const totValor = resultados.reduce((s, x) => s + x.r.valorCentavos, 0);
    const officer  = carregarOfficer();

    let texto = '📋 RELATÓRIO AC4\n';
    if (officer.nome || officer.posto) {
      const id = [officer.posto, officer.nome].filter(Boolean).join(' ');
      if (id) texto += `${id}\n`;
      if (officer.matricula) texto += `Mat. ${officer.matricula}\n`;
      if (officer.unidade) texto += `${officer.unidade}\n`;
    }
    if (officer.mes) texto += `Ref.: ${fmtMesRef(officer.mes)}\n`;
    texto += '\n📊 RESUMO\n';
    texto += `• Total: ${fmtHoras(totMins)}\n`;
    texto += `• Valor estimado: ${fmtMoeda(totValor)}\n`;
    texto += '\n📅 ESCALAS\n';
    resultados.forEach(({ e, r }) => {
      const tipo = r.minVermelha > 0 ? '🔴' : '🔵';
      const fimStr = fmtData(e.inicio) === fmtData(e.fim)
        ? fmtHora(e.fim)
        : `${fmtData(e.fim)} ${fmtHora(e.fim)}`;
      texto += `${tipo} ${fmtDiaSemana(e.inicio)}, ${fmtData(e.inicio)}\n`;
      texto += `   ${fmtHora(e.inicio)} → ${fimStr} (${fmtHoras(r.mins)})\n`;
      texto += `   ${fmtMoeda(r.valorCentavos)}\n`;
    });
    texto += '\n⚠️ Valor simulado — sujeito a validação administrativa.\n';
    texto += 'Calculadora AC4 · calculadora-ac4-pmgo.github.io';
    return texto;
  }

  async function compartilharWhatsApp() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de compartilhar.', { erro: true }); return; }
    const texto = gerarTextoResumo();
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  }

  async function compartilharNativo() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de compartilhar.', { erro: true }); return; }
    const texto = gerarTextoResumo();
    try {
      await navigator.share({ title: 'Relatório AC4', text: texto });
    } catch (e) {
      if (e.name !== 'AbortError') compartilharWhatsApp();
    }
  }

  async function copiarResumo() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de copiar.', { erro: true }); return; }
    const texto = gerarTextoResumo();
    try {
      await navigator.clipboard.writeText(texto);
      haptic([10, 10]);
      toast('Resumo copiado para a área de transferência!');
    } catch {
      toast('Não foi possível copiar automaticamente.', { erro: true });
    }
  }

  function abrirShareSheet() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de compartilhar.', { erro: true }); return; }
    const dlg = $('dialogShare');
    if (!dlg) { compartilharWhatsApp(); return; }
    // Mostra botão de compartilhamento nativo se disponível
    const nativeBtn = $('shareNative');
    if (nativeBtn) nativeBtn.style.display = navigator.share ? '' : 'none';
    dlg.showModal();
  }

  /* ----------------------------------------------------------- render */
  function render() {
    atualizarSelectMes();

    const lista = escalasOrdenadas();
    const resultados = lista.map((e) => ({ e, r: calcularEscala(e) }));

    const totMins    = resultados.reduce((s, x) => s + x.r.mins, 0);
    const totDiurno  = resultados.reduce((s, x) => s + x.r.minDiurno, 0);
    const totNoturno = resultados.reduce((s, x) => s + x.r.minNoturno, 0);
    const totValor   = resultados.reduce((s, x) => s + x.r.valorCentavos, 0);

    $('totHoras').textContent    = fmtHoras(totMins);
    $('totDiurnas').textContent  = fmtHorasCheias(totDiurno);
    $('totNoturnas').textContent = fmtHorasCheias(totNoturno);
    $('totValor').textContent    = fmtMoeda(totValor);
    $('mobileTotal').textContent = fmtMoeda(totValor);
    $('pctDiurnas').textContent  = totMins ? `${((totDiurno  / totMins) * 100).toFixed(1).replace('.', ',')}% do total` : '0% do total';
    $('pctNoturnas').textContent = totMins ? `${((totNoturno / totMins) * 100).toFixed(1).replace('.', ',')}% do total` : '0% do total';

    const totalEscalas = filtroMes ? lista.length : escalas.length;
    const sufixo = filtroMes ? ` em ${fmtMesRef(filtroMes)}` : ' no período';
    $('totQtd').textContent = `${lista.length} escala${lista.length === 1 ? '' : 's'}${sufixo}`;

    $('btnClearAll').classList.toggle('hidden', escalas.length === 0);

    const container = $('listaEscalas');
    if (!lista.length) {
      const msgFiltro = filtroMes
        ? 'Nenhuma escala neste mês. Selecione outro mês ou adicione escalas.'
        : 'Preencha o formulário acima para iniciar o cálculo.';
      container.innerHTML = `
        <div class="empty-state">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>
          </svg>
          <h3>Nenhuma escala lançada</h3>
          <p>${escapeHTML(msgFiltro)}</p>
        </div>`;
      $('printDate').textContent = new Date().toLocaleString('pt-BR');
      atualizarPrintOfficer(carregarOfficer());
      return;
    }

    let html = `
      <div class="table-wrap">
        <table class="escala-table">
          <thead>
            <tr>
              <th>Dia</th><th>Data</th><th>Início</th><th>Término</th>
              <th>Tipo</th><th>Horas</th><th>Valor</th><th>Ações</th>
            </tr>
          </thead>
          <tbody>`;
    resultados.forEach(({ e, r }) => {
      const tipoChips = [];
      if (r.minVermelha > 0) tipoChips.push('<span class="chip chip-red">Vermelha</span>');
      if (r.minVermelha < r.mins) tipoChips.push('<span class="chip chip-blue">Azul</span>');
      tipoChips.push(r.minNoturno > 0
        ? `<span class="chip chip-night">${fmtHorasCheias(r.minNoturno)} noturno</span>`
        : '<span class="chip chip-day">Diurno</span>');

      const fimStr = fmtData(e.inicio) === fmtData(e.fim)
        ? fmtHora(e.fim)
        : `${fmtData(e.fim)} ${fmtHora(e.fim)}`;

      html += `
        <tr>
          <td data-label="Dia">${fmtDiaSemana(e.inicio)}</td>
          <td data-label="Data">
            ${fmtData(e.inicio)}
            <span class="table-note">${escapeHTML(e.descricao)}</span>
          </td>
          <td data-label="Início">${fmtHora(e.inicio)}</td>
          <td data-label="Término">${fimStr}</td>
          <td data-label="Tipo"><div class="chips">${tipoChips.join('')}</div></td>
          <td data-label="Horas">${fmtHoras(r.mins)}</td>
          <td data-label="Valor" class="value-cell">${fmtMoeda(r.valorCentavos)}</td>
          <td data-label="Ações">
            <div class="escala-actions">
              <button class="btn-icon" data-acao="duplicar" data-id="${e.id}" title="Duplicar para o dia seguinte" aria-label="Duplicar escala">
                <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>
                </svg>
              </button>
              <button class="btn-icon" data-acao="editar" data-id="${e.id}" title="Editar" aria-label="Editar escala">
                <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                </svg>
              </button>
              <button class="btn-icon delete" data-acao="remover" data-id="${e.id}" title="Excluir" aria-label="Excluir escala">
                <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
    $('printDate').textContent = new Date().toLocaleString('pt-BR');
    atualizarPrintOfficer(carregarOfficer());
  }

  /* ------------------------------------------------------- exportações */
  function exportarICS() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de gerar o arquivo .ics.', { erro: true }); return; }
    const arquivo = montarICS(lista);
    if (!arquivo.eventos) { toast('Não há escalas válidas para gerar o arquivo .ics.', { erro: true }); return; }
    baixar(arquivo.conteudo, 'escalas-ac4.ics', 'text/calendar;charset=utf-8');
    const complemento = arquivo.ignoradas
      ? ` ${arquivo.ignoradas} escala${arquivo.ignoradas === 1 ? '' : 's'} inválida${arquivo.ignoradas === 1 ? '' : 's'} não foram exportadas.`
      : '';
    toast(`Arquivo gerado. Na Agenda Google, use "Importar" para adicionar as escalas.${complemento}`);
  }

  function desdobrarLinhasICS(conteudo) {
    return conteudo.split('\r\n').reduce((acc, linha) => {
      if (/^[ \t]/.test(linha) && acc.length) acc[acc.length - 1] += linha.slice(1);
      else acc.push(linha);
      return acc;
    }, []);
  }

  function parseDataICS(valor) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(valor || '');
    if (!m) return null;
    const data = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return Number.isFinite(data.getTime()) ? data : null;
  }

  window.__ac4ValidarICS = function (entrada) {
    const fonte = Array.isArray(entrada) ? entrada : escalasOrdenadas();
    const arquivo = montarICS(fonte);
    const falhas = [];
    const conteudo = arquivo.conteudo;

    if (!conteudo.startsWith('BEGIN:VCALENDAR')) falhas.push('Arquivo não inicia com BEGIN:VCALENDAR.');
    if (!conteudo.endsWith('END:VCALENDAR'))   falhas.push('Arquivo não encerra com END:VCALENDAR.');
    if (!conteudo.includes('\r\n'))            falhas.push('Arquivo não usa quebras de linha CRLF.');
    if (/[^\r]\n|\r(?!\n)/.test(conteudo))    falhas.push('Arquivo contém quebras de linha fora do padrão CRLF.');

    conteudo.split('\r\n').forEach((linha, index) => {
      if (contarOctetos(linha) > 75) falhas.push(`Linha física ${index + 1} excede 75 octetos.`);
    });

    const linhas = desdobrarLinhasICS(conteudo);
    ['VERSION:2.0', `PRODID:${ICS_PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
      .forEach((item) => { if (!linhas.includes(item)) falhas.push(`Campo obrigatório ausente: ${item}.`); });

    const eventos = [];
    let atual = null;
    linhas.forEach((linha) => {
      if (linha === 'BEGIN:VEVENT')      { atual = []; }
      else if (linha === 'END:VEVENT')   { if (atual) eventos.push(atual); atual = null; }
      else if (atual)                    { atual.push(linha); }
    });

    if (arquivo.eventos > 0 && !eventos.length) falhas.push('Há escalas válidas, mas nenhum VEVENT foi encontrado.');
    if (eventos.length !== arquivo.eventos) falhas.push('Quantidade de VEVENTs não corresponde às escalas válidas.');

    eventos.forEach((evento, index) => {
      const obter = (campo) => evento.find((linha) => linha.startsWith(`${campo}:`));
      ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY'].forEach((campo) => {
        if (!obter(campo)) falhas.push(`VEVENT ${index + 1} sem ${campo}.`);
      });
      const inicio = parseDataICS((obter('DTSTART') || '').slice('DTSTART:'.length));
      const fim    = parseDataICS((obter('DTEND')   || '').slice('DTEND:'.length));
      if (!inicio) falhas.push(`VEVENT ${index + 1} possui DTSTART inválido.`);
      if (!fim)    falhas.push(`VEVENT ${index + 1} possui DTEND inválido.`);
      if (inicio && fim && fim <= inicio) falhas.push(`VEVENT ${index + 1} possui DTEND menor ou igual ao DTSTART.`);
    });

    const resultado = { ok: falhas.length === 0, eventos: eventos.length, ignoradas: arquivo.ignoradas, falhas };
    if (falhas.length && console.table) console.table(falhas);
    return resultado;
  };

  function exportarCSV() {
    const lista = escalasOrdenadas();
    if (!lista.length) { toast('Adicione escalas antes de exportar CSV.', { erro: true }); return; }
    const sep = ';';
    const num = (cent) => (cent / 100).toFixed(2).replace('.', ',');
    const linhas = [
      ['Descrição', 'Início', 'Término', 'Horas', 'Horas diurnas', 'Horas noturnas', 'Portaria/tabela', 'Valor (R$)'].join(sep),
    ];
    let total = 0;
    lista.forEach((e) => {
      const r = calcularEscala(e);
      total += r.valorCentavos;
      linhas.push([
        `"${e.descricao.replace(/"/g, '""')}"`,
        fmtDataHora(e.inicio), fmtDataHora(e.fim),
        (r.mins / 60).toFixed(2).replace('.', ','),
        (r.minDiurno / 60).toFixed(2).replace('.', ','),
        (r.minNoturno / 60).toFixed(2).replace('.', ','),
        `"${(r.tabela.portaria || '').replace(/"/g, '""')}"`,
        num(r.valorCentavos),
      ].join(sep));
    });
    linhas.push(['TOTAL', '', '', '', '', '', '', num(total)].join(sep));
    baixar('﻿' + linhas.join('\r\n'), 'escalas-ac4.csv', 'text/csv;charset=utf-8');
    toast('Planilha CSV gerada.');
  }

  function baixar(conteudo, nome, tipo) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ------------------------------------------------ PWA install prompt */
  function initPWA() {
    const dismissed = localStorage.getItem(STORAGE.pwaBanner);
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (!dismissed) $('pwaBanner')?.classList.remove('hidden');
    });

    on('pwaBannerInstall', 'click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('pwaBanner')?.classList.add('hidden');
      if (outcome === 'accepted') toast('App instalado com sucesso!');
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
    initOfficer();
    initPWA();

    $('escalaInicio').value = toInputLocal(new Date());

    // form
    on('formEscala', 'submit', (ev) => { ev.preventDefault(); submeterFormulario(); });
    on('btnCancelEdit', 'click', cancelarEdicao);

    // topbar
    on('btnTheme', 'click', () =>
      aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    on('btnPrint', 'click', () => window.print());
    on('btnExportIcs', 'click', exportarICS);
    on('btnExportCsv', 'click', exportarCSV);
    on('btnShare', 'click', abrirShareSheet);

    // mobile bar
    on('mobileAdd', 'click', () => {
      const painel = document.querySelector('.launch-panel');
      if (painel) painel.scrollIntoView({ behavior: 'smooth' });
      $('escalaInicio').focus();
    });
    on('mobileShare', 'click', abrirShareSheet);

    // share sheet
    on('shareWA', 'click', () => { $('dialogShare')?.close(); compartilharWhatsApp(); });
    on('shareNative', 'click', () => { $('dialogShare')?.close(); compartilharNativo(); });
    on('shareCopy', 'click', () => { $('dialogShare')?.close(); copiarResumo(); });
    on('shareIcsOpt', 'click', () => { $('dialogShare')?.close(); exportarICS(); });
    on('shareCsvOpt', 'click', () => { $('dialogShare')?.close(); exportarCSV(); });
    on('sharePdfOpt', 'click', () => { $('dialogShare')?.close(); window.print(); });
    on('shareClose', 'click', () => $('dialogShare')?.close());

    // feed
    on('btnClearAll', 'click', limparTudo);
    on('filtroMes', 'change', () => {
      filtroMes = $('filtroMes')?.value || '';
      render();
    });

    // duração pré-definida
    const aplicarDuracao = () => {
      const sel = $('escalaDuracao');
      const horas = sel ? Number(sel.value) : 0;
      const ini = $('escalaInicio').value;
      if (!horas || !ini) return;
      $('escalaFim').value = toInputLocal(new Date(new Date(ini).getTime() + horas * 3600000));
      $('fieldFim').classList.remove('invalid');
    };
    on('escalaDuracao', 'change', aplicarDuracao);
    on('escalaInicio', 'change', aplicarDuracao);
    on('escalaFim', 'input', () => { if ($('escalaDuracao')) $('escalaDuracao').value = ''; });

    // ações delegadas da lista
    on('listaEscalas', 'click', (ev) => {
      const btn = ev.target.closest('[data-acao]');
      if (!btn) return;
      const id = parseFloat(btn.dataset.id);
      if (btn.dataset.acao === 'remover')    removerEscala(id);
      else if (btn.dataset.acao === 'editar')    editarEscala(id);
      else if (btn.dataset.acao === 'duplicar') duplicarEscala(id);
    });

    // atalhos de teclado
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submeterFormulario();
      }
      if (e.key === 'Escape' && editandoId !== null) {
        cancelarEdicao();
      }
    });

    render();

    // PWA service worker
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
