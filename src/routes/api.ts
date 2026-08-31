import { Router, Request, Response } from 'express';
import db from '../db/database';
import { MODULES, buildCaptureDetail } from '../services/modules';
import { SettingsService } from '../services/settingsService';
import { Scheduler } from '../services/scheduler';
import { WorklabCollector } from '../services/worklabCollector';
import { WebhookDispatcher } from '../services/webhookDispatcher';

const router = Router();

// ---------------------------------------------------------------------------
// Protecao por API key (header x-api-key, Bearer ou query ?key= para links CSV)
// ---------------------------------------------------------------------------
router.use((req: Request, res: Response, next: () => void) => {
  const expected = SettingsService.get('api_key');
  if (!expected) {
    return next();
  }

  const headerKey = String(req.get('x-api-key') || '').trim();
  const authHeader = String(req.get('authorization') || '');
  const bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const queryKey = String(req.query.key || '').trim();

  const provided = headerKey || bearerKey || queryKey;
  if (provided === expected) {
    return next();
  }

  return res.status(401).json({ success: false, error: 'API key inválida ou ausente.' });
});

// Chaves permitidas no PUT /settings (evita gravar chaves invalidas).
const SETTINGS_KEYS = new Set([
  'worklab_url',
  'worklab_client_id',
  'worklab_user',
  'worklab_password',
  'api_key',
  'sync_interval_minutes',
  'sync_window_months'
]);

// ---------------------------------------------------------------------------
// Estatisticas e visao geral
// ---------------------------------------------------------------------------

