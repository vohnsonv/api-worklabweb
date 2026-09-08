import { AxiosInstance } from 'axios';
import db from '../db/database';
import { SettingsService } from './settingsService';
import { WorklabAuth } from './worklabAuth';
import { WebhookDispatcher } from './webhookDispatcher';
import { getModule } from './modules';
import {
  fetchJqGrid,
  fetchDataTable,
  fetchFormReport,
  fetchParametros,
  fetchApiReport,
  tabelaParaRegistros,
  upsertModuleRows,
} from './fetchers';
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
  // Grava TODOS os campos retornados pela API (colunas principais + payload bruto).
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

    // Campos complementares (antes descartados) + payload bruto completo
    const extras = {
      medicoid: rec.medicoid != null ? String(rec.medicoid) : '',
      convenioid: rec.convenioid != null ? String(rec.convenioid) : '',
      unidadeid: rec.unidadeid != null ? String(rec.unidadeid) : '',
      localid: rec.localid != null ? String(rec.localid) : '',
      ficharioid: rec.ficharioid != null ? String(rec.ficharioid) : '',
      usuarioid: rec.usuarioid != null ? String(rec.usuarioid) : '',
      crm: rec.crm || '',
      guia: rec.guia || '',
      responsavel: rec.responsavel || '',
      diagnostico: rec.diagnostico || '',
      cid: rec.cid || '',
      senhaAutorizacao: rec.senhaautorizacao || '',
      matricula: rec.matricula || rec.pac_matricula || '',
      plano: rec.plano || '',
      validadeCartao: rec.validadecartao || '',
      dataFaturamento: rec.datafat || '',
      horaRecepcao: rec.horarec || '',
      urgencia: rec.urgencia != null ? String(rec.urgencia) : '',
      coletador: rec.coletador || '',
      celular: rec.celular || '',
      cep: rec.cep || '',
      empresa: rec.empresa || rec.empresa_fichario || '',
      local: rec.local || '',
      idadeCompleta: rec.idade_completa || '',
      idadeAnos: rec.idade_anos != null ? String(rec.idade_anos) : '',
      totalPago: parseFloat(rec.total_pago || 0) || 0,
      totalCh: parseFloat(rec.total_ch || 0) || 0,
      formasPagamentoResumo: rec.formas_pagamento_resumo
        ? typeof rec.formas_pagamento_resumo === 'string'
          ? rec.formas_pagamento_resumo
          : JSON.stringify(rec.formas_pagamento_resumo)
        : '',
      sit: rec.sit != null ? String(rec.sit) : '',
      payload: JSON.stringify(rec),
    };

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
          medicamentos, observacao, status_laudo, created_at, updated_at,
          medicoid, convenioid, unidadeid, localid, ficharioid, usuarioid, crm, guia, responsavel,
          diagnostico, cid, senha_autorizacao, matricula, plano, validade_cartao, data_faturamento,
          hora_recepcao, urgencia, coletador, celular, cep, empresa, local, idade_completa, idade_anos,
          total_pago, total_ch, formas_pagamento_resumo, sit, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?, ?,
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        worklabId, protocolo, dataCadastro, pacienteNome, unidade, convenio, medico,
        cpf, rg, datnasc, sexo, cidade, endereco, telefone, email, atendente,
        valorTotal, desconto, acrescimo, valorFinal, formaPagamento, situacao,
        medicamentos, observacao, nowRecife, nowRecife,
        extras.medicoid, extras.convenioid, extras.unidadeid, extras.localid, extras.ficharioid,
        extras.usuarioid, extras.crm, extras.guia, extras.responsavel, extras.diagnostico, extras.cid,
        extras.senhaAutorizacao, extras.matricula, extras.plano, extras.validadeCartao, extras.dataFaturamento,
        extras.horaRecepcao, extras.urgencia, extras.coletador, extras.celular, extras.cep, extras.empresa,
        extras.local, extras.idadeCompleta, extras.idadeAnos, extras.totalPago, extras.totalCh,
        extras.formasPagamentoResumo, extras.sit, extras.payload
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
          medicamentos = ?, observacao = ?, updated_at = ?,
          medicoid = ?, convenioid = ?, unidadeid = ?, localid = ?, ficharioid = ?, usuarioid = ?,
          crm = ?, guia = ?, responsavel = ?, diagnostico = ?, cid = ?, senha_autorizacao = ?,
          matricula = ?, plano = ?, validade_cartao = ?, data_faturamento = ?, hora_recepcao = ?,
          urgencia = ?, coletador = ?, celular = ?, cep = ?, empresa = ?, local = ?,
          idade_completa = ?, idade_anos = ?, total_pago = ?, total_ch = ?,
          formas_pagamento_resumo = ?, sit = ?, payload = ?
        WHERE id = ?
      `).run(
        protocolo, pacienteNome, unidade, convenio, medico,
        cpf, rg, datnasc, sexo, cidade, endereco,
        telefone, email, atendente, valorTotal, desconto,
        acrescimo, valorFinal, formaPagamento, situacao,
        medicamentos, observacao, nowRecife,
        extras.medicoid, extras.convenioid, extras.unidadeid, extras.localid, extras.ficharioid,
        extras.usuarioid, extras.crm, extras.guia, extras.responsavel, extras.diagnostico, extras.cid,
        extras.senhaAutorizacao, extras.matricula, extras.plano, extras.validadeCartao, extras.dataFaturamento,
        extras.horaRecepcao, extras.urgencia, extras.coletador, extras.celular, extras.cep, extras.empresa,
        extras.local, extras.idadeCompleta, extras.idadeAnos, extras.totalPago, extras.totalCh,
        extras.formasPagamentoResumo, extras.sit, extras.payload,
        atendimentoDbId
      );
    }

    // Substitui os exames do atendimento preservando o status de laudo já capturado.
    if (Array.isArray(rec.paciente_exame)) {
      const laudosAnteriores = db
        .prepare('SELECT paciente_exame_id, laudo_status, laudo_capturado_em FROM exames WHERE atendimento_id = ?')
        .all(atendimentoDbId) as any[];
      const mapaLaudos = new Map<string, { status: string; em: string }>();
      for (const l of laudosAnteriores) {
        if (l.paciente_exame_id) {
          mapaLaudos.set(String(l.paciente_exame_id), { status: l.laudo_status, em: l.laudo_capturado_em });
        }
      }

      db.prepare('DELETE FROM exames WHERE atendimento_id = ?').run(atendimentoDbId);

      for (const ex of rec.paciente_exame) {
        const pacienteExameId = ex.id != null ? Number(ex.id) : null;
        const exameId = ex.exameid || 0;
        const codigoExame = ex.codigo || '';
        const nomeExame = ex.descricao || '';
        const valorExame = parseFloat(ex.valor || 0) || 0;
        const secaoSigla = ex.secao_sigla || '';
        const secaoDescricao = ex.secao_descricao || '';
        const anterior = pacienteExameId != null ? mapaLaudos.get(String(pacienteExameId)) : undefined;

        db.prepare(`
          INSERT INTO exames (
            atendimento_id, exame_id, codigo_exame, nome_exame, descricao, valor,
            secao_sigla, secao_descricao, status, created_at,
            paciente_exame_id, flag, codigo_amb, valor_ch, pgtoato, m1, m2, m3, payload,
            laudo_status, laudo_capturado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OK', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          atendimentoDbId, exameId, codigoExame, nomeExame, nomeExame, valorExame,
          secaoSigla, secaoDescricao, nowRecife,
          pacienteExameId, ex.flag || '', ex.codigo_amb || '', parseFloat(ex.valor_ch || 0) || 0,
          ex.pgtoato != null ? String(ex.pgtoato) : '', ex.m1 != null ? String(ex.m1) : '',
          ex.m2 != null ? String(ex.m2) : '', ex.m3 != null ? String(ex.m3) : '', JSON.stringify(ex),
          anterior?.status || 'NAO_CAPTURADO', anterior?.em || null,
        );
      }
    }

    return { isNew, webhooksSent };
  }

  // ---------------------------------------------------------------------------
  // Modulos genericos (orçamentos, fichario, cadastros, etc.)
  // ---------------------------------------------------------------------------

  // Sincroniza um modulo de captura especifico e persiste os registros.
  // Retorna métricas detalhadas (novos/atualizados) e dispara webhook de módulo quando houver dados novos.
  static async syncModule(key: string): Promise<{ encontrados: number; gravados: number; novos: number; atualizados: number; invalidos: number }> {
    const module = getModule(key);
    if (!module) {
      throw new Error(`Modulo desconhecido: ${key}`);
    }
    if (running.has(`module:${key}`)) {
      return { encontrados: 0, gravados: 0, novos: 0, atualizados: 0, invalidos: 0 };
    }
    running.add(`module:${key}`);
    const inicio = Date.now();
    const nowRecife = getRecifeSqlTimestamp();

    try {
      const webClient = await WorklabAuth.getWebClient();
      let rows: Record<string, any>[] = [];

      if (module.kind === 'jqgrid') {
        rows = await fetchJqGrid(webClient, module.endpoint);
        // Fallback: algumas telas renderizam a tabela no HTML (sem grid JSON)
        if (rows.length === 0) {
          const response = await webClient.get(`/${module.endpoint}`, { responseType: 'text' });
          rows = tabelaParaRegistros(String(response.data || ''));
        }
      } else if (module.kind === 'datatable') {
        rows = await fetchDataTable(webClient, module.endpoint);
      } else if (module.kind === 'form-report') {
        // Relatório legado: POST com o formulário e parsing da tabela de resultado
        const params: Record<string, string> = {};
        const fim = new Date();
        const inicioData = new Date();
        inicioData.setDate(inicioData.getDate() - (module.windowDays || 90));

        const br = (d: Date) =>
          `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        for (const [k, v] of Object.entries(module.formParams || {})) {
          params[k] = String(v)
            .replace('{dataInicio}', br(inicioData))
            .replace('{dataFim}', br(fim));
        }
        rows = await fetchFormReport(webClient, module.endpoint, params);
      } else if (module.kind === 'params') {
        rows = await fetchParametros(webClient, module.endpoint);
      } else if (module.kind === 'api-report' && module.apiPath) {
        const apiClient = await WorklabAuth.getApiClient();
        const fim = new Date();
        const inicio = new Date();
        inicio.setDate(inicio.getDate() - (module.windowDays || 90));
        const iso = (d: Date) => d.toISOString().split('T')[0];

        rows = await fetchApiReport(apiClient, module.apiPath, {
          data_inicio: iso(inicio),
          data_fim: iso(fim),
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
          info_complementar: [],
        });
      }

      // Registros sem idField (relatórios) recebem id composto estável para upsert
      if (!module.idField && rows.length > 0) {
        const prioridade = ['data_cadastro', 'data_cadastro', 'codigo', 'protocolo', 'paciente', 'nome_paciente', 'convenio', 'codigo_exame', 'exame'];
        for (const row of rows) {
          const partes: string[] = [];
          for (const col of prioridade) {
            if (row[col] !== undefined && row[col] !== null && String(row[col]).trim() !== '') {
              partes.push(String(row[col]).trim());
            }
          }
          if (partes.length === 0) {
            partes.push(...Object.values(row).slice(0, 3).map((v) => String(v ?? '')));
          }
          row.__rid = partes.slice(0, 4).join('_');
        }
      }

      const resultado = upsertModuleRows(key, module, rows);

      db.prepare(`
        INSERT INTO sync_logs (module, status, registros_encontrados, novos_registros, registros_atualizados, webhooks_disparados, error_message, duracao_ms, executed_at)
        VALUES (?, 'SUCCESS', ?, ?, ?, 0, ?, ?, ?)
      `).run(
        key,
        rows.length,
        resultado.novos,
        resultado.atualizados,
        resultado.invalidos > 0 ? `${resultado.invalidos} registro(s) vazio(s) descartado(s)` : null,
        Date.now() - inicio,
        nowRecife,
      );

      return { encontrados: rows.length, gravados: resultado.gravados, novos: resultado.novos, atualizados: resultado.atualizados, invalidos: resultado.invalidos };
    } catch (err: any) {
      db.prepare(`
        INSERT INTO sync_logs (module, status, error_message, duracao_ms, executed_at)
        VALUES (?, 'ERROR', ?, ?, ?)
      `).run(key, err.message || 'Erro no modulo', Date.now() - inicio, nowRecife);

      throw err;
    } finally {
      running.delete(`module:${key}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Laudos / Resultados (controllerResultado.php::PopulaLaudo)
  // ---------------------------------------------------------------------------

  // Captura o laudo de um exame de paciente específico.
  // `pacienteid` = id do paciente; `pacienteexameid` = id do exame (tabela exames).
  static async capturarLaudoExame(pacienteid: string | number, pacienteexameid: string | number): Promise<{ ok: boolean; laudo?: string; erro?: string }> {
    try {
      const webClient = await WorklabAuth.getWebClient();
      const body = new URLSearchParams({
        acao: 'PopulaLaudo',
        pacienteid: String(pacienteid),
        pacienteexameid: String(pacienteexameid),
        idade: '0',
        sexo: '0',
        codficha: '0',
        tbindex: '1',
        conferencia: '0',
        tbindexSalvar: '0',
      });
      const res = await webClient.post('/controllerResultado.php', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        responseType: 'text',
      });
      const texto = String(res.data || '');
      let parsed: any = null;
      try {
        parsed = JSON.parse(texto);
      } catch {
        parsed = null;
      }

      const laudoHtml = parsed?.laudo ?? texto;
      if (!laudoHtml || (typeof laudoHtml === 'string' && laudoHtml.trim().length === 0)) {
        return { ok: false, erro: 'Laudo vazio retornado pelo portal.' };
      }

      // Extrai o texto do laudo, removendo os campos de edição/formulário da tela
      const textoLimpo = String(laudoHtml)
        .replace(/<textarea[\s\S]*?<\/textarea>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<input[\s\S]*?>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Persiste na tabela capture_records (module=laudos) com o HTML bruto + texto limpo
      const stmt = db.prepare(`
        INSERT INTO capture_records (module, record_id, payload, synced_at)
        VALUES ('laudos', ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(module, record_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at
      `);
      stmt.run(
        `${pacienteexameid}`,
        JSON.stringify({
          pacienteid: String(pacienteid),
          pacienteexameid: String(pacienteexameid),
          html: laudoHtml,
          texto: textoLimpo,
          capturado_em: new Date().toISOString(),
        }),
      );

      // Marca o exame como capturado
      db.prepare(`
        UPDATE exames SET laudo_status = 'CAPTURADO', laudo_capturado_em = ? WHERE paciente_exame_id = ?
      `).run(new Date().toISOString(), String(pacienteexameid));

      return { ok: true, laudo: textoLimpo };
    } catch (err: any) {
      return { ok: false, erro: err.message || 'Falha ao capturar laudo.' };
    }
  }

  // Captura laudos em lote: exames da janela configurada que ainda não foram capturados.
  static async capturarLaudosLote(limite = 500): Promise<{ capturados: number; falhas: number; restantes: number; total: number }> {
    if (running.has('laudos')) {
      return { capturados: 0, falhas: 0, restantes: 0, total: 0 };
    }
    running.add('laudos');
    const nowRecife = getRecifeSqlTimestamp();
    const inicio = Date.now();

    try {
      // Examina exames que ainda não têm laudo, do mais recente para o mais antigo
      // (sem filtro de janela: a captura em lote cobre todo o histórico pendente)
      const candidatos = db
        .prepare(`
          SELECT e.paciente_exame_id, e.laudo_status
          FROM exames e
          JOIN atendimentos a ON e.atendimento_id = a.id
          WHERE e.laudo_status = 'NAO_CAPTURADO'
            AND e.paciente_exame_id IS NOT NULL
          ORDER BY a.data_cadastro DESC
          LIMIT ?
        `)
        .all(limite) as any[];

      const total = db
        .prepare(`
          SELECT COUNT(*) as c
          FROM exames e
          JOIN atendimentos a ON e.atendimento_id = a.id
          WHERE e.laudo_status = 'NAO_CAPTURADO'
            AND e.paciente_exame_id IS NOT NULL
        `)
        .get() as any;

      let capturados = 0;
      let falhas = 0;
      let jaTentados = 0;

      // Prepara a lista de (pacienteId, pacienteExameId) para captura
      const fila: Array<{ pe: string; pid: string }> = [];
      for (const c of candidatos) {
        const atend = db
          .prepare('SELECT a.payload FROM atendimentos a JOIN exames e ON e.atendimento_id = a.id WHERE e.paciente_exame_id = ?')
          .get(String(c.paciente_exame_id)) as any;
        const pacienteid = atend?.payload ? (JSON.parse(atend.payload).pacienteid ?? null) : null;
        if (pacienteid == null) {
          jaTentados++;
          continue;
        }
        fila.push({ pe: String(c.paciente_exame_id), pid: String(pacienteid) });
      }

      // Executa com concorrência moderada (o portal tolera ~3 chamadas simultâneas)
      const CONCORRENCIA = 3;
      let proximo = 0;

      // Heartbeat: evidencia se o lote está progredindo ou travado
      const heartbeat = setInterval(() => {
        console.log(`[laudos] andamento: ${capturados} capturados, ${falhas} falhas (fila ${fila.length - Math.min(proximo, fila.length)} restantes)`);
      }, 60000);

      const capturarComTimeout = async (item: { pe: string; pid: string }) => {
        // Nunca deixa um exame travar o lote além de 150s
        return Promise.race([
          this.capturarLaudoExame(item.pid, item.pe),
          new Promise<{ ok: false; erro: string }>((resolve) => {
            setTimeout(() => resolve({ ok: false, erro: 'timeout interno de 150s' }), 150000);
          }),
        ]);
      };

      const trabalhador = async () => {
        for (;;) {
          const idx = proximo++;
          const item = fila[idx];
          if (!item) return;
          try {
            const res = await capturarComTimeout(item);
            if (res.ok) {
              capturados++;
            } else {
              falhas++;
              db.prepare(`UPDATE exames SET laudo_status = 'FALHOU', laudo_capturado_em = ? WHERE paciente_exame_id = ?`).run(
                new Date().toISOString(),
                item.pe,
              );
            }
          } catch {
            falhas++;
            db.prepare(`UPDATE exames SET laudo_status = 'FALHOU', laudo_capturado_em = ? WHERE paciente_exame_id = ?`).run(
              new Date().toISOString(),
              item.pe,
            );
          }
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, fila.length) }, () => trabalhador()));
      } finally {
        clearInterval(heartbeat);
      }

      db.prepare(`
        INSERT INTO sync_logs (module, status, registros_encontrados, novos_registros, error_message, duracao_ms, executed_at)
        VALUES ('laudos', 'SUCCESS', ?, ?, ?, ?, ?)
      `).run(candidatos.length, capturados, falhas > 0 ? `${falhas} falha(s)` : null, Date.now() - inicio, nowRecife);

      const restantes = Math.max(0, (total?.c ?? 0) - capturados - jaTentados);

      // Modo contínuo: se ativado via settings (module.laudos.auto = '1'),
      // agenda o próximo lote automaticamente até não haver pendentes.
      if (SettingsService.get('module.laudos.auto') === '1' && restantes > 0) {
        setTimeout(() => {
          if (!running.has('laudos')) {
            this.capturarLaudosLote(limite).catch((err) => console.error('[laudos] lote contínuo falhou:', err.message));
          }
        }, 5000);
      }

      return { capturados, falhas, restantes, total: total?.c ?? candidatos.length };
    } catch (err: any) {
      db.prepare(`
        INSERT INTO sync_logs (module, status, error_message, duracao_ms, executed_at)
        VALUES ('laudos', 'ERROR', ?, ?, ?)
      `).run(err.message || 'Erro na captura de laudos', Date.now() - inicio, nowRecife);

      // Em modo contínuo, tenta novamente em 15s mesmo após erro inesperado
      if (SettingsService.get('module.laudos.auto') === '1') {
        setTimeout(() => {
          if (!running.has('laudos')) {
            this.capturarLaudosLote(limite).catch((e2) => console.error('[laudos] retry falhou:', e2.message));
          }
        }, 15000);
      }
      throw err;
    } finally {
      running.delete('laudos');
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

          const done = db.prepare("SELECT * FROM historico_sync WHERE mes_ano = ? AND status = 'SUCCESS'").get(monthStr);
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
