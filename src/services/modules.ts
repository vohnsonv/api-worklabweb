// Catalogo de modulos de captura do WorkLab.
// Cada modulo define de onde os dados vem e com que frequencia sao atualizados.

export type ModuleKind = 'jqgrid' | 'datatable' | 'report';

export interface ModuleDef {
  key: string;
  label: string;
  kind: ModuleKind;
  // Caminho relativo no dominio web (https://www.worklabweb.com.br/)
  endpoint: string;
  // Campo usado como identificador unico do registro (modulos jqgrid)
  idField?: string;
  // Intervalo padrao em minutos (0 = somente sob demanda)
  defaultIntervalMin: number;
  // Descricao curta do que o modulo traz
  description: string;
}

export const MODULES: ModuleDef[] = [
  // Rotina (transacional, sync frequente)
  { key: 'orcamentos', label: 'Orçamentos', kind: 'datatable', endpoint: 'datatable_orcamento.php', idField: 'col0', defaultIntervalMin: 2, description: 'Orçamentos emitidos no WorkLab — proposta comercial com exames e valores antes do fechamento do atendimento.' },
  { key: 'fichario', label: 'Fichário', kind: 'jqgrid', endpoint: 'fichario.php', idField: 'ficharioid', defaultIntervalMin: 2, description: 'Ficha de cadastro dos pacientes/clientes do laboratório (dados pessoais, contato e histórico).' },

  // Relatorios operacionais (endpoint de dados ainda nao mapeado; sob demanda)
  { key: 'status_exames', label: 'Status dos Exames', kind: 'report', endpoint: 'relatorio_situacao.php', defaultIntervalMin: 0, description: 'Relatório de situação/status dos exames (andamento, liberação, entrega).' },
  { key: 'movimento_diario', label: 'Movimento Diário', kind: 'report', endpoint: 'movimento_diario.php', defaultIntervalMin: 0, description: 'Relatório do movimento diário do laboratório (entradas e saídas do dia).' },
  { key: 'particular_atraso', label: 'Particular em Atraso', kind: 'report', endpoint: 'newParticularAtraso.php', defaultIntervalMin: 0, description: 'Relatório de exames particulares em atraso (sem pagamento/entrega).' },

  // Cadastros / configuracao (atualizacao diaria)
  { key: 'configuracao', label: 'Configuração', kind: 'report', endpoint: 'parametros.php', defaultIntervalMin: 0, description: 'Parâmetros de configuração do WorkLab (dados gerais do laboratório).' },
  { key: 'medicos', label: 'Médicos', kind: 'jqgrid', endpoint: 'medicos.php', idField: 'medicoid', defaultIntervalMin: 1440, description: 'Cadastro de médicos solicitantes (nome, CRM e convênios vinculados).' },
  { key: 'exames_cadastro', label: 'Cadastro de Exames', kind: 'jqgrid', endpoint: 'exames.php', idField: 'exameid', defaultIntervalMin: 1440, description: 'Cadastro de exames oferecidos (código, nome, seção e valores).' },
  { key: 'orientacoes_coleta', label: 'Orientações de Coleta', kind: 'jqgrid', endpoint: 'orientacoleta.php', idField: 'coletaid', defaultIntervalMin: 1440, description: 'Orientações de coleta por exame (jejum, preparo e instruções ao paciente).' },
  { key: 'textos_padroes', label: 'Textos Padrões', kind: 'jqgrid', endpoint: 'textospadroes.php', idField: 'textopadraoid', defaultIntervalMin: 1440, description: 'Textos padrões usados em laudos e comunicações.' },
  { key: 'orientacoes_tecnicas', label: 'Orientações Técnicas', kind: 'jqgrid', endpoint: 'orientatecnica.php', idField: 'orientacaotecnicaid', defaultIntervalMin: 1440, description: 'Orientações técnicas internas (metodologia, bancadas e equipamentos).' },
  { key: 'convenios', label: 'Convênios', kind: 'jqgrid', endpoint: 'convenios.php', idField: 'convenioid', defaultIntervalMin: 1440, description: 'Convênios e planos cadastrados (tabelas de repasse e cobertura).' },
  { key: 'tabelas_precos', label: 'Tabelas de Preços', kind: 'jqgrid', endpoint: 'tabela.php', idField: 'tabelaprecoid', defaultIntervalMin: 1440, description: 'Tabelas de preços por convênio/particular.' },
  { key: 'modelos', label: 'Modelos', kind: 'jqgrid', endpoint: 'modelos.php', idField: 'modeloid', defaultIntervalMin: 1440, description: 'Modelos de laudo (estrutura e layout dos resultados).' },

  // Sob demanda
  { key: 'laudos_modelos', label: 'Laudos (XML)', kind: 'report', endpoint: 'laudos.php', defaultIntervalMin: 0, description: 'Laudos (modelos XML) gerados pelo laboratório.' },
  { key: 'abreviacoes', label: 'Abreviações', kind: 'jqgrid', endpoint: 'abreviacoes.php', defaultIntervalMin: 1440, description: 'Abreviações usadas em laudos e exames.' }
];

