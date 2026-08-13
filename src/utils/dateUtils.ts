/**
  * Utilitário para manipulação e padronização de datas no fuso horário de Recife/Brasil (America/Recife - UTC-3).
  */

export const RECIFE_TIMEZONE = 'America/Recife';

/**
 * Retorna a data/hora atual formatada em string SQL (YYYY-MM-DD HH:mm:ss) no fuso de Recife.
 */
export function getRecifeSqlTimestamp(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: RECIFE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(date).replace('T', ' ');
}

/**
 * Retorna a data/hora em ISO 8601 no fuso de Recife.
 */
export function getRecifeIsoString(date: Date = new Date()): string {
  return new Date(date.toLocaleString('en-US', { timeZone: RECIFE_TIMEZONE })).toISOString();
}

/**
 * Formata qualquer data/string para exibição amigável em Português no fuso de Recife.
 */
export function formatRecifeDisplay(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '-';
  try {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return String(dateInput);

    return d.toLocaleString('pt-BR', {
      timeZone: RECIFE_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (err) {
    return String(dateInput);
  }
}
