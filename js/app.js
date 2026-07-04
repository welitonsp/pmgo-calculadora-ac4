/* ==========================================================================
   Calculadora AC4 — PMGO
   Lógica da aplicação: estado, cálculo, persistência, ICS, UI reativa.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const STORAGE = {
    escalas: 'pmgoEscalas',
    config: 'pmgoConfig',
    theme: 'pmgoTheme',
  };

  /* ------------------------------------------------------------ estado */
  let escalas = [];          // { id, inicio, fim, descricao, feriado }
  let editandoId = null;     // id da escala em edição (null = criando)
  let filtroMes = 'todos';   // 'todos' | 'YYYY-MM'
  let ultimaExcluida = null; // para desfazer
  let importCandidatos = []; // eventos do ICS aguardando confirmação

  /* -------------------------------------------------------- utilitários */
  const fmtMoeda = (cent) =>
    (cent / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const fmtHoras = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
  };

  const fmtDataHora = (iso) =>
    new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });

  const fmtDiaCompleto = (iso) =>
    new Date(iso).toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });

  const toInputLocal = (date) => {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };

  const tarifaCentavos = (id) => Math.round(parseFloat($(id).value || '0') * 100);

  const escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------- persistência */
  function salvar() {
    localStorage.setItem(STORAGE.escalas, JSON.stringify(escalas));
  }

  function salvarConfig() {
    const config = {
      ad: $('valAD').value, an: $('valAN').value,
      vd: $('valVD').value, vn: $('valVN').value,
    };
    localStorage.setItem(STORAGE.config, JSON.stringify(config));
    render();
  }

  function carregar() {
    try {
      const c = JSON.parse(localStorage.getItem(STORAGE.config) || 'null');
      if (c) {
        if (c.ad) $('valAD').value = c.ad;
        if (c.an) $('valAN').value = c.an;
        if (c.vd) $('valVD').value = c.vd;
        if (c.vn) $('valVN').value = c.vn;
      }
    } catch { /* config corrompida: usa padrões */ }
    try {
      const e = JSON.parse(localStorage.getItem(STORAGE.escalas) || '[]');
      if (Array.isArray(e)) escalas = e.filter((x) => x && x.inicio && x.fim);
    } catch { escalas = []; }
  }

  /* --------------------------------------------------------------- tema */
  function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema;
    localStorage.setItem(STORAGE.theme, tema);
    $('icon-sun').classList.toggle('hidden', tema !== 'dark');
    $('icon-moon').classList.toggle('hidden', tema === 'dark');
  }

  function initTema() {
    const salvo = localStorage.getItem(STORAGE.theme);
    const prefereEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    aplicarTema(salvo || (prefereEscuro ? 'dark' : 'light'));
  }

  /* -------------------------------------------------------------- toast */
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

  /* ------------------------------------------------------------- cálculo
     Regras (Portaria SSP): minuto a minuto.
     - Noturno: 22:00 até 05:00 (inclusive).
     - Vermelha: sexta, sábado, domingo — ou escala marcada como feriado.  */
  function calcularEscala(e) {
    const ini = new Date(e.inicio);
    const fim = new Date(e.fim);
    const mins = Math.max(1, Math.round((fim - ini) / 60000));
    const cont = { AD: 0, AN: 0, VD: 0, VN: 0 };

    for (let i = 0; i < mins; i++) {
      const m = new Date(ini.getTime() + i * 60000);
      const dia = m.getDay();
      const tempoDia = m.getHours() * 60 + m.getMinutes();
      const noturno = tempoDia >= 22 * 60 || tempoDia <= 5 * 60;
      const vermelha = e.feriado || dia === 5 || dia === 6 || dia === 0;
      cont[vermelha ? (noturno ? 'VN' : 'VD') : (noturno ? 'AN' : 'AD')]++;
    }

    const tarifas = {
      AD: tarifaCentavos('valAD'), AN: tarifaCentavos('valAN'),
      VD: tarifaCentavos('valVD'), VN: tarifaCentavos('valVN'),
    };
    const valorCentavos = Math.round(
      Object.keys(cont).reduce((s, k) => s + (cont[k] * tarifas[k]) / 60, 0)
    );
    return {
      mins,
      minDiurno: cont.AD + cont.VD,
      minNoturno: cont.AN + cont.VN,
      minVermelha: cont.VD + cont.VN,
      valorCentavos,
    };
  }

  const escalasFiltradas = () => {
    const lista = filtroMes === 'todos'
      ? escalas
      : escalas.filter((e) => e.inicio.slice(0, 7) === filtroMes);
    return [...lista].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  };

  /* --------------------------------------------------------------- ações */
  function validarFormulario() {
    const inicio = $('escalaInicio').value;
    const fim = $('escalaFim').value;
    const descricao = $('escalaDescricao').value.trim();
    let ok = true;

    const marca = (fieldId, invalido) => {
      $(fieldId).classList.toggle('invalid', invalido);
      if (invalido) ok = false;
    };
    marca('fieldInicio', !inicio);
    marca('fieldFim', !fim || (inicio && new Date(fim) <= new Date(inicio)));
    marca('fieldDescricao', !descricao);

    const duracaoHoras = inicio && fim ? (new Date(fim) - new Date(inicio)) / 3600000 : 0;
    if (ok && duracaoHoras > 24 &&
        !confirm(`A escala tem ${duracaoHoras.toFixed(1)} horas de duração. Confirma?`)) {
      ok = false;
    }
    return ok ? { inicio, fim, descricao, feriado: $('escalaFeriado').checked } : null;
  }

  function submeterFormulario() {
    const dados = validarFormulario();
    if (!dados) return;

    if (editandoId !== null) {
      const idx = escalas.findIndex((e) => e.id === editandoId);
      if (idx >= 0) escalas[idx] = { ...escalas[idx], ...dados };
      cancelarEdicao();
      toast('Escala atualizada.');
    } else {
      escalas.push({ id: Date.now() + Math.random(), ...dados });
      $('escalaDescricao').value = '';
      $('escalaFeriado').checked = false;
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
    $('escalaDescricao').value = e.descricao;
    $('escalaFeriado').checked = !!e.feriado;
    $('btnSubmit').textContent = 'Salvar alterações';
    $('btnCancelEdit').classList.remove('hidden');
    $('formTitle').textContent = 'Editar escala';
    document.querySelector('.left-col').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('escalaDescricao').focus();
  }

  function cancelarEdicao() {
    editandoId = null;
    $('btnSubmit').textContent = 'Adicionar escala';
    $('btnCancelEdit').classList.add('hidden');
    $('formTitle').textContent = 'Lançar escala';
    $('escalaDescricao').value = '';
    $('escalaFeriado').checked = false;
    ['fieldInicio', 'fieldFim', 'fieldDescricao'].forEach((f) => $(f).classList.remove('invalid'));
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

  function limparTudo() {
    if (!escalas.length) return;
    if (!confirm(`Remover todas as ${escalas.length} escalas? Esta ação não pode ser desfeita.`)) return;
    escalas = [];
    cancelarEdicao();
    salvar();
    render();
    toast('Todas as escalas foram removidas.');
  }

  /* ----------------------------------------------------------- render */
  function render() {
    const lista = escalasFiltradas();
    const resultados = lista.map((e) => ({ e, r: calcularEscala(e) }));

    // métricas
    const totMins = resultados.reduce((s, x) => s + x.r.mins, 0);
    const totDiurno = resultados.reduce((s, x) => s + x.r.minDiurno, 0);
    const totNoturno = resultados.reduce((s, x) => s + x.r.minNoturno, 0);
    const totValor = resultados.reduce((s, x) => s + x.r.valorCentavos, 0);

    $('totHoras').textContent = fmtHoras(totMins);
    $('totDiurnoNoturno').textContent =
      `${fmtHoras(totDiurno)} diurno · ${fmtHoras(totNoturno)} noturno`;
    $('totQtd').textContent = String(lista.length);
    $('totValor').textContent = fmtMoeda(totValor);
    $('mobileTotal').textContent = fmtMoeda(totValor);

    // seletor de mês
    renderFiltroMes();

    // botões dependentes de dados
    const temDados = lista.length > 0;
    $('btnExportIcs').classList.toggle('hidden', !temDados);
    $('btnExportCsv').classList.toggle('hidden', !temDados);
    $('btnClearAll').classList.toggle('hidden', escalas.length === 0);

    // lista
    const container = $('listaEscalas');
    if (!temDados) {
      container.innerHTML = `
        <div class="empty-state">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>
          </svg>
          <h3>${filtroMes === 'todos' ? 'Nenhuma escala lançada' : 'Nenhuma escala neste mês'}</h3>
          <p>${filtroMes === 'todos'
            ? 'Preencha o formulário ou importe um arquivo .ics para começar.'
            : 'Escolha outro mês no filtro acima.'}</p>
        </div>`;
      $('printDate').textContent = new Date().toLocaleString('pt-BR');
      return;
    }

    let html = '';
    let diaAtual = '';
    resultados.forEach(({ e, r }, idx) => {
      const dia = e.inicio.slice(0, 10);
      if (dia !== diaAtual) {
        diaAtual = dia;
        html += `<div class="day-group">${escapeHTML(fmtDiaCompleto(e.inicio))}</div>`;
      }
      const chips = [];
      if (r.minVermelha > 0) chips.push('<span class="chip chip-red">Vermelha</span>');
      if (r.minVermelha < r.mins) chips.push('<span class="chip chip-green">Azul</span>');
      if (r.minNoturno > 0) chips.push(`<span class="chip chip-night">${fmtHoras(r.minNoturno)} noturno</span>`);
      if (e.feriado) chips.push('<span class="chip chip-neutral">Feriado</span>');
      chips.push(`<span class="chip chip-neutral">${fmtHoras(r.mins)}</span>`);

      html += `
        <article class="escala-card" style="animation-delay:${Math.min(idx * 30, 300)}ms">
          <div class="escala-top">
            <div class="escala-info">
              <div class="escala-title">${escapeHTML(e.descricao)}</div>
              <div class="escala-time">
                <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
                </svg>
                ${fmtDataHora(e.inicio)} → ${fmtDataHora(e.fim)}
              </div>
            </div>
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
          </div>
          <div class="escala-bottom">
            <div class="chips">${chips.join('')}</div>
            <div class="escala-valor">${fmtMoeda(r.valorCentavos)}</div>
          </div>
        </article>`;
    });
    container.innerHTML = html;
    $('printDate').textContent = new Date().toLocaleString('pt-BR');
  }

  function renderFiltroMes() {
    const sel = $('filtroMes');
    const meses = [...new Set(escalas.map((e) => e.inicio.slice(0, 7)))].sort();
    const atual = filtroMes;
    sel.innerHTML = '<option value="todos">Todos os meses</option>' +
      meses.map((m) => {
        const [ano, mes] = m.split('-');
        const nome = new Date(+ano, +mes - 1, 1)
          .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return `<option value="${m}">${nome[0].toUpperCase() + nome.slice(1)}</option>`;
      }).join('');
    sel.value = meses.includes(atual) ? atual : 'todos';
    filtroMes = sel.value;
    sel.classList.toggle('hidden', meses.length < 2);
  }

  /* ------------------------------------------------------------- ICS */
  function parseICS(texto) {
    // desdobra linhas continuadas (RFC 5545: linhas seguintes começam com espaço/tab)
    const linhas = texto.split(/\r?\n/).reduce((acc, l) => {
      if (/^[ \t]/.test(l) && acc.length) acc[acc.length - 1] += l.slice(1);
      else acc.push(l);
      return acc;
    }, []);

    const parseData = (linha) => {
      const valor = linha.slice(linha.indexOf(':') + 1).trim();
      const m = valor.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
      if (!m) return null;
      const [, Y, Mo, D, h = '0', mi = '0', s = '0', z] = m;
      const d = z
        ? new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s))
        : new Date(+Y, +Mo - 1, +D, +h, +mi, +s);
      return isNaN(d) ? null : toInputLocal(d);
    };

    const unescape = (s) =>
      s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

    const eventos = [];
    let atual = null;
    for (const l of linhas) {
      if (l.startsWith('BEGIN:VEVENT')) { atual = {}; continue; }
      if (l.startsWith('END:VEVENT')) {
        if (atual && atual.inicio && atual.fim && atual.descricao) eventos.push(atual);
        atual = null;
        continue;
      }
      if (!atual) continue;
      if (l.startsWith('DTSTART')) atual.inicio = parseData(l);
      else if (l.startsWith('DTEND')) atual.fim = parseData(l);
      else if (l.startsWith('SUMMARY')) atual.descricao = unescape(l.slice(l.indexOf(':') + 1));
    }
    return eventos;
  }

  function importarICS(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const eventos = parseICS(String(reader.result));
      $('icsFile').value = '';
      if (!eventos.length) {
        toast('Nenhum evento válido encontrado no arquivo.', { erro: true });
        return;
      }
      const kw = ['AC4', 'EXTRA', 'SERVICO', 'SERVIÇO', 'PLANTAO', 'PLANTÃO', 'ESCALA'];
      importCandidatos = eventos.map((ev) => ({
        ...ev,
        selecionado: kw.some((k) => ev.descricao.toUpperCase().includes(k)),
      }));
      abrirModalImport();
    };
    reader.onerror = () => toast('Não foi possível ler o arquivo.', { erro: true });
    reader.readAsText(file);
  }

  function abrirModalImport() {
    renderModalImport();
    $('modalImport').showModal();
  }

  function renderModalImport() {
    const body = $('importLista');
    body.innerHTML = importCandidatos.map((ev, i) => `
      <label class="import-item ${ev.selecionado ? 'selected' : ''}">
        <input type="checkbox" data-idx="${i}" ${ev.selecionado ? 'checked' : ''}>
        <div>
          <div class="import-title">${escapeHTML(ev.descricao)}</div>
          <div class="import-time">${fmtDataHora(ev.inicio)} → ${fmtDataHora(ev.fim)}</div>
        </div>
      </label>`).join('');
    const n = importCandidatos.filter((e) => e.selecionado).length;
    $('btnConfirmImport').textContent = n ? `Importar ${n} evento${n > 1 ? 's' : ''}` : 'Importar';
    $('btnConfirmImport').disabled = n === 0;
  }

  function confirmarImport() {
    const selecionados = importCandidatos.filter((e) => e.selecionado);
    selecionados.forEach((ev) => {
      escalas.push({
        id: Date.now() + Math.random(),
        inicio: ev.inicio,
        fim: ev.fim,
        descricao: ev.descricao,
        feriado: false,
      });
    });
    $('modalImport').close();
    importCandidatos = [];
    salvar();
    render();
    toast(`${selecionados.length} escala${selecionados.length > 1 ? 's importadas' : ' importada'}.`);
  }

  /* ------------------------------------------------------- exportações */
  function exportarICS() {
    const lista = escalasFiltradas();
    if (!lista.length) return;
    const fmt = (iso) =>
      new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
    const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PMGO//Calculadora AC4//PT-BR'];
    lista.forEach((e, i) => {
      linhas.push(
        'BEGIN:VEVENT',
        `UID:ac4-${Date.now()}-${i}@pmgo`,
        `DTSTAMP:${fmt(new Date().toISOString())}`,
        `DTSTART:${fmt(e.inicio)}`,
        `DTEND:${fmt(e.fim)}`,
        `SUMMARY:${esc(e.descricao)}`,
        'END:VEVENT'
      );
    });
    linhas.push('END:VCALENDAR');
    baixar(linhas.join('\r\n'), 'escalas-ac4.ics', 'text/calendar');
    toast('Arquivo .ics gerado.');
  }

  function exportarCSV() {
    const lista = escalasFiltradas();
    if (!lista.length) return;
    const sep = ';';
    const num = (cent) => (cent / 100).toFixed(2).replace('.', ',');
    const linhas = [
      ['Descrição', 'Início', 'Término', 'Horas', 'Horas diurnas', 'Horas noturnas', 'Feriado', 'Valor (R$)'].join(sep),
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
        e.feriado ? 'Sim' : 'Não',
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

  /* --------------------------------------------------------------- init */
  function init() {
    initTema();
    carregar();

    // valores padrão do formulário
    const agora = new Date();
    $('escalaInicio').value = toInputLocal(agora);
    $('escalaFim').value = toInputLocal(new Date(agora.getTime() + 8 * 3600000));

    // eventos
    $('formEscala').addEventListener('submit', (ev) => { ev.preventDefault(); submeterFormulario(); });
    $('btnCancelEdit').addEventListener('click', cancelarEdicao);
    $('btnTheme').addEventListener('click', () =>
      aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    $('btnPrint').addEventListener('click', () => window.print());
    $('btnImportIcs').addEventListener('click', () => $('icsFile').click());
    $('icsFile').addEventListener('change', importarICS);
    $('btnExportIcs').addEventListener('click', exportarICS);
    $('btnExportCsv').addEventListener('click', exportarCSV);
    $('btnClearAll').addEventListener('click', limparTudo);
    $('filtroMes').addEventListener('change', (ev) => { filtroMes = ev.target.value; render(); });
    $('mobileAdd').addEventListener('click', () => {
      document.querySelector('.left-col').scrollIntoView({ behavior: 'smooth' });
      $('escalaInicio').focus();
    });

    // início automático do término: +8h quando o início muda
    $('escalaInicio').addEventListener('change', () => {
      const v = $('escalaInicio').value;
      if (v) $('escalaFim').value = toInputLocal(new Date(new Date(v).getTime() + 8 * 3600000));
    });

    ['valAD', 'valAN', 'valVD', 'valVN'].forEach((id) =>
      $(id).addEventListener('input', salvarConfig));

    // ações delegadas da lista
    $('listaEscalas').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-acao]');
      if (!btn) return;
      const id = parseFloat(btn.dataset.id);
      if (btn.dataset.acao === 'remover') removerEscala(id);
      else if (btn.dataset.acao === 'editar') editarEscala(id);
      else if (btn.dataset.acao === 'duplicar') duplicarEscala(id);
    });

    // modal de importação
    $('importLista').addEventListener('change', (ev) => {
      const cb = ev.target.closest('input[data-idx]');
      if (!cb) return;
      importCandidatos[+cb.dataset.idx].selecionado = cb.checked;
      renderModalImport();
    });
    $('btnConfirmImport').addEventListener('click', confirmarImport);
    $('btnCancelImport').addEventListener('click', () => {
      $('modalImport').close();
      importCandidatos = [];
    });
    $('btnSelectAll').addEventListener('click', () => {
      const todos = importCandidatos.every((e) => e.selecionado);
      importCandidatos.forEach((e) => { e.selecionado = !todos; });
      renderModalImport();
    });

    render();

    // PWA
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