export function getModule(key: string): ModuleDef | undefined {
  return MODULES.find((m) => m.key === key);
}

// ---------------------------------------------------------------------------
// Detalhamento de como cada tipo de captura funciona (para o modal do painel)
// ---------------------------------------------------------------------------

export interface CaptureDetail {
  label: string;
  description: string;
  source: string;
  kind: ModuleKind;
  kindLabel: string;
  kindDescription: string;
  requestFormat: string;
  identifier: string;
  storage: string;
  interval: string;
  intervalKey: string;
  notes: string;
}

const WEB_BASE = 'https://www.worklabweb.com.br';

const KIND_INFO: Record<ModuleKind, { label: string; description: string; request: string; identifier: string }> = {
  jqgrid: {
    label: 'jqGrid (grid legado)',
    description:
      'A página legada do WorkLab responde a um grid jqGrid em JSON no formato { page, total, records, rows }. Cada item de `rows` é um registro; quando o objeto não traz `cell` (repeatitems:false), as chaves do objeto viram os campos do registro.',
    request: 'GET /{endpoint}?grid_id=list1&_search=false&nd=1&rows=10000&jqgrid_page=1&sidx=1&sord=asc',
    identifier: 'Campo idField configurado (ex.: ficharioid, medicoid, convenioid).'
  },
  datatable: {
    label: 'DataTable (legado)',
    description:
      'A página responde a um DataTable em JSON no formato { aaData: [...] }. Cada linha é um array de células; cada célula vira uma coluna `col0`, `col1`, ... Células que começam com `{` são interpretadas como JSON embutido e expandidas como campos adicionais do registro.',
    request: 'GET /{endpoint}?draw=1&start=0&length=10000&order[0][column]=0&order[0][dir]=desc',
    identifier: 'Campo idField configurado (no caso de orçamentos, a coluna `col0`).'
  },
  report: {
    label: 'Relatório (snapshot HTML)',
    description:
      'Módulo de relatório ainda não mapeado em dados estruturados. A aplicação busca a página e guarda um snapshot do HTML bruto (truncado em 500.000 caracteres) como um único registro, sem quebrar em linhas/campos.',
    request: 'GET /{endpoint} (resposta em HTML, gravada como texto)',
    identifier: 'Registro único com record_id fixo = `snapshot` (sobregrava a cada sincronização).'
  }
};

export function buildCaptureDetail(module: ModuleDef): CaptureDetail {
  const kindInfo = KIND_INFO[module.kind];
  const interval = module.defaultIntervalMin <= 0
    ? 'Somente sob demanda (sem agendamento automático)'
    : `A cada ${module.defaultIntervalMin} minuto(s) por padrão (configurável)`;

  const notes: string[] = [];
  if (module.idField) {
    notes.push(`Identificador único do registro: campo \`${module.idField}\` usado como record_id (upsert/atualização).`);
  }
  if (module.defaultIntervalMin <= 0) {
    notes.push('Pode ser acionado manualmente pelo botão "Sincronizar agora".');
  }

  return {
    label: module.label,
    description: module.description,
    source: `${WEB_BASE}/${module.endpoint}`,
    kind: module.kind,
    kindLabel: kindInfo.label,
    kindDescription: kindInfo.description,
    requestFormat: kindInfo.request.replace('{endpoint}', module.endpoint),
    identifier: kindInfo.identifier,
    storage: 'Tabela `capture_records` (coluna `payload` com o JSON do registro; `record_id` + `module` únicos).',
    interval,
    intervalKey: `module.${module.key}.interval_minutes`,
    notes: notes.join(' ')
  };
}
