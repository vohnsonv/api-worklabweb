import axios from 'axios';
import crypto from 'crypto';
import db from '../db/database';
import { getRecifeSqlTimestamp } from '../utils/dateUtils';

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: any;
}

export class WebhookDispatcher {
  /**
   * Dispara webhooks para todos os endpoints ativos cadastrados para um determinado evento.
   */
  static async dispatchEvent(event: string, data: any): Promise<number> {
    const webhooks = db.prepare(`
      SELECT * FROM webhooks 
      WHERE active = 1 AND (events LIKE ? OR events = '*')
    `).all(`%${event}%`) as any[];

    if (webhooks.length === 0) {
      return 0;
    }

    let dispatchedCount = 0;
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data
    };

    const payloadString = JSON.stringify(payload);

    for (const webhook of webhooks) {
      await this.sendSingleWebhook(webhook, event, payloadString);
      dispatchedCount++;
    }

    return dispatchedCount;
  }

  /**
   * Envia a carga de webhook para um endpoint individual com tentativa de reentrega e assinatura HMAC.
   */
  static async sendSingleWebhook(webhook: any, event: string, payloadString: string): Promise<boolean> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(`${timestamp}.${payloadString}`)
      .digest('hex');

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'WorkLabWeb-Webhook-Engine/1.0',
      'X-WorkLab-Signature': `t=${timestamp},v1=${signature}`,
      'X-WorkLab-Event': event
    };

    let statusCode: number | null = null;
    let responseBody = '';
    let success = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts && !success) {
      attempts++;
      try {
        const response = await axios.post(webhook.url, payloadString, {
          headers,
          timeout: 10000
        });

        statusCode = response.status;
        responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        if (statusCode >= 200 && statusCode < 300) {
          success = true;
        }
      } catch (err: any) {
        if (err.response) {
          statusCode = err.response.status;
          responseBody = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
        } else {
          statusCode = 500;
          responseBody = err.message || 'Erro de conexão no envio do webhook';
        }
      }

      if (!success && attempts < maxAttempts) {
        // Pausa exponencial de 1 segundo antes da próxima tentativa
        await new Promise(res => setTimeout(res, 1000 * attempts));
      }
    }

    // Grava log da tentativa no banco de dados com fuso de Recife
    db.prepare(`
      INSERT INTO webhook_logs (webhook_id, event, payload, status_code, response_body, attempt_count, success, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(webhook.id, event, payloadString, statusCode, responseBody.substring(0, 2000), attempts, success ? 1 : 0, getRecifeSqlTimestamp());

    return success;
  }
}
