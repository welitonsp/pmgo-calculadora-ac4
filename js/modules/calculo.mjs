/* ==========================================================================
   Calculadora AC4 — módulo de regras de negócio
   Regras (Portaria SSP nº 621/2026):
   - Vermelha: dia operacional do minuto é sex/sáb/dom.
   - Noturno: [22:00, 05:00) minuto a minuto.
   - Minutos entre 00:00 e 04:59 usam o dia operacional anterior.
   Funções puras, sem acesso ao DOM.
   ========================================================================== */
import { parseDateTimeLocal } from './formato.mjs';

export const PORTARIA_ATUAL = 'Portaria SSP nº 621/2026';
export const VALORES_OFICIAIS = { valAD: '30', valAN: '33', valVD: '40', valVN: '45' };

/* Tabela oficial em centavos por hora — fallback quando nenhuma tabela
   vigente é injetada (testes, contexto sem DOM). */
export const TABELA_OFICIAL = Object.freeze({
  portaria: PORTARIA_ATUAL,
  valores: Object.freeze({ AD: 3000, AN: 3300, VD: 4000, VN: 4500 }),
});

/**
 * @typedef {Object} Tabela Tabela de tarifas em centavos por hora.
 * @property {string} portaria Norma de referência.
 * @property {{AD:number, AN:number, VD:number, VN:number}} valores Centavos/hora por categoria.
 */
/**
 * @typedef {Object} Escala Lançamento a calcular.
 * @property {string} inicio Início no formato `datetime-local` (`YYYY-MM-DDTHH:mm`).
 * @property {string} fim    Término no mesmo formato.
 * @property {Tabela} [tabela] Tabela congelada no lançamento (preserva histórico).
 */
/**
 * @typedef {Object} ResultadoEscala
 * @property {number} mins Total de minutos da escala.
 * @property {{AD:number, AN:number, VD:number, VN:number}} cont Minutos por categoria.
 * @property {number} minDiurno Minutos diurnos (AD+VD).
 * @property {number} minNoturno Minutos noturnos (AN+VN).
 * @property {number} minVermelha Minutos em dia vermelho (VD+VN).
 * @property {number} valorCentavos Valor total por PM, em centavos.
 * @property {Tabela} tabela Tabela efetivamente usada no cálculo.
 */

/**
 * Valida se uma tabela tem as quatro tarifas finitas e positivas.
 * @param {Tabela} t
 * @returns {boolean}
 */
export const tabelaEscalaValida = (t) =>
  t && t.valores && ['AD', 'AN', 'VD', 'VN'].every((k) => Number.isFinite(t.valores[k]) && t.valores[k] > 0);

function diaReferenciaOperacional(data, minutoDoDia, noturno) {
  const ref = new Date(data);
  if (noturno && minutoDoDia < 5 * 60) ref.setDate(ref.getDate() - 1);
  return ref.getDay();
}

/**
 * Calcula minutos por categoria (AD/AN/VD/VN) e o valor de uma escala,
 * classificando minuto a minuto conforme a Portaria SSP nº 621/2026.
 * Usa a tabela congelada no lançamento (`e.tabela`) quando válida — preserva o
 * histórico se a Portaria mudar; caso contrário usa a tabela vigente.
 * @param {Escala} e
 * @param {Tabela} [tabelaVigente] Tabela usada quando `e.tabela` é inválida.
 * @returns {ResultadoEscala}
 */
export function calcularEscala(e, tabelaVigente = TABELA_OFICIAL) {
  const ini = parseDateTimeLocal(e.inicio) || new Date(e.inicio);
  const fim = parseDateTimeLocal(e.fim) || new Date(e.fim);
  const mins = Math.max(1, Math.round((fim - ini) / 60000));
  const cont = { AD: 0, AN: 0, VD: 0, VN: 0 };
  const tabela = tabelaEscalaValida(e.tabela) ? e.tabela : tabelaVigente;

  /* Classificação minuto a minuto — Goiás não tem horário de verão, então não
     há saltos de relógio no intervalo. A madrugada até 04:59 pertence ao dia
     operacional anterior para preservar a faixa noturna iniciada às 22h. */
  for (let i = 0; i < mins; i++) {
    const atual = new Date(ini.getTime() + i * 60000);
    const td = atual.getHours() * 60 + atual.getMinutes();
    const noturno = td >= 22 * 60 || td < 5 * 60;
    const vermelha = [5, 6, 0].includes(diaReferenciaOperacional(atual, td, noturno));
    cont[vermelha ? (noturno ? 'VN' : 'VD') : (noturno ? 'AN' : 'AD')]++;
  }

  const centavosMinuto = Object.keys(cont).reduce((s, k) => s + cont[k] * tabela.valores[k], 0);
  return {
    mins, cont,
    minDiurno: cont.AD + cont.VD,
    minNoturno: cont.AN + cont.VN,
    minVermelha: cont.VD + cont.VN,
    valorCentavos: Math.round(centavosMinuto / 60),
    tabela,
  };
}

/**
 * Mapeia o código de origem do remunerado para um rótulo legível.
 * @param {string} v Código (ex.: `'AC4'`, `'CONVENIO_ENEM'`).
 * @returns {string} Rótulo amigável; `'AC4'` como padrão.
 */
export function labelOrigem(v) {
  return {
    AC4: 'AC4', AGETOP: 'AGETOP', DETRAN: 'DETRAN', PREFEITURAS: 'Prefeituras',
    GOINFRA: 'GOINFRA', FREAP: 'FREAP', CONVENIO_ENEM: 'Conv. ENEM',
    CONVENIO_TRE: 'Conv. TRE', CONVENIO_UEG: 'Conv. UEG',
    CONVENIO_SEDUC: 'Conv. SEDUC', CONVENIO_SAMU: 'Conv. SAMU',
    CONVENIO_AGR: 'Conv. AGR', FAZENDARIO_SEC_ECON: 'Faz./Sec. Econ.', GEAI: 'GEAI',
  }[v] || v || 'AC4';
}
