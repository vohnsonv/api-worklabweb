import db from '../db/database';
import { ENV } from '../config/env';

// Chaves de configuracao persistidas na tabela `settings`.
// Cada chave tem um valor padrao derivado das variaveis de ambiente (.env).
const DEFAULTS: Record<string, string> = {
  worklab_url: ENV.WORKLAB_URL,
  worklab_client_id: ENV.WORKLAB_ID.split('/')[0] || '',
  worklab_user: ENV.WORKLAB_ID.split('/')[1] || '',
  worklab_password: ENV.WORKLAB_PASSWORD,
  api_key: ENV.API_KEY,
  sync_interval_minutes: String(ENV.SYNC_INTERVAL_MINUTES),
  sync_window_months: '5'
};

export class SettingsService {
  // Retorna o valor de uma chave (DB tem prioridade sobre o .env)
  static get(key: string): string {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    if (row && row.value !== null && row.value !== undefined) {
      return row.value;
    }
    return DEFAULTS[key] ?? '';
  }

  static getNumber(key: string, fallback: number): number {
    const value = parseInt(this.get(key), 10);
    return isNaN(value) ? fallback : value;
  }

  static getAll(): Record<string, string> {
    const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
    const result: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // Persiste um conjunto de chaves (usado pelo PUT /settings)
  static setMany(entries: Record<string, string>): void {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const tx = db.transaction((items: [string, string][]) => {
      for (const [key, value] of items) {
        stmt.run(key, String(value ?? ''));
      }
    });
    tx(Object.entries(entries));
  }

  // Nome de usuario composto no formato usado pelo formulario de login legado
  static getWorklabUsername(): string {
    const clientId = this.get('worklab_client_id');
    const user = this.get('worklab_user');
    if (!user) return clientId;
    return `${clientId}/${user}`;
  }

  // Intervalo (em minutos) de um modulo de captura especifico.
  // 0 = apenas sob demanda (sem agendamento automatico).
  static getModuleInterval(moduleKey: string, defaultMinutes: number): number {
    const value = parseInt(this.get(`module.${moduleKey}.interval_minutes`), 10);
    return isNaN(value) ? defaultMinutes : value;
  }

  // Estado do coletor (ligado/desligado). Padrao: ligado.
  static isCollectorEnabled(): boolean {
    return this.get('collector_enabled') !== '0';
  }

  static setCollectorEnabled(enabled: boolean): void {
    this.setMany({ collector_enabled: enabled ? '1' : '0' });
  }
}
