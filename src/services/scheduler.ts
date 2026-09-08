import { MODULES } from './modules';
import { SettingsService } from './settingsService';
import { WorklabCollector } from './worklabCollector';

// Agendador de captura multi-intervalo.
// Cada modulo pode ter uma frequencia propria (configurada em settings).
export class Scheduler {
  private static lastRun = new Map<string, number>();
  private static timer: NodeJS.Timeout | null = null;

  static start(): void {
    if (this.timer) return;

    // Inicializa o "ultimo run" de todos os modulos para evitar uma rajada
    // de sincronizacoes simultaneas logo apos o servidor subir.
    const now = Date.now();
    for (const module of MODULES) {
      this.lastRun.set(module.key, now);
    }

    // Varredura a cada 20 segundos; dispara modulos que estao "atrasados".
    this.timer = setInterval(() => {
      if (!SettingsService.isCollectorEnabled()) return;

      const nowTick = Date.now();

      for (const module of MODULES) {
        const intervalMin = SettingsService.getModuleInterval(module.key, module.defaultIntervalMin);
        if (intervalMin <= 0) continue; // somente sob demanda

        const last = this.lastRun.get(module.key) || 0;
        if (nowTick - last < intervalMin * 60 * 1000) continue;

        this.lastRun.set(module.key, nowTick);
        WorklabCollector.syncModule(module.key).catch((err) => {
          console.error(`[scheduler] Falha ao sincronizar ${module.key}:`, err.message);
        });
      }
    }, 20000);
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Dispara um modulo imediatamente (usado pelo botao do frontend).
  static async triggerNow(key: string) {
    this.lastRun.set(key, Date.now());
    return await WorklabCollector.syncModule(key);
  }
}
