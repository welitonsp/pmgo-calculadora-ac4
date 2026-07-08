/* ==========================================================================
   Calculadora AC4 — módulo de formatação e datas locais
   Funções puras, sem acesso ao DOM. Datas sempre tratadas no fuso local
   (getters locais), nunca via toISOString/getTimezoneOffset.
   ========================================================================== */

const moedaBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoeda = (cent) => moedaBRL.format(cent / 100);

export const fmtHoras = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
};
export const fmtHorasCheias = (mins) => `${Math.round(mins / 60)}h`;

export const fmtDataHora = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const fmtData = (iso) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const fmtDiaSemana = (iso) => {
  const n = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long' });
  return n[0].toUpperCase() + n.slice(1);
};

export const fmtHora = (iso) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const dataLocalValida = (date) =>
  date instanceof Date && Number.isFinite(date.getTime());

export function combinarDataHoraLocal(data, hora) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '') || !/^\d{2}:\d{2}$/.test(hora || '')) return null;
  const [ano, mes, dia] = data.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  const d = new Date(ano, mes - 1, dia, h, min, 0, 0);
  return dataLocalValida(d) &&
    d.getFullYear() === ano &&
    d.getMonth() === mes - 1 &&
    d.getDate() === dia &&
    d.getHours() === h &&
    d.getMinutes() === min
    ? d
    : null;
}

export function parseDateTimeLocal(valor) {
  if (!valor) return null;
  const [data, horaComSegundos = ''] = String(valor).split('T');
  const hora = horaComSegundos.slice(0, 5);
  return combinarDataHoraLocal(data, hora);
}

export const formatarDataHoraInput = (date) =>
  dataLocalValida(date)
    ? [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-') + `T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : '';

export const toInputLocal = formatarDataHoraInput;

export const adicionarHoras = (date, horas) =>
  dataLocalValida(date) && Number.isFinite(Number(horas))
    ? new Date(date.getTime() + Number(horas) * 3600000)
    : null;

export const calcularTerminoPorDuracao = (inicioValor, horas) => {
  const inicio = parseDateTimeLocal(inicioValor);
  const fim = adicionarHoras(inicio, horas);
  return fim ? formatarDataHoraInput(fim) : '';
};

/* Teto de duração: 192h é o limite de horas que o policial pode fazer.
   Também protege contra typo no ano do término (ex.: 2036 em vez de 2026),
   que criaria uma escala de milhões de minutos e travaria o cálculo
   minuto a minuto em todo carregamento. */
export const DURACAO_MAX_HORAS = 192;

export function validarIntervaloEscala(inicioValor, fimValor) {
  const inicio = parseDateTimeLocal(inicioValor);
  const fim = parseDateTimeLocal(fimValor);
  if (!inicioValor || !inicio) return { ok: false, campo: 'inicio', mensagem: 'Informe a data e hora de início da escala.' };
  if (!fimValor || !fim) return { ok: false, campo: 'fim', mensagem: 'Informe a data e hora de término da escala.' };
  if (fim <= inicio) return { ok: false, campo: 'fim', mensagem: 'O término da escala deve ser posterior ao início.' };
  if (fim - inicio > DURACAO_MAX_HORAS * 3600000) {
    return { ok: false, campo: 'fim', mensagem: `A duração máxima é de ${DURACAO_MAX_HORAS}h (limite de horas do policial). Confira a data e o ano do término.` };
  }
  return { ok: true, inicio, fim, mensagem: '' };
}

export const toInputMonth = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const fmtMesRef = (yyyymm) => {
  if (!yyyymm) return '';
  const [ano, mes] = yyyymm.split('-');
  const label = new Date(+ano, +mes - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label[0].toUpperCase() + label.slice(1);
};

export const escapeHTML = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
