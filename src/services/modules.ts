// Catalogo de modulos de captura do WorkLab.
// Cada modulo define de onde os dados vem e com que frequencia sao atualizados.

export type ModuleKind =
  | 'jqgrid'
  | 'datatable'
  | 'report'
  | 'form-report'
  | 'params'
  | 'laudos'
  | 'api-report'
  | 'api-list'
  | 'api-grid';

export interface ModuleDef {
  key: string;
  label: string;
  kind: ModuleKind;
  // Caminho relativo no dominio web (https://www.worklabweb.com.br/)
  endpoint: string;
  // Caminho do relatório na API JSON (https://api.worklabweb.com.br)
  apiPath?: string;
  // Parâmetros extras fixos da consulta em grids REST paginados
  apiQuery?: Record<string, string>;
  // Campo usado como identificador unico do registro (modulos jqgrid)
  idField?: string;
  // Intervalo padrao em minutos (0 = somente sob demanda)
  defaultIntervalMin: number;
  // Descricao curta do que o modulo traz
  description: string;
  // Parametros fixos do POST (modulos form-report). Datas usam {dataInicio}/{dataFim}.
  formParams?: Record<string, string>;
  // Janela padrao (em dias) usada para preencher {dataInicio} nos relatorios
  windowDays?: number;
}