router.get('/stats', (req: Request, res: Response) => {
  try {
    const totalAtendimentos = (db.prepare('SELECT COUNT(*) as c FROM atendimentos').get() as any).c;
    const totalExames = (db.prepare('SELECT COUNT(*) as c FROM exames').get() as any).c;
    const webhooksAtivos = (db.prepare('SELECT COUNT(*) as c FROM webhooks WHERE active = 1').get() as any).c;
    const totalFaturado = (db.prepare('SELECT SUM(valor_final) as total FROM atendimentos').get() as any).total || 0;

    const totalWebhookLogs = (db.prepare('SELECT COUNT(*) as c FROM webhook_logs').get() as any).c;
    const successWebhookLogs = (db.prepare('SELECT COUNT(*) as c FROM webhook_logs WHERE success = 1').get() as any).c;
    const taxaSucessoWebhook = totalWebhookLogs > 0 ? Math.round((successWebhookLogs / totalWebhookLogs) * 100) : 100;

    const ultimaSync = db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1').get() as any;

    // Contagem por modulo capturado
    const moduleCounts = db.prepare('SELECT module, COUNT(*) as c FROM capture_records GROUP BY module').all() as any[];

    res.json({
      success: true,
      stats: {
        totalAtendimentos,
        totalExames,
        webhooksAtivos,
        taxaSucessoWebhook,
        totalFaturado,
        ultimaSync: ultimaSync || null,
        moduleCounts
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lista o catalogo de modulos com a configuracao atual de intervalo.
router.get('/modules', (req: Request, res: Response) => {
  try {
    const modules = MODULES.map((m) => ({
      ...m,
      intervalMin: SettingsService.getModuleInterval(m.key, m.defaultIntervalMin),
      detail: buildCaptureDetail(m)
    }));
    res.json({ success: true, data: modules });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Configuracoes
// ---------------------------------------------------------------------------

router.get('/settings', (req: Request, res: Response) => {
  try {
    const all = SettingsService.getAll();
    // Nunca expor a senha em texto puro para o frontend
    const safe = { ...all };
    if (safe.worklab_password) safe.worklab_password = '********';
    res.json({ success: true, data: safe });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/settings', (req: Request, res: Response) => {
  try {
    const entries: Record<string, string> = {};

    for (const [key, value] of Object.entries(req.body || {})) {
      if (SETTINGS_KEYS.has(key) || key.startsWith('module.')) {
        entries[key] = String(value);
      }
    }

    // Senha mascarada nao deve sobrescrever a senha real
    if (entries.worklab_password === '********') {
      delete entries.worklab_password;
    }

    SettingsService.setMany(entries);
    res.json({ success: true, message: 'Configuracoes salvas com sucesso.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Coletor (ligar/desligar)
// ---------------------------------------------------------------------------

router.get('/collector/status', (req: Request, res: Response) => {
  try {
    res.json({ success: true, enabled: SettingsService.isCollectorEnabled() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/collector/toggle', (req: Request, res: Response) => {
  try {
    const next = !SettingsService.isCollectorEnabled();
    SettingsService.setCollectorEnabled(next);
    res.json({ success: true, enabled: next });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Atendimentos e exames
// ---------------------------------------------------------------------------

router.get('/atendimentos', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const search = req.query.search as string;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM atendimentos WHERE 1=1';
    const params: any[] = [];

    if (search) {
      query += ' AND (paciente_nome LIKE ? OR protocolo LIKE ? OR worklab_id LIKE ? OR cpf LIKE ? OR atendente LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const atendimentos = db.prepare(query).all(...params) as any[];

    for (const item of atendimentos) {
      item.exames = db.prepare('SELECT * FROM exames WHERE atendimento_id = ?').all(item.id);
    }

    const countQuery = search
      ? 'SELECT COUNT(*) as total FROM atendimentos WHERE paciente_nome LIKE ? OR protocolo LIKE ? OR worklab_id LIKE ? OR cpf LIKE ? OR atendente LIKE ?'
      : 'SELECT COUNT(*) as total FROM atendimentos';
    const countParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [];
    const total = (db.prepare(countQuery).get(...countParams) as any).total;

    res.json({
      success: true,
      data: atendimentos,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/atendimentos/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const atendimento = db.prepare('SELECT * FROM atendimentos WHERE id = ? OR worklab_id = ?').get(id, id) as any;
    if (!atendimento) {
      return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
    }

    const exames = db.prepare('SELECT * FROM exames WHERE atendimento_id = ?').all(atendimento.id);

    res.json({ success: true, data: { ...atendimento, exames } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/exames', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const search = req.query.search as string;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.*, a.paciente_nome, a.protocolo
      FROM exames e
      LEFT JOIN atendimentos a ON e.atendimento_id = a.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (search) {
      query += ' AND (e.nome_exame LIKE ? OR e.codigo_exame LIKE ? OR a.paciente_nome LIKE ? OR a.protocolo LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY e.id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const exames = db.prepare(query).all(...params);
    const total = (db.prepare('SELECT COUNT(*) as total FROM exames').get() as any).total;

    res.json({ success: true, data: exames, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Dados capturados por modulo (tabela generica capture_records)
// ---------------------------------------------------------------------------

router.get('/data/:module', (req: Request, res: Response) => {
  try {
    const { module } = req.params;
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '50', 10);
    const offset = (page - 1) * limit;

    const total = (db.prepare('SELECT COUNT(*) as c FROM capture_records WHERE module = ?').get(module) as any).c;
    const rows = db.prepare('SELECT id, record_id, payload, synced_at FROM capture_records WHERE module = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(module, limit, offset) as any[];

    const data = rows.map((r) => {
      let parsed: any = {};
      try {
        parsed = JSON.parse(r.payload);
      } catch {
        parsed = { raw: r.payload };
      }
      return { record_id: r.record_id, synced_at: r.synced_at, ...parsed };
    });

    res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sync/module/:key', async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key);
    Scheduler.triggerNow(key).catch((err) => console.error(`[api] sync ${key} falhou:`, err.message));
    res.json({ success: true, message: `Sincronização do módulo "${key}" iniciada.` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Exportacao CSV de um modulo
// ---------------------------------------------------------------------------

router.get('/export/:module.csv', (req: Request, res: Response) => {
  try {
    const { module } = req.params;
    const rows = db.prepare('SELECT record_id, payload FROM capture_records WHERE module = ? ORDER BY id DESC').all(module) as any[];

    const parsed = rows.map((r) => {
      try {
        return JSON.parse(r.payload);
      } catch {
        return { raw: r.payload };
      }
    });

    if (parsed.length === 0) {
      return res.status(404).json({ success: false, error: 'Sem registros para exportar.' });
    }

    const headers = Array.from(new Set(parsed.flatMap((p) => Object.keys(p))));
    const escape = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csv = [headers.map(escape).join(',')]
      .concat(parsed.map((p) => headers.map((h) => escape(p[h])).join(',')))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${module}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

router.get('/webhooks', (req: Request, res: Response) => {
  try {
    const webhooks = db.prepare('SELECT * FROM webhooks ORDER BY id DESC').all();
    res.json({ success: true, data: webhooks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/webhooks', (req: Request, res: Response) => {
  try {
    const { url, description, secret, events } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'A URL do Webhook é obrigatória' });

    const secretKey = secret || 'whsec_' + Math.random().toString(36).substring(2, 15);
    const eventList = events || 'novo_atendimento';

    const result = db.prepare('INSERT INTO webhooks (url, description, secret, events, active) VALUES (?, ?, ?, ?, 1)').run(url, description || '', secretKey, eventList);

    const created = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/webhooks/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
    res.json({ success: true, message: 'Webhook removido com sucesso' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/webhooks/:id/test', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as any;
    if (!webhook) return res.status(404).json({ success: false, error: 'Webhook não encontrado' });

    const testPayload = {
      event: 'test_ping',
      timestamp: new Date().toISOString(),
      data: { message: 'Teste de conectividade', status: 'OK' }
    };

    const success = await WebhookDispatcher.sendSingleWebhook(webhook, 'test_ping', JSON.stringify(testPayload));
    res.json({ success, message: success ? 'Webhook de teste disparado com sucesso' : 'Falha ao entregar o webhook de teste' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Sincronizacao manual e logs
// ---------------------------------------------------------------------------

router.post('/sync/trigger', async (req: Request, res: Response) => {
  try {
    WorklabCollector.runSync().catch((err) => console.error('[api] sync atendimentos falhou:', err.message));
    res.json({ success: true, message: 'Sincronização de atendimentos iniciada.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sync/historical', (req: Request, res: Response) => {
  try {
    WorklabCollector.runHistoricalLoad();
    res.json({ success: true, message: 'Carga histórica retroativa iniciada em segundo plano.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/sync/historical/status', (req: Request, res: Response) => {
  try {
    const logs = db.prepare('SELECT * FROM historico_sync ORDER BY mes_ano DESC').all();
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/logs/webhook', (req: Request, res: Response) => {
  try {
    const logs = db.prepare(`
      SELECT l.*, w.url
      FROM webhook_logs l
      LEFT JOIN webhooks w ON l.webhook_id = w.id
      ORDER BY l.id DESC LIMIT 50
    `).all();
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/logs/sync', (req: Request, res: Response) => {
  try {
    const logs = db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 100').all();
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
