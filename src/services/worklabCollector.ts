import axios, { AxiosInstance } from 'axios';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import db from '../db/database';
import { ENV } from '../config/env';
import { WebhookDispatcher } from './webhookDispatcher';
import { getRecifeSqlTimestamp } from '../utils/dateUtils';

export interface AuthSession {
  cookiesStr: string;
  jwtToken: string;
}

export class WorklabCollector {
  private static session: AuthSession | null = null;
  private static lastLoginTime: number = 0;
  private static isSyncing: boolean = false;
  private static isHistoricalSyncing: boolean = false;

  /**
   * Obtém a sessão autenticada utilizando Playwright para inicialização confiável.
   */
  private static async authenticate(): Promise<AuthSession> {
    const now = Date.now();
    // Reutilizar sessão se o login tiver menos de 30 minutos
    if (this.session && now - this.lastLoginTime < 30 * 60 * 1000) {
      return this.session;
    }

    console.log('[WorklabCollector] Efetuando login via browser headless...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Tentativa de navegação com retentativa contra instabilidade de rede
      let navigated = false;
      for (let attempt = 1; attempt <= 3 && !navigated; attempt++) {
        try {
          await page.goto(ENV.WORKLAB_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
          navigated = true;
        } catch (err: any) {
          if (attempt === 3) throw err;
          await new Promise(res => setTimeout(res, 2000));
        }
      }

      // Preencher formulário de login com seletores validados
      await page.fill('input[name="username"]', ENV.WORKLAB_ID);
      await page.fill('input[name="password"]', ENV.WORKLAB_PASSWORD);
      await page.click('button#logar');

      await page.waitForURL(url => url.toString().includes('welcome.php') || url.toString().includes('index.php'), {
        timeout: 15000
      });

      const cookies = await context.cookies();
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const tokenCookie = cookies.find(c => c.name === 'worklab-api-token');
      const jwtToken = tokenCookie ? tokenCookie.value : '';

      if (!cookieStr.includes('PHPSESSID') || !jwtToken) {
        throw new Error('Falha ao obter cookies e token JWT do WorkLab');
      }

      this.session = { cookiesStr: cookieStr, jwtToken };
      this.lastLoginTime = Date.now();
      console.log('[WorklabCollector] Autenticação e Token JWT obtidos com sucesso!');
      return this.session;
    } finally {
      await browser.close();
    }
  }

  /**
   * Instância do Axios autenticada para chamadas de API nativa do WorkLab.
   */
  private static async getApiClient(): Promise<AxiosInstance> {
    const session = await this.authenticate();
    return axios.create({
      baseURL: 'https://api.worklabweb.com.br',
      headers: {
        'Authorization': `Bearer ${session.jwtToken}`,
        'Cookie': session.cookiesStr,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });
  }

  /**
   * Instância do Axios autenticada para chamadas legadas web (download de PDFs).
   */
  private static async getWebClient(): Promise<AxiosInstance> {
    const session = await this.authenticate();
    return axios.create({
      baseURL: 'https://www.worklabweb.com.br',
      headers: {
        'Cookie': session.cookiesStr,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.worklabweb.com.br/new_relconv.php'
      },
      timeout: 20000
    });
  }

  /**
   * Busca registros de pacientes por período na API nativa do WorkLab.
   */
  private static async fetchPacientesPorPeriodo(apiClient: AxiosInstance, dataInicio: string, dataFim: string): Promise<any[]> {
    const response = await apiClient.post('/relatorios/pacientes_por_convenio', {
      data_inicio: dataInicio,
      data_fim: dataFim,
      unidades: [],
      locais: [],
      condicoes: [],
      convenios: [],
      atendentes: [],
      exames: [],
      flags: "&nbsp;,P,N,X,T,1,2,3,4,I,A",
      examsFilter: "list",
      status: [],
      medicos: [],
      bancadas: [],
      forma_pagamentos: [],
      destinos: [],
      secoes: [],
      date_search: "datarec",
      filter_field: "",
      filter_value: "",
      urgencia: "",
      entregue: "",
      template: "",
      info_complementar: []
    });

    const data = response.data;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  }

  /**
   * Executa a sincronização 24/7 cobrindo a janela dos últimos 5 meses até a data atual.
   */
  static async runSync(): Promise<{
    atendimentosEncontrados: number;
    novosAtendimentos: number;
    laudosBaixados: number;
    webhooksDisparados: number;
  }> {
    if (this.isSyncing) {
      console.log('[WorklabCollector] Sincronização já em andamento. Ignorando chamada duplicada.');
      return { atendimentosEncontrados: 0, novosAtendimentos: 0, laudosBaixados: 0, webhooksDisparados: 0 };
    }

    this.isSyncing = true;
    let atendimentosEncontrados = 0;
    let novosAtendimentos = 0;
    let laudosBaixados = 0;
    let webhooksDisparados = 0;
    let errorMessage: string | null = null;
    const nowRecife = getRecifeSqlTimestamp();

    try {
      console.log('[WorklabCollector] Iniciando sincronização 24/7 (Janela de 5 meses)...');
      const apiClient = await this.getApiClient();
      const webClient = await this.getWebClient();

      // Calcular janela dos últimos 5 meses
      const dFim = new Date();
      const dInicio = new Date();
      dInicio.setMonth(dInicio.getMonth() - 5);

      const strInicio = dInicio.toISOString().split('T')[0];
      const strFim = dFim.toISOString().split('T')[0];

      const records = await this.fetchPacientesPorPeriodo(apiClient, strInicio, strFim);
      atendimentosEncontrados = records.length;

      for (const rec of records) {
        const stats = await this.processSingleRecord(rec, webClient, nowRecife);
        if (stats.isNew) novosAtendimentos++;
        if (stats.laudoDownloaded) laudosBaixados++;
        webhooksDisparados += stats.webhooksSent;
      }

      console.log(`[WorklabCollector] Sincronização concluída: ${atendimentosEncontrados} processados, ${novosAtendimentos} novos, ${laudosBaixados} laudos baixados, ${webhooksDisparados} webhooks disparados.`);
    } catch (err: any) {
      errorMessage = err.message || 'Erro na sincronização 24/7';
      console.error('[WorklabCollector] Erro de sincronização:', errorMessage);
    } finally {
      db.prepare(`
        INSERT INTO sync_logs (status, atendimentos_encontrados, novos_atendimentos, laudos_baixados, webhooks_disparados, error_message, executed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        errorMessage ? 'ERROR' : 'SUCCESS',
        atendimentosEncontrados,
        novosAtendimentos,
        laudosBaixados,
        webhooksDisparados,
        errorMessage,
        nowRecife
      );

      this.isSyncing = false;
    }

    return { atendimentosEncontrados, novosAtendimentos, laudosBaixados, webhooksDisparados };
  }

  /**
   * Executa a Carga Histórica Retroativa (2020 a 2026) em blocos mensais.
   */
  static async runHistoricalLoad(): Promise<void> {
    if (this.isHistoricalSyncing) {
      console.log('[WorklabCollector] Carga histórica já em andamento.');
      return;
    }

    this.isHistoricalSyncing = true;
    console.log('[WorklabCollector] Iniciando Carga Histórica Retroativa (2020-2026)...');

    try {
      const apiClient = await this.getApiClient();
      const webClient = await this.getWebClient();
      const nowRecife = getRecifeSqlTimestamp();

      const startYear = 2020;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      for (let year = startYear; year <= currentYear; year++) {
        const lastMonthInYear = (year === currentYear) ? currentMonth : 12;

        for (let month = 1; month <= lastMonthInYear; month++) {
          const monthStr = `${year}-${String(month).padStart(2, '0')}`;
          
          // Checar se mês já foi sincronizado com sucesso
          const done = db.prepare('SELECT * FROM historico_sync WHERE mes_ano = ? AND status = "SUCCESS"').get(monthStr);
          if (done) continue;

          console.log(`[WorklabCollector] Processando carga histórica do mês: ${monthStr}...`);

          const firstDay = `${monthStr}-01`;
          const lastDayObj = new Date(year, month, 0);
          const lastDay = `${monthStr}-${String(lastDayObj.getDate()).padStart(2, '0')}`;

          try {
            const records = await this.fetchPacientesPorPeriodo(apiClient, firstDay, lastDay);
            let count = 0;

            for (const rec of records) {
              await this.processSingleRecord(rec, webClient, nowRecife);
              count++;
            }

            db.prepare(`
              INSERT INTO historico_sync (mes_ano, status, registros_processados, executed_at)
              VALUES (?, 'SUCCESS', ?, ?)
              ON CONFLICT(mes_ano) DO UPDATE SET status='SUCCESS', registros_processados=excluded.registros_processados, executed_at=excluded.executed_at
            `).run(monthStr, count, getRecifeSqlTimestamp());

            console.log(`[WorklabCollector] Mês ${monthStr} concluído com ${count} registros.`);
          } catch (err: any) {
            console.error(`[WorklabCollector] Erro ao sincronizar mês ${monthStr}:`, err.message);
            db.prepare(`
              INSERT INTO historico_sync (mes_ano, status, registros_processados, executed_at)
              VALUES (?, 'ERROR', 0, ?)
              ON CONFLICT(mes_ano) DO UPDATE SET status='ERROR', executed_at=excluded.executed_at
            `).run(monthStr, getRecifeSqlTimestamp());
          }

          // Pausa de 1s para alívio do servidor
          await new Promise(res => setTimeout(res, 1000));
        }
      }

      console.log('[WorklabCollector] Carga Histórica Retroativa finalizada com sucesso!');
    } catch (err: any) {
      console.error('[WorklabCollector] Falha crítica na carga histórica:', err.message);
    } finally {
      this.isHistoricalSyncing = false;
    }
  }

  /**
   * Processa um registro de atendimento retornado da API, realizando o upsert e disparando eventos.
   */
  private static async processSingleRecord(rec: any, webClient: AxiosInstance, nowRecife: string): Promise<{
    isNew: boolean;
    laudoDownloaded: boolean;
    webhooksSent: number;
  }> {
    const worklabId = String(rec.pacienteid || rec.codigo_ficha || '');
    const protocolo = String(rec.codigo_ficha || '');
    const pacienteNome = String(rec.nome || '').trim();

    if (!worklabId || !protocolo || !pacienteNome) {
      return { isNew: false, laudoDownloaded: false, webhooksSent: 0 };
    }

    const dataCadastro = rec.data_cadastro ? String(rec.data_cadastro).substring(0, 10) : '';
    const unidade = rec.unidade_sigla || rec.unidade || '';
    const convenio = rec.convenio_sigla || rec.convenio || '';
    const medico = rec.nome_medico || '';
    const cpf = rec.cpf || '';
    const rg = rec.rg || '';
    const datnasc = rec.datnasc || '';
    const sexo = rec.sexo || '';
    const cidade = rec.cidade || '';
    const endereco = rec.endereco || '';
    const telefone = rec.telefone || rec.celular || '';
    const email = rec.email || '';
    const atendente = rec.atendente || '';
    const valorTotal = parseFloat(rec.total || 0);
    const desconto = parseFloat(rec.desconto || 0);
    const acrescimo = parseFloat(rec.acrescimo || 0);
    const valorFinal = parseFloat(rec.total_desconto_acrescimo || rec.total || 0);
    const formaPagamento = rec.forma_pagamento || '';
    const situacao = rec.situacao || '';
    const medicamentos = rec.medicamentos || '';
    const observacao = rec.observacao || '';

    const existing = db.prepare('SELECT * FROM atendimentos WHERE worklab_id = ?').get(worklabId) as any;
    let atendimentoDbId: number;
    let isNew = false;
    let webhooksSent = 0;

    if (!existing) {
      const result = db.prepare(`
        INSERT INTO atendimentos (
          worklab_id, protocolo, data_cadastro, paciente_nome, unidade, convenio, medico,
          cpf, rg, datnasc, sexo, cidade, endereco, telefone, email, atendente,
          valor_total, desconto, acrescimo, valor_final, forma_pagamento, situacao,
          medicamentos, observacao, status_laudo, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, 'PENDENTE', ?, ?
        )
      `).run(
        worklabId, protocolo, dataCadastro, pacienteNome, unidade, convenio, medico,
        cpf, rg, datnasc, sexo, cidade, endereco, telefone, email, atendente,
        valorTotal, desconto, acrescimo, valorFinal, formaPagamento, situacao,
        medicamentos, observacao, nowRecife, nowRecife
      );

      atendimentoDbId = result.lastInsertRowid as number;
      isNew = true;

      const dispatched = await WebhookDispatcher.dispatchEvent('novo_atendimento', {
        id: atendimentoDbId,
        worklab_id: worklabId,
        protocolo,
        paciente_nome: pacienteNome,
        cpf,
        data_cadastro: dataCadastro,
        unidade,
        convenio,
        medico,
        valor_final: valorFinal,
        status_laudo: 'PENDENTE'
      });
      webhooksSent += dispatched;
    } else {
      atendimentoDbId = existing.id;
      db.prepare(`
        UPDATE atendimentos SET
          protocolo = ?, paciente_nome = ?, unidade = ?, convenio = ?, medico = ?,
          cpf = ?, rg = ?, datnasc = ?, sexo = ?, cidade = ?, endereco = ?,
          telefone = ?, email = ?, atendente = ?, valor_total = ?, desconto = ?,
          acrescimo = ?, valor_final = ?, forma_pagamento = ?, situacao = ?,
          medicamentos = ?, observacao = ?, updated_at = ?
        WHERE id = ?
      `).run(
        protocolo, pacienteNome, unidade, convenio, medico,
        cpf, rg, datnasc, sexo, cidade, endereco,
        telefone, email, atendente, valorTotal, desconto,
        acrescimo, valorFinal, formaPagamento, situacao,
        medicamentos, observacao, nowRecife, atendimentoDbId
      );
    }

    // Processar exames detalhados (substituindo anteriores para evitar duplicidade de registros de exame)
    if (Array.isArray(rec.paciente_exame)) {
      db.prepare('DELETE FROM exames WHERE atendimento_id = ?').run(atendimentoDbId);

      for (const ex of rec.paciente_exame) {
        const exameId = ex.exameid || ex.id || 0;
        const codigoExame = ex.codigo || '';
        const nomeExame = ex.descricao || '';
        const valorExame = parseFloat(ex.valor || 0);
        const secaoSigla = ex.secao_sigla || '';
        const secaoDescricao = ex.secao_descricao || '';

        db.prepare(`
          INSERT INTO exames (atendimento_id, exame_id, codigo_exame, nome_exame, descricao, valor, secao_sigla, secao_descricao, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(atendimentoDbId, exameId, codigoExame, nomeExame, nomeExame, valorExame, secaoSigla, secaoDescricao, 'OK', nowRecife);
      }
    }

    // Tentar baixar laudo PDF se o status ainda for PENDENTE
    let laudoDownloaded = false;
    const currentStatus = existing ? existing.status_laudo : 'PENDENTE';
    if (currentStatus !== 'CONCLUIDO') {
      laudoDownloaded = await this.tryDownloadLaudo(webClient, atendimentoDbId, worklabId, protocolo, pacienteNome);
      if (laudoDownloaded) {
        const dispatched = await WebhookDispatcher.dispatchEvent('laudo_concluido', {
          id: atendimentoDbId,
          worklab_id: worklabId,
          protocolo,
          paciente_nome: pacienteNome,
          status_laudo: 'CONCLUIDO',
          download_url: `/api/v1/atendimentos/${atendimentoDbId}/pdf`
        });
        webhooksSent += dispatched;
      }
    }

    return { isNew, laudoDownloaded, webhooksSent };
  }

  /**
   * Tenta efetuar o download do PDF do laudo caso os exames estejam prontos.
   */
  private static async tryDownloadLaudo(
    client: AxiosInstance,
    atendimentoDbId: number,
    worklabId: string,
    protocolo: string,
    pacienteNome: string
  ): Promise<boolean> {
    try {
      const response = await client.get(`/printLaudo.php?id=${worklabId}`, {
        responseType: 'arraybuffer',
        maxRedirects: 5
      });

      const buffer = Buffer.from(response.data);
      const contentStr = buffer.toString('utf-8');

      if (contentStr.includes('EXAMES EM ANALISE') || contentStr.includes('NAO CONFERIDOS') || contentStr.includes('alert(')) {
        return false;
      }

      if (buffer.subarray(0, 4).toString() === '%PDF') {
        const safeName = pacienteNome.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        const filename = `LAUDO_${protocolo}_${worklabId}_${safeName}.pdf`;
        const filepath = path.join(ENV.STORAGE_PATH, filename);
        const nowRecife = getRecifeSqlTimestamp();

        fs.writeFileSync(filepath, buffer);

        db.prepare("UPDATE atendimentos SET status_laudo = 'CONCLUIDO', updated_at = ? WHERE id = ?").run(nowRecife, atendimentoDbId);
        
        db.prepare(`
          INSERT INTO laudos (atendimento_id, filepath, filename, mime_type, downloaded_at)
          VALUES (?, ?, ?, 'application/pdf', ?)
          ON CONFLICT(atendimento_id) DO UPDATE SET filepath=excluded.filepath, downloaded_at=excluded.downloaded_at
        `).run(atendimentoDbId, filepath, filename, nowRecife);

        return true;
      }
    } catch (err: any) {
      // Ignora falha de download e tenta novamente no próximo ciclo
    }

    return false;
  }
}
