/* ==========================================================================
   Calculadora AC4 — módulo de agenda (iCalendar / Google Agenda)
   Geração e validação de arquivos .ics (RFC 5545) e links diretos para o
   Google Calendar. Funções puras, sem acesso ao DOM.
   ========================================================================== */
import {
  fmtDataHora, fmtMoeda, fmtHoras,
  parseDateTimeLocal, dataLocalValida,
} from './formato.mjs';
import { calcularEscala, TABELA_OFICIAL } from './calculo.mjs';

export const ICS_DOMAIN = 'calculadora-ac4-pmgo.github.io';
export const ICS_PRODID = '-//Calculadora AC4//PT-BR';

export const contarOctetos = (s) => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length;
};

export function dobrarLinhaICS(linha) {
  const partes = [];
  let atual = '';
  Array.from(String(linha)).forEach((char) => {
    const tentativa = atual + char;
    if (atual && contarOctetos(tentativa) > 75) { partes.push(atual); atual = ` ${char}`; }
    else atual = tentativa;
  });
  if (atual || !partes.length) partes.push(atual);
  return partes.join('\r\n');
}

export const escaparTextoICS = (v) =>
  String(v || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');

export function dataICS(valor) {
  const d = new Date(valor);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function hashCurto(valor) {
  let hash = 0x811c9dc5;
  Array.from(String(valor)).forEach((c) => { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 0x01000193); });
  return (hash >>> 0).toString(36);
}

export function uidEscalaICS(e) {
  const origem = e.id != null && e.id !== '' ? String(e.id) : hashCurto(`${e.inicio}|${e.fim}|${e.descricao || ''}`);
  const seguro = origem.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  return `ac4-${seguro || hashCurto(origem)}@${ICS_DOMAIN}`;
}

export const escalaAgendaValida = (e) => {
  const i = parseDateTimeLocal(e.inicio), f = parseDateTimeLocal(e.fim);
  return dataLocalValida(i) && dataLocalValida(f) && f > i;
};

/**
 * Monta um arquivo iCalendar (RFC 5545) com um VEVENT por escala válida.
 * @param {Array<Object>} lista Escalas a exportar.
 * @param {Object} [tabelaVigente] Tabela usada no cálculo do valor no evento.
 * @returns {{conteudo:string, eventos:number, ignoradas:number}}
 *   `conteudo` é o `.ics` pronto; `ignoradas` conta escalas inválidas puladas.
 */
export function montarICS(lista, tabelaVigente = TABELA_OFICIAL) {
  const dtstamp = dataICS(new Date());
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${ICS_PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  let eventos = 0, ignoradas = 0;
  lista.forEach((e) => {
    if (!escalaAgendaValida(e)) { ignoradas++; return; }
    const r = calcularEscala(e, tabelaVigente);
    const qtd = e.qtdPm || 1;
    const descricao = [
      'Escala AC4',
      e.descricao && e.descricao !== 'Escala AC4' ? `Unidade: ${e.descricao}` : '',
      `Origem: ${e.origem || 'AC4'}`,
      `Início: ${fmtDataHora(e.inicio)}`,
      `Término: ${fmtDataHora(e.fim)}`,
      qtd > 1 ? `PMs: ${qtd}` : '',
      `Valor estimado: ${fmtMoeda(r.valorCentavos * qtd)}`,
      'Valor simulado, sujeito à conferência administrativa.',
    ].filter(Boolean).join('\n');
    linhas.push('BEGIN:VEVENT', `UID:${uidEscalaICS(e)}`, `DTSTAMP:${dtstamp}`,
      `DTSTART:${dataICS(e.inicio)}`, `DTEND:${dataICS(e.fim)}`,
      `SUMMARY:${escaparTextoICS(e.descricao || 'Escala AC4')}`,
      `DESCRIPTION:${escaparTextoICS(descricao)}`,
      'TRANSP:OPAQUE', 'STATUS:CONFIRMED', 'END:VEVENT');
    eventos++;
  });
  linhas.push('END:VCALENDAR');
  return { conteudo: linhas.map(dobrarLinhaICS).join('\r\n'), eventos, ignoradas };
}

export function desdobrarLinhasICS(conteudo) {
  return conteudo.split('\r\n').reduce((acc, linha) => {
    if (/^[ \t]/.test(linha) && acc.length) acc[acc.length - 1] += linha.slice(1);
    else acc.push(linha);
    return acc;
  }, []);
}

export function parseDataICS(v) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Valida a estrutura iCalendar gerada a partir de uma lista de escalas
 * (CRLF, dobra de 75 octetos, cabeçalhos e campos obrigatórios de cada VEVENT).
 * @param {Array<Object>} lista
 * @param {Object} [tabelaVigente]
 * @returns {{ok:boolean, eventos:number, ignoradas:number, falhas:string[]}}
 */
export function validarICS(lista, tabelaVigente = TABELA_OFICIAL) {
  const arquivo = montarICS(lista, tabelaVigente);
  const falhas = [];
  const c = arquivo.conteudo;
  if (!c.startsWith('BEGIN:VCALENDAR')) falhas.push('Não inicia com BEGIN:VCALENDAR.');
  if (!c.endsWith('END:VCALENDAR'))   falhas.push('Não encerra com END:VCALENDAR.');
  if (!c.includes('\r\n'))            falhas.push('Sem quebras CRLF.');
  c.split('\r\n').forEach((l, i) => { if (contarOctetos(l) > 75) falhas.push(`Linha ${i+1} excede 75 octetos.`); });
  const linhas = desdobrarLinhasICS(c);
  ['VERSION:2.0', `PRODID:${ICS_PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
    .forEach((item) => { if (!linhas.includes(item)) falhas.push(`Ausente: ${item}`); });
  const eventos = []; let atual = null;
  linhas.forEach((l) => {
    if (l === 'BEGIN:VEVENT') atual = [];
    else if (l === 'END:VEVENT') { if (atual) eventos.push(atual); atual = null; }
    else if (atual) atual.push(l);
  });
  eventos.forEach((ev, i) => {
    const obter = (campo) => ev.find((l) => l.startsWith(`${campo}:`));
    ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY'].forEach((campo) => { if (!obter(campo)) falhas.push(`VEVENT ${i+1} sem ${campo}.`); });
    const ini = parseDataICS((obter('DTSTART') || '').slice('DTSTART:'.length));
    const fim = parseDataICS((obter('DTEND') || '').slice('DTEND:'.length));
    if (ini && fim && fim <= ini) falhas.push(`VEVENT ${i+1}: DTEND ≤ DTSTART.`);
  });
  return { ok: falhas.length === 0, eventos: eventos.length, ignoradas: arquivo.ignoradas, falhas };
}

/* Título e corpo do evento — compartilhados pelos links de agenda web. */
function detalhesEventoAgenda(e, tabelaVigente) {
  const r = calcularEscala(e, tabelaVigente);
  const qtd = e.qtdPm || 1;
  const tipo = r.minVermelha > 0 ? 'Vermelha' : 'Azul';
  const linhas = [
    `Servico Extra AC4 — Escala ${tipo}`,
    '',
    e.descricao && e.descricao !== 'Escala AC4' ? `Unidade: ${e.descricao}` : null,
    `Origem: ${e.origem || 'AC4'}`,
    '',
    `Duracao: ${fmtHoras(r.mins)}`,
    `Horas diurnas: ${fmtHoras(r.minDiurno)}`,
    `Horas noturnas: ${fmtHoras(r.minNoturno)}`,
  ].filter((l) => l !== null);
  if (qtd > 1) linhas.push(`Qtd. PM: ${qtd}`);
  linhas.push('', `Valor estimado: ${fmtMoeda(r.valorCentavos * qtd)}`);
  if (qtd > 1) linhas.push(`(${fmtMoeda(r.valorCentavos)}/PM)`);
  linhas.push('', 'Valor simulado — sujeito a validacao administrativa.', 'Calculadora AC4 · PMGO');
  return { titulo: e.descricao || `Servico Extra AC4 — ${tipo}`, corpo: linhas.join('\n') };
}

/**
 * Monta a URL de link direto para o Google Calendar (1 evento por link).
 * Datas convertidas para UTC via `dataICS()` — fuso tratado corretamente.
 * @param {Object} e Escala.
 * @param {Object} [tabelaVigente]
 * @returns {string} URL `calendar.google.com/render?...` com o evento pronto.
 */
export function gerarLinkGoogleAgenda(e, tabelaVigente = TABELA_OFICIAL) {
  const { titulo, corpo } = detalhesEventoAgenda(e, tabelaVigente);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: titulo,
    dates: `${dataICS(e.inicio)}/${dataICS(e.fim)}`,
    details: corpo,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Monta a URL de link direto para o Outlook (1 evento por link).
 * @param {Object} e Escala.
 * @param {Object} [tabelaVigente]
 * @param {boolean} [corporativo] `true` usa o Outlook do Microsoft 365 (conta
 *   de trabalho, outlook.office.com); `false` usa o Outlook.com pessoal.
 * @returns {string} URL `.../calendar/action/compose?...` com o evento pronto.
 */
export function gerarLinkOutlookAgenda(e, tabelaVigente = TABELA_OFICIAL, corporativo = false) {
  const { titulo, corpo } = detalhesEventoAgenda(e, tabelaVigente);
  const iso = (v) => {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString() : '';
  };
  const params = new URLSearchParams({
    rru: 'addevent',
    startdt: iso(e.inicio),
    enddt: iso(e.fim),
    subject: titulo,
    body: corpo,
  });
  const base = corporativo ? 'https://outlook.office.com' : 'https://outlook.live.com';
  return `${base}/calendar/action/compose?${params.toString()}`;
}
