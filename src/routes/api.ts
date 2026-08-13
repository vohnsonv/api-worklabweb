import { Router, Request, Response } from 'express';
import db from '../db/database';
import { WorklabCollector } from '../services/worklabCollector';
import { WebhookDispatcher } from '../services/webhookDispatcher';
import fs from 'fs';

const router = Router();

/**
 * GET /api/v1/stats
 * Retorna estatísticas em tempo real para o Dashboard Frontend.
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    const totalAtendimentos = (db.prepare('SELECT COUNT(*) as count FROM atendimentos').get() as any).count;
    const laudosConcluidos = (db.prepare("SELECT COUNT(*) as count FROM atendimentos WHERE status_laudo = 'CONCLUIDO'").get() as any).count;
    const webhooksAtivos = (db.prepare('SELECT COUNT(*) as count FROM webhooks WHERE active = 1').get() as any).count;
    
    const totalFaturado = (db.prepare('SELECT SUM(valor_final) as total FROM atendimentos').get() as any).total || 0;

    const totalWebhookLogs = (db.prepare('SELECT COUNT(*) as count FROM webhook_logs').get() as any).count;
    const successWebhookLogs = (db.prepare('SELECT COUNT(*) as count FROM webhook_logs WHERE success = 1').get() as any).count;
    const taxaSucessoWebhook = totalWebhookLogs > 0 ? Math.round((successWebhookLogs / totalWebhookLogs) * 100) : 100;

    const ultimaSync = db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1').get() as any;
    const historicoProgresso = db.prepare("SELECT COUNT(*) as count FROM historico_sync WHERE status = 'SUCCESS'").get() as any;

    res.json({
      success: true,
      stats: {
        totalAtendimentos,
        laudosConcluidos,
        webhooksAtivos,
        taxaSucessoWebhook,
        totalFaturado,
        mesesHistoricosConcluidos: historicoProgresso ? historicoProgresso.count : 0,
        ultimaSync: ultimaSync || null
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/atendimentos
 * Lista atendimentos cadastrados com busca e exames anexados.
 */
router.get('/atendimentos', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const status = req.query.status as string;
    const search = req.query.search as string;
    const offset = (page - 1) * limit;

    let query = 'SELECT a.*, l.filename as pdf_filename FROM atendimentos a LEFT JOIN laudos l ON a.id = l.atendimento_id WHERE 1=1';
    const params: any[] = [];

    if (status) {
      query += ' AND a.status_laudo = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (a.paciente_nome LIKE ? OR a.protocolo LIKE ? OR a.worklab_id LIKE ? OR a.cpf LIKE ? OR a.atendente LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const atendimentos = db.prepare(query).all(...params) as any[];

    // Anexar exames realizados para cada atendimento
    for (const item of atendimentos) {
      const exames = db.prepare('SELECT * FROM exames WHERE atendimento_id = ?').all(item.id);
      item.exames = exames;
    }

    // Contagem total para paginação
    let countQuery = 'SELECT COUNT(*) as total FROM atendimentos WHERE 1=1';
    const countParams: any[] = [];
    if (status) {
      countQuery += ' AND status_laudo = ?';
      countParams.push(status);
    }
    if (search) {
      countQuery += ' AND (paciente_nome LIKE ? OR protocolo LIKE ? OR worklab_id LIKE ? OR cpf LIKE ? OR atendente LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const total = (db.prepare(countQuery).get(...countParams) as any).total;

    res.json({
      success: true,
      data: atendimentos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/atendimentos/:id
 * Retorna detalhes completos do atendimento com exames e laudo.
 */
router.get('/atendimentos/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const atendimento = db.prepare('SELECT * FROM atendimentos WHERE id = ? OR worklab_id = ?').get(id, id) as any;
    if (!atendimento) {
      return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
    }

    const exames = db.prepare('SELECT * FROM exames WHERE atendimento_id = ?').all(atendimento.id);
    const laudo = db.prepare('SELECT * FROM laudos WHERE atendimento_id = ?').get(atendimento.id);

    res.json({
      success: true,
      data: {
        ...atendimento,
        exames,
        laudo: laudo || null
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/atendimentos/:id/pdf
 * Transmite o arquivo PDF do laudo concluído.
 */
router.get('/atendimentos/:id/pdf', (req: Request, res: Response) => {
  try {
    const atendimentoId = req.params.id;
    const laudo = db.prepare(`
      SELECT l.*, a.protocolo, a.paciente_nome 
      FROM laudos l 
      JOIN atendimentos a ON l.atendimento_id = a.id 
      WHERE a.id = ? OR a.worklab_id = ?
    `).get(atendimentoId, atendimentoId) as any;

    if (!laudo || !fs.existsSync(laudo.filepath)) {
      return res.status(404).json({ success: false, error: 'Arquivo de laudo PDF não encontrado' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${laudo.filename}"`);
    fs.createReadStream(laudo.filepath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/sync/historical
 * Dispara a carga histórica retroativa de 2020 a 2026 em segundo plano.
 */
router.post('/sync/historical', (req: Request, res: Response) => {
  try {
    WorklabCollector.runHistoricalLoad();
    res.json({ success: true, message: 'Carga histórica retroativa (2020-2026) iniciada em segundo plano.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/sync/historical/status
 * Retorna o status de progresso da carga histórica por mês.
 */
router.get('/sync/historical/status', (req: Request, res: Response) => {
  try {
    const logs = db.prepare('SELECT * FROM historico_sync ORDER BY mes_ano DESC').all();
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/webhooks & POST /api/v1/webhooks & DELETE /api/v1/webhooks/:id
 */
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
    const eventList = events || 'laudo_concluido,novo_atendimento';

    const result = db.prepare(`
      INSERT INTO webhooks (url, description, secret, events, active)
      VALUES (?, ?, ?, ?, 1)
    `).run(url, description || '', secretKey, eventList);

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
      data: { message: 'Teste de conectividade do sistema api-worklabweb', status: 'OK' }
    };

    const success = await WebhookDispatcher.sendSingleWebhook(webhook, 'test_ping', JSON.stringify(testPayload));
    res.json({ success, message: success ? 'Webhook de teste disparado com sucesso' : 'Falha ao entregar o webhook de teste' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sync/trigger', async (req: Request, res: Response) => {
  try {
    WorklabCollector.runSync();
    res.json({ success: true, message: 'Sincronização manual iniciada em segundo plano.' });
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
    const logs = db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 50').all();
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