export const MODULES: ModuleDef[] = [
  // Rotina (transacional, sync frequente)
  { key: 'orcamentos', label: 'Orçamentos', kind: 'datatable', endpoint: 'datatable_orcamento.php', idField: 'col0', defaultIntervalMin: 2, description: 'Orçamentos emitidos no WorkLab — proposta comercial com exames e valores antes do fechamento do atendimento.' },
  { key: 'fichario', label: 'Fichário', kind: 'jqgrid', endpoint: 'fichario.php', idField: 'ficharioid', defaultIntervalMin: 2, description: 'Ficha de cadastro dos pacientes/clientes do laboratório (dados pessoais, contato e histórico).' },

  // Relatorios operacionais (POST de formulario + parsing da tabela de resultado)
  {
    key: 'status_exames',
    label: 'Status dos Exames',
    kind: 'form-report',
    endpoint: 'relatorio_situacao.php',
    idField: 'codigo',
    defaultIntervalMin: 60,
    windowDays: 90,
    description: 'Relatório de situação/status dos exames (andamento, liberação, entrega).',
    formParams: { tbdtinicio: '{dataInicio}', tbdtfim: '{dataFim}', cblConvenio: '', cblSecao: '', cblDestino: '', tbexames: '', rdoOpc: '1' },
  },
  {
    key: 'movimento_diario',
    label: 'Movimento Diário',
    kind: 'form-report',
    endpoint: 'movimento_diario.php',
    idField: 'codigo',
    defaultIntervalMin: 60,
    windowDays: 31,
    description: 'Movimento diário do laboratório: atendimentos, valores, formas de pagamento e atendente.',
    formParams: { tbdtinicio: '{dataInicio}', tbdtfim: '{dataFim}', cblUnidade: '', cblFPgto: '', cblUsuario: '', cblConvenio: '', cblAgruparUnidades: '' },
  },
  {
    key: 'particular_atraso',
    label: 'Particular em Atraso',
    kind: 'api-report',
    endpoint: 'newParticularAtraso.php',
    apiPath: '/relatorios/particular_atraso',
    idField: 'codigo',
    defaultIntervalMin: 240,
    windowDays: 180,
    description: 'Exames particulares em atraso (sem pagamento/entrega) — fonte: API JSON oficial do WorkLab.',
  },
  {
    key: 'resultados_gerais',
    label: 'Resultados Gerais',
    kind: 'form-report',
    endpoint: 'resultadogeral.php',
    defaultIntervalMin: 60,
    windowDays: 30,
    description: 'Relação geral de resultados/laudos por período, seção e local.',
    formParams: { tbdtinicio: '{dataInicio}', tbdtfim: '{dataFim}', cblLocal: '', cblSecao: '', tbdtexame: '', rdbOpcao: 'dtcadastro', tbverificar: '', idpaciente: '0' },
  },

  // Configuracao (parametros do laboratorio)
  { key: 'configuracao', label: 'Configuração', kind: 'params', endpoint: 'parametros.php', idField: 'parametro', defaultIntervalMin: 1440, description: 'Parâmetros de configuração do WorkLab (dados gerais do laboratório).' },

  // Cadastros (atualizacao diaria)
  { key: 'medicos', label: 'Médicos', kind: 'jqgrid', endpoint: 'medicos.php', idField: 'medicoid', defaultIntervalMin: 1440, description: 'Cadastro de médicos solicitantes (nome, CRM e convênios vinculados).' },
  { key: 'exames_cadastro', label: 'Cadastro de Exames', kind: 'jqgrid', endpoint: 'exames.php', idField: 'exameid', defaultIntervalMin: 1440, description: 'Cadastro de exames oferecidos (código, nome, seção e valores).' },
  { key: 'orientacoes_coleta', label: 'Orientações de Coleta', kind: 'jqgrid', endpoint: 'orientacoleta.php', idField: 'coletaid', defaultIntervalMin: 1440, description: 'Orientações de coleta por exame (jejum, preparo e instruções ao paciente).' },
  { key: 'textos_padroes', label: 'Textos Padrões', kind: 'jqgrid', endpoint: 'textospadroes.php', idField: 'textopadraoid', defaultIntervalMin: 1440, description: 'Textos padrões usados em laudos e comunicações.' },
  { key: 'orientacoes_tecnicas', label: 'Orientações Técnicas', kind: 'jqgrid', endpoint: 'orientatecnica.php', idField: 'orientacaotecnicaid', defaultIntervalMin: 1440, description: 'Orientações técnicas internas (metodologia, bancadas e equipamentos).' },
  { key: 'convenios', label: 'Convênios', kind: 'jqgrid', endpoint: 'convenios.php', idField: 'convenioid', defaultIntervalMin: 1440, description: 'Convênios e planos cadastrados (tabelas de repasse e cobertura).' },
  { key: 'tabelas_precos', label: 'Tabelas de Preços', kind: 'jqgrid', endpoint: 'tabelaprecos.php', idField: 'tabprecoexameid', defaultIntervalMin: 1440, description: 'Tabelas de preços por convênio/particular.' },
  { key: 'modelos', label: 'Modelos de Laudo', kind: 'jqgrid', endpoint: 'modelos.php', idField: 'modeloid', defaultIntervalMin: 1440, description: 'Modelos de laudo (estrutura e layout dos resultados).' },
  { key: 'abreviacoes', label: 'Abreviações', kind: 'jqgrid', endpoint: 'abreviacoes.php', defaultIntervalMin: 1440, description: 'Abreviações usadas em laudos e exames.' },
  { key: 'locais', label: 'Locais de Coleta', kind: 'jqgrid', endpoint: 'locais.php', defaultIntervalMin: 1440, description: 'Locais/postos de coleta cadastrados.' },
  { key: 'secoes_tecnicas', label: 'Seções Técnicas', kind: 'jqgrid', endpoint: 'secaotecnica.php', defaultIntervalMin: 1440, description: 'Seções técnicas do laboratório (bioquímica, hematologia, etc.).' },
  { key: 'valores_referencia', label: 'Valores de Referência', kind: 'jqgrid', endpoint: 'valoresreferencia.php', defaultIntervalMin: 1440, description: 'Valores de referência por exame, sexo e faixa etária.' },
  { key: 'formas_pagamento', label: 'Formas de Pagamento', kind: 'jqgrid', endpoint: 'formasPagamentos.php', defaultIntervalMin: 1440, description: 'Formas de pagamento aceitas pelo laboratório.' },
  { key: 'categorias', label: 'Categorias', kind: 'jqgrid', endpoint: 'categorias.php', defaultIntervalMin: 1440, description: 'Categorias de classificação usadas no cadastro.' },
  { key: 'portadores', label: 'Portadores', kind: 'jqgrid', endpoint: 'portadores.php', defaultIntervalMin: 1440, description: 'Portadores/contas usados no financeiro.' },
  { key: 'exames_apoio', label: 'Exames de Apoio', kind: 'jqgrid', endpoint: 'examesApoio.php', defaultIntervalMin: 1440, description: 'Exames enviados a laboratórios de apoio e destinos (tela interativa por destino/seção; sem endpoint direto).' },
  {
    key: 'info_complementar',
    label: 'Info Complementar',
    kind: 'api-grid',
    endpoint: 'infocomplementar.php',
    apiPath: '/grids/info_complementar',
    idField: 'id',
    apiQuery: {
      query: '[[]]',
      ascending: 'asc',
      orderBy: 'info_complementar.id',
      show: 'info_complementar.*,exame.nomex as nomex',
      joins: 'exame:exameid.id_exame.left',
    },
    defaultIntervalMin: 1440,
    description: 'Campos de informações complementares por exame (API REST oficial).',
  },
  {
    key: 'usuarios',
    label: 'Usuários',
    kind: 'api-list',
    endpoint: 'newUsuario.php',
    apiPath: '/usuarios',
    idField: 'usuarioid',
    defaultIntervalMin: 1440,
    description: 'Usuários/operadores cadastrados no WorkLab (API REST oficial).',
  },
  { key: 'clientes_fornecedores', label: 'Clientes e Fornecedores', kind: 'jqgrid', endpoint: 'clientefornecedor.php', defaultIntervalMin: 1440, description: 'Clientes e fornecedores cadastrados no financeiro.' },

  // Laudos/resultados por exame (captura via controllerResultado.php)
  { key: 'laudos', label: 'Laudos / Resultados', kind: 'laudos', endpoint: 'controllerResultado.php', idField: 'paciente_exame_id', defaultIntervalMin: 0, description: 'Conteúdo do laudo/resultado de cada exame do paciente (capturado por OS ou em lote).' },

  // Modelos XML de laudo (tela de laudos)
  { key: 'laudos_modelos', label: 'Laudos (modelos XML)', kind: 'jqgrid', endpoint: 'laudos.php', defaultIntervalMin: 1440, description: 'Modelos XML de laudos cadastrados no laboratório.' },
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
  'form-report': {
    label: 'Relatório por formulário (POST + tabela HTML)',
    description:
      'Relatório legado que recebe um POST de formulário (datas e filtros) e devolve HTML com a tabela de resultados. A maior tabela da resposta é convertida em registros objeto (cabeçalho da tabela vira os campos).',
    request: 'POST /{endpoint} (form-urlencoded com datas no formato dd/mm/aaaa)',
    identifier: 'idField configurado ou hash estável do conteúdo quando o campo não existir.'
  },
  params: {
    label: 'Parâmetros (tela de configuração)',
    description:
      'Lê a tela de parâmetros e extrai os pares Rótulo x Valor (inputs/selects do formulário).',
    request: 'GET /{endpoint} (parse dos campos do formulário)',
    identifier: 'Campo `parametro` (rótulo do parâmetro).'
  },
  laudos: {
    label: 'Laudos / Resultados por exame',
    description:
      'Captura o conteúdo do laudo de cada exame via controllerResultado.php (ação PopulaLaudo). Armazena o HTML bruto + texto limpo em capture_records (module=laudos).',
    request: 'POST /controllerResultado.php (acao=PopulaLaudo com pacienteid e pacienteexameid)',
    identifier: 'paciente_exame_id (id do exame do paciente).'
  },
  'api-report': {
    label: 'Relatório via API JSON oficial',
    description:
      'Relatório disponível na API JSON do WorkLab (api.worklabweb.com.br). O coletor faz POST no caminho informado com o corpo padrão de filtros e persiste cada item retornado.',
    request: 'POST {apiPath} na api.worklabweb.com.br (JSON)',
    identifier: 'idField configurado (ex.: codigo) ou hash estável.'
  },
  'api-list': {
    label: 'Lista via API REST oficial',
    description:
      'A API REST do WorkLab devolve um array de registros em GET. O coletor persiste cada item com o idField configurado.',
    request: 'GET {apiPath} na api.worklabweb.com.br',
    identifier: 'idField configurado (ex.: usuarioid).'
  },
  'api-grid': {
    label: 'Grid paginado via API REST oficial',
    description:
      'Grid REST paginado no padrão Laravel ({ current_page, last_page, data, total }). O coletor percorre todas as páginas.',
    request: 'GET {apiPath}?page=N&perPage=500 na api.worklabweb.com.br',
    identifier: 'idField configurado (ex.: id).'
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
