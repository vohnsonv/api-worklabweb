import { AxiosInstance } from 'axios';
import db from '../db/database';
import { SettingsService } from './settingsService';
import { WorklabAuth } from './worklabAuth';
import { WebhookDispatcher } from './webhookDispatcher';
import { getModule } from './modules';
import { fetchJqGrid, fetchDataTable, upsertModuleRows } from './fetchers';
import { getRecifeSqlTimestamp } from '../utils/dateUtils';

// Flags de execucao para evitar sincronizacoes concorrentes.
const running = new Set<string>();

export class WorklabCollector {
  // ---------------------------------------------------------------------------
  // Atendimentos + exames (fonte: relatorio pacientes_por_convenio da API)
  // ---------------------------------------------------------------------------

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
      flags: '&nbsp;,P,N,X,T,1,2,3,4,I,A',
      examsFilter: 'list',
      status: [],
      medicos: [],
      bancadas: [],
      forma_pagamentos: [],
      destinos: [],
      secoes: [],
      date_search: 'datarec',
      filter_field: '',
      filter_value: '',
      urgencia: '',
      entregue: '',
      template: '',
      info_complementar: []
    });

    const data = response.data;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  }

  // Sincroniza atendimentos e exames na janela configurada (padrao 5 meses).
  static async runSync(): Promise<{ encontrados: number; novos: number; webhooks: number }> {
    if (running.has('atendimentos')) {
      return { encontrados: 0, novos: 0, webhooks: 0 };
    }
    running.add('atendimentos');

    let encontrados = 0;
    let novos = 0;
    let webhooks = 0;
    let errorMessage: string | null = null;
    const nowRecife = getRecifeSqlTimestamp();

    try {
      const apiClient = await WorklabAuth.getApiClient();
      const windowMonths = SettingsService.getNumber('sync_window_months', 5);

      const dFim = new Date();
      const dInicio = new Date();
      dInicio.setMonth(dInicio.getMonth() - windowMonths);

      const strInicio = dInicio.toISOString().split('T')[0];
      const strFim = dFim.toISOString().split('T')[0];

      const records = await this.fetchPacientesPorPeriodo(apiClient, strInicio, strFim);
      encontrados = records.length;

      for (const rec of records) {
        const stats = await this.processSingleRecord(rec, nowRecife);
        if (stats.isNew) novos++;
        webhooks += stats.webhooksSent;
      }
    } catch (err: any) {
      errorMessage = err.message || 'Erro na sincronizacao de atendimentos';
      console.error('[collector] Erro em atendimentos:', errorMessage);
    } finally {
      db.prepare(`
        INSERT INTO sync_logs (module, status, registros_encontrados, novos_registros, webhooks_disparados, error_message, executed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('atendimentos', errorMessage ? 'ERROR' : 'SUCCESS', encontrados, novos, webhooks, errorMessage, nowRecife);

      running.delete('atendimentos');
    }

    return { encontrados, novos, webhooks };
  }

  // Upsert de um atendimento e seus exames; dispara evento de novo atendimento.
  private static async processSingleRecord(rec: any, nowRecife: string): Promise<{ isNew: boolean; webhooksSent: number }> {
    const worklabId = String(rec.pacienteid || rec.codigo_ficha || '');
    const protocolo = String(rec.codigo_ficha || '');
    const pacienteNome = String(rec.nome || '').trim();

    if (!worklabId || !protocolo || !pacienteNome) {
      return { isNew: false, webhooksSent: 0 };
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?, ?)
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
        valor_final: valorFinal
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

    // Substitui os exames do atendimento para evitar duplicidade.
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OK', ?)
        `).run(atendimentoDbId, exameId, codigoExame, nomeExame, nomeExame, valorExame, secaoSigla, secaoDescricao, nowRecife);
      }
    }

    return { isNew, webhooksSent };
  }

  // ---------------------------------------------------------------------------
  // Modulos genericos (orçamentos, fichario, cadastros, etc.)
  // ---------------------------------------------------------------------------

  // Sincroniza um modulo de captura especifico e persiste os registros.
  static async syncModule(key: string): Promise<{ encontrados: number; gravados: number }> {
    const module = getModule(key);
    if (!module) {
      throw new Error(`Modulo desconhecido: ${key}`);
    }
    if (running.has(`module:${key}`)) {
      return { encontrados: 0, gravados: 0 };
    }
    running.add(`module:${key}`);

    try {
      const webClient = await WorklabAuth.getWebClient();
      let rows: Record<string, any>[] = [];

      if (module.kind === 'jqgrid') {
        rows = await fetchJqGrid(webClient, module.endpoint);
      } else if (module.kind === 'datatable') {
        rows = await fetchDataTable(webClient, module.endpoint);
      } else if (module.kind === 'report') {
        // Modulos de relatorio ainda nao mapeados; armazena um snapshot do HTML.
        const response = await webClient.get(`/${module.endpoint}`, { responseType: 'text' });
        const html = String(response.data || '').slice(0, 500000);
        rows = [{ __snapshot: true, html, titulo: module.label }];
      }

      const gravados = upsertModuleRows(key, module, rows);

      db.prepare(`
        INSERT INTO sync_logs (module, status, registros_encontrados, novos_registros, webhooks_disparados, executed_at)
        VALUES (?, 'SUCCESS', ?, ?, 0, ?)
      `).run(key, rows.length, gravados, getRecifeSqlTimestamp());

      return { encontrados: rows.length, gravados };
    } catch (err: any) {
      db.prepare(`
        INSERT INTO sync_logs (module, status, error_message, executed_at)
        VALUES (?, 'ERROR', ?, ?)
      `).run(key, err.message || 'Erro no modulo', getRecifeSqlTimestamp());

      throw err;
    } finally {
      running.delete(`module:${key}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Carga historica retroativa (atendimentos, mes a mes)
  // ---------------------------------------------------------------------------

  static async runHistoricalLoad(): Promise<void> {
    if (running.has('historico')) return;
    running.add('historico');

    try {
      const apiClient = await WorklabAuth.getApiClient();
      const nowRecife = getRecifeSqlTimestamp();
      const startYear = 2020;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      for (let year = startYear; year <= currentYear; year++) {
        const lastMonthInYear = year === currentYear ? currentMonth : 12;

        for (let month = 1; month <= lastMonthInYear; month++) {
          const monthStr = `${year}-${String(month).padStart(2, '0')}`;

          const done = db.prepare('SELECT * FROM historico_sync WHERE mes_ano = ? AND status = "SUCCESS"').get(monthStr);
          if (done) continue;

          const firstDay = `${monthStr}-01`;
          const lastDayObj = new Date(year, month, 0);
          const lastDay = `${monthStr}-${String(lastDayObj.getDate()).padStart(2, '0')}`;

          try {
            const records = await this.fetchPacientesPorPeriodo(apiClient, firstDay, lastDay);
            let count = 0;
            for (const rec of records) {
              await this.processSingleRecord(rec, nowRecife);
              count++;
            }

            db.prepare(`
              INSERT INTO historico_sync (mes_ano, status, registros_processados, executed_at)
              VALUES (?, 'SUCCESS', ?, ?)
              ON CONFLICT(mes_ano) DO UPDATE SET status='SUCCESS', registros_processados=excluded.registros_processados, executed_at=excluded.executed_at
            `).run(monthStr, count, getRecifeSqlTimestamp());
          } catch (err: any) {
            console.error(`[collector] Erro no mes ${monthStr}:`, err.message);
            db.prepare(`
              INSERT INTO historico_sync (mes_ano, status, registros_processados, executed_at)
              VALUES (?, 'ERROR', 0, ?)
              ON CONFLICT(mes_ano) DO UPDATE SET status='ERROR', executed_at=excluded.executed_at
            `).run(monthStr, getRecifeSqlTimestamp());
          }

          await new Promise((res) => setTimeout(res, 1000));
        }
      }
    } finally {
      running.delete('historico');
    }
  }
}
