/* ==========================================================================
   Calculadora AC4 — PMGO
   Lógica da aplicação: estado, cálculo, persistência, ICS, UI reativa.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Liga um evento apenas se o elemento existir — evita que uma página em
  // cache (HTML antigo + JS novo, ou o inverso) derrube toda a inicialização.
  const on = (id, evt, fn) => {
    const el = $(id);
    if (el) el.addEventListener(evt, fn);
  };

  const STORAGE = {
    escalas: 'pmgoEscalas',
    config: 'pmgoConfig',
    theme: 'pmgoTheme',
  };

  /* ------------------------------------------------------------ estado */
  let escalas = [];          // { id, inicio, fim, descricao, tabela }
  let editandoId = null;     // id da escala em edição (null = criando)
  let ultimaExcluida = null; // para desfazer
  const PORTARIA_ATUAL = 'Portaria SSP nº 621/2026';
  const VALORES_OFICIAIS = { valAD: '30', valAN: '33', valVD: '40', valVN: '45' };

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

  const fmtData = (iso) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const fmtHora = (iso) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const toInputLocal = (date) => {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };

  const escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const parseMoedaCampo = (id) => {
    // fallback aos valores oficiais caso o campo não exista na página em cache
    const campo = $(id);
    const raw = String((campo ? campo.value : VALORES_OFICIAIS[id]) || '').trim().replace(',', '.');
    if (!raw) return NaN;
    const valor = Number(raw);
    return Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) : NaN;
  };

  const tabelaVazia = () => ({
    portaria: '',
    valores: { AD: 0, AN: 0, VD: 0, VN: 0 },
  });

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

  /* ------------------------------------------------------- persistência */
  function salvar() {
    localStorage.setItem(STORAGE.escalas, JSON.stringify(escalas));
  }

  function salvarConfig() {
    const val = (id) => ($(id) ? $(id).value : VALORES_OFICIAIS[id]);
    const config = {
      ad: val('valAD'), an: val('valAN'),
      vd: val('valVD'), vn: val('valVN'),
    };
    localStorage.setItem(STORAGE.config, JSON.stringify(config));
    render();
  }

  function carregar() {
    Object.entries(VALORES_OFICIAIS).forEach(([id, valor]) => { if ($(id)) $(id).value = valor; });
    salvarConfig();
    try {
      const e = JSON.parse(localStorage.getItem(STORAGE.escalas) || '[]');
      if (Array.isArray(e)) escalas = e.filter((x) => x && x.inicio && x.fim);
    } catch { escalas = []; }
  }

  /* --------------------------------------------------------------- tema */
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
     - Noturno: 22:00 até 05:00.
     - Vermelha: sexta, sábado e domingo.  */
  function calcularEscala(e) {
    const ini = new Date(e.inicio);
    const fim = new Date(e.fim);
    const mins = Math.max(1, Math.round((fim - ini) / 60000));
    const cont = { AD: 0, AN: 0, VD: 0, VN: 0 };
    const tabela = tabelaParaCalculo(e);

    for (let i = 0; i < mins; i++) {
      const m = new Date(ini.getTime() + i * 60000);
      const dia = m.getDay();
      const tempoDia = m.getHours() * 60 + m.getMinutes();
      const noturno = tempoDia >= 22 * 60 || tempoDia <= 5 * 60;
      const vermelha = dia === 5 || dia === 6 || dia === 0;
      cont[vermelha ? (noturno ? 'VN' : 'VD') : (noturno ? 'AN' : 'AD')]++;
    }

    const valorCentavos = Math.round(
      Object.keys(cont).reduce((s, k) => s + (cont[k] * tabela.valores[k]) / 60, 0)
    );
    return {
      mins,
      minDiurno: cont.AD + cont.VD,
      minNoturno: cont.AN + cont.VN,
      minVermelha: cont.VD + cont.VN,
      valorCentavos,
      tabela,
    };
  }

  const escalasOrdenadas = () =>
    [...escalas].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));

  /* --------------------------------------------------------------- ações */
  function validarFormulario() {
    const inicio = $('escalaInicio').value;
    const fim = $('escalaFim').value;
    let ok = true;

    const marca = (fieldId, invalido) => {
      $(fieldId).classList.toggle('invalid', invalido);
      if (invalido) ok = false;
    };
    marca('fieldInicio', !inicio);
    marca('fieldFim', !fim || (inicio && new Date(fim) <= new Date(inicio)));

    const duracaoHoras = inicio && fim ? (new Date(fim) - new Date(inicio)) / 3600000 : 0;
    if (ok && duracaoHoras > 24 &&
        !confirm(`A escala tem ${duracaoHoras.toFixed(1)} horas de duração. Confirma?`)) {
      ok = false;
    }
    const campoDesc = $('escalaDescricao');
    const descricao = (campoDesc && campoDesc.value.trim()) || 'Escala AC4';
    return ok ? { inicio, fim, descricao } : null;
  }

  function submeterFormulario() {
    const dados = validarFormulario();
    if (!dados) return;
    const tabelaAtual = validarTabelaAtual();
    if (!tabelaAtual) return;

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
    ['fieldInicio', 'fieldFim'].forEach((f) => $(f).classList.remove('invalid'));
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
    const lista = escalasOrdenadas();
    const resultados = lista.map((e) => ({ e, r: calcularEscala(e) }));

    // métricas
    const totMins = resultados.reduce((s, x) => s + x.r.mins, 0);
    const totDiurno = resultados.reduce((s, x) => s + x.r.minDiurno, 0);
    const totNoturno = resultados.reduce((s, x) => s + x.r.minNoturno, 0);
    const totValor = resultados.reduce((s, x) => s + x.r.valorCentavos, 0);

    $('totHoras').textContent = fmtHoras(totMins);
    $('totDiurnas').textContent = fmtHoras(totDiurno);
    $('totNoturnas').textContent = fmtHoras(totNoturno);
    $('pctDiurnas').textContent = totMins ? `${((totDiurno / totMins) * 100).toFixed(1).replace('.', ',')}% do total` : '0% do total';
    $('pctNoturnas').textContent = totMins ? `${((totNoturno / totMins) * 100).toFixed(1).replace('.', ',')}% do total` : '0% do total';
    $('totQtd').textContent = `${lista.length} escala${lista.length === 1 ? '' : 's'} no período`;
    $('totValor').textContent = fmtMoeda(totValor);
    $('mobileTotal').textContent = fmtMoeda(totValor);

    // botões dependentes de dados
    const temDados = lista.length > 0;
    $('btnClearAll').classList.toggle('hidden', escalas.length === 0);

    // lista
    const container = $('listaEscalas');
    if (!temDados) {
      container.innerHTML = `
        <div class="empty-state">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>
          </svg>
          <h3>Nenhuma escala lançada</h3>
          <p>Preencha o formulário acima para iniciar o cálculo.</p>
        </div>`;
      $('printDate').textContent = new Date().toLocaleString('pt-BR');
      return;
    }

    let html = `
      <div class="table-wrap">
        <table class="escala-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Início</th>
              <th>Término</th>
              <th>Tipo</th>
              <th>Horas</th>
              <th>Valor</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>`;
    resultados.forEach(({ e, r }) => {
      const tipoChips = [];
      if (r.minVermelha > 0) tipoChips.push('<span class="chip chip-red">Vermelha</span>');
      if (r.minVermelha < r.mins) tipoChips.push('<span class="chip chip-blue">Azul</span>');
      tipoChips.push(r.minNoturno > 0
        ? `<span class="chip chip-night">${fmtHoras(r.minNoturno)} noturno</span>`
        : '<span class="chip chip-day">Diurno</span>');

      html += `
        <tr>
          <td data-label="Data">
            ${fmtData(e.inicio)}
            <span class="table-note">${escapeHTML(e.descricao)}</span>
          </td>
          <td data-label="Início">${fmtHora(e.inicio)}</td>
          <td data-label="Término">${fmtData(e.inicio) === fmtData(e.fim) ? fmtHora(e.fim) : `${fmtData(e.fim)} ${fmtHora(e.fim)}`}</td>
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
  }

  /* ------------------------------------------------------- exportações */
  function exportarICS() {
    const lista = escalasOrdenadas();
    if (!lista.length) {
      toast('Adicione escalas antes de gerar o arquivo .ics.', { erro: true });
      return;
    }
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
    toast('Arquivo gerado. Na Agenda Google, use "Importar" para adicionar as escalas.');
  }

  function exportarCSV() {
    const lista = escalasOrdenadas();
    if (!lista.length) {
      toast('Adicione escalas antes de exportar CSV.', { erro: true });
      return;
    }
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

  /* --------------------------------------------------------------- init */
  function init() {
    initTema();
    carregar();

    // valores padrão do formulário
    const agora = new Date();
    $('escalaInicio').value = toInputLocal(agora);
    $('escalaFim').value = toInputLocal(new Date(agora.getTime() + 8 * 3600000));

    // eventos
    on('formEscala', 'submit', (ev) => { ev.preventDefault(); submeterFormulario(); });
    on('btnCancelEdit', 'click', cancelarEdicao);
    on('btnTheme', 'click', () =>
      aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    on('btnPrint', 'click', () => window.print());
    on('btnExportIcs', 'click', exportarICS);
    on('btnExportCsv', 'click', exportarCSV);
    on('btnClearAll', 'click', limparTudo);
    on('mobileAdd', 'click', () => {
      const painel = document.querySelector('.launch-panel');
      if (painel) painel.scrollIntoView({ behavior: 'smooth' });
      $('escalaInicio').focus();
    });

    // início automático do término: +8h quando o início muda
    on('escalaInicio', 'change', () => {
      const v = $('escalaInicio').value;
      if (v) $('escalaFim').value = toInputLocal(new Date(new Date(v).getTime() + 8 * 3600000));
    });

    // ações delegadas da lista
    on('listaEscalas', 'click', (ev) => {
      const btn = ev.target.closest('[data-acao]');
      if (!btn) return;
      const id = parseFloat(btn.dataset.id);
      if (btn.dataset.acao === 'remover') removerEscala(id);
      else if (btn.dataset.acao === 'editar') editarEscala(id);
      else if (btn.dataset.acao === 'duplicar') duplicarEscala(id);
    });

    render();

    // PWA
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
