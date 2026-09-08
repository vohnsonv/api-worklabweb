import Database from 'better-sqlite3';
import { ENV } from '../config/env';

const db = new Database(ENV.DB_PATH);
db.pragma('journal_mode = WAL');

// Estrutura relacional principal (atendimentos + exames)
db.exec(`
  CREATE TABLE IF NOT EXISTS atendimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worklab_id TEXT UNIQUE NOT NULL,
    protocolo TEXT NOT NULL,
    data_cadastro TEXT,
    paciente_nome TEXT NOT NULL,
    unidade TEXT,
    convenio TEXT,
    medico TEXT,
    cpf TEXT,
    rg TEXT,
    datnasc TEXT,
    sexo TEXT,
    cidade TEXT,
    endereco TEXT,
    telefone TEXT,
    email TEXT,
    atendente TEXT,
    valor_total REAL DEFAULT 0,
    desconto REAL DEFAULT 0,
    acrescimo REAL DEFAULT 0,
    valor_final REAL DEFAULT 0,
    forma_pagamento TEXT,
    situacao TEXT,
    medicamentos TEXT,
    observacao TEXT,
    status_laudo TEXT DEFAULT 'PENDENTE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS exames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atendimento_id INTEGER NOT NULL,
    exame_id INTEGER,
    codigo_exame TEXT,
    nome_exame TEXT NOT NULL,
    descricao TEXT,
    valor REAL DEFAULT 0,
    secao_sigla TEXT,
    secao_descricao TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(atendimento_id) REFERENCES atendimentos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    description TEXT,
    secret TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT 'novo_atendimento',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id INTEGER,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    status_code INTEGER,
    response_body TEXT,
    attempt_count INTEGER DEFAULT 1,
    success INTEGER DEFAULT 0,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(webhook_id) REFERENCES webhooks(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT DEFAULT 'atendimentos',
    status TEXT NOT NULL,
    registros_encontrados INTEGER DEFAULT 0,
    novos_registros INTEGER DEFAULT 0,
    webhooks_disparados INTEGER DEFAULT 0,
    error_message TEXT,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS historico_sync (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mes_ano TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    registros_processados INTEGER DEFAULT 0,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Configuracoes editaveis pelo frontend (fallback para variaveis de ambiente)
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Tabela generica para dados capturados de cada modulo (orçamentos, fichário, cadastros, etc.)
// Cada linha guarda o payload JSON original do WorkLab em `payload`.
db.exec(`
  CREATE TABLE IF NOT EXISTS capture_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT NOT NULL,
    record_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(module, record_id)
  );
`);

// Utilitario para migrar colunas em bancos SQLite legados ja criados
function addColumnIfNotExists(table: string, column: string, type: string) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    const exists = columns.some((c: any) => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (e) {
    // Coluna ja existe ou erro ignoravel em SQLite
  }
}

// Migracoes defensivas para atendimentos
addColumnIfNotExists('atendimentos', 'cpf', 'TEXT');
addColumnIfNotExists('atendimentos', 'rg', 'TEXT');
addColumnIfNotExists('atendimentos', 'datnasc', 'TEXT');
addColumnIfNotExists('atendimentos', 'sexo', 'TEXT');
addColumnIfNotExists('atendimentos', 'cidade', 'TEXT');
addColumnIfNotExists('atendimentos', 'endereco', 'TEXT');
addColumnIfNotExists('atendimentos', 'telefone', 'TEXT');
addColumnIfNotExists('atendimentos', 'email', 'TEXT');
addColumnIfNotExists('atendimentos', 'atendente', 'TEXT');
addColumnIfNotExists('atendimentos', 'valor_total', 'REAL DEFAULT 0');
addColumnIfNotExists('atendimentos', 'desconto', 'REAL DEFAULT 0');
addColumnIfNotExists('atendimentos', 'acrescimo', 'REAL DEFAULT 0');
addColumnIfNotExists('atendimentos', 'valor_final', 'REAL DEFAULT 0');
addColumnIfNotExists('atendimentos', 'forma_pagamento', 'TEXT');
addColumnIfNotExists('atendimentos', 'situacao', 'TEXT');
addColumnIfNotExists('atendimentos', 'medicamentos', 'TEXT');
addColumnIfNotExists('atendimentos', 'observacao', 'TEXT');

// Campos completos do atendimento vindos da API (antes descartados)
addColumnIfNotExists('atendimentos', 'medicoid', 'TEXT');
addColumnIfNotExists('atendimentos', 'convenioid', 'TEXT');
addColumnIfNotExists('atendimentos', 'unidadeid', 'TEXT');
addColumnIfNotExists('atendimentos', 'localid', 'TEXT');
addColumnIfNotExists('atendimentos', 'ficharioid', 'TEXT');
addColumnIfNotExists('atendimentos', 'usuarioid', 'TEXT');
addColumnIfNotExists('atendimentos', 'crm', 'TEXT');
addColumnIfNotExists('atendimentos', 'guia', 'TEXT');
addColumnIfNotExists('atendimentos', 'responsavel', 'TEXT');
addColumnIfNotExists('atendimentos', 'diagnostico', 'TEXT');
addColumnIfNotExists('atendimentos', 'cid', 'TEXT');
addColumnIfNotExists('atendimentos', 'senha_autorizacao', 'TEXT');
addColumnIfNotExists('atendimentos', 'matricula', 'TEXT');
addColumnIfNotExists('atendimentos', 'plano', 'TEXT');
addColumnIfNotExists('atendimentos', 'validade_cartao', 'TEXT');
addColumnIfNotExists('atendimentos', 'data_faturamento', 'TEXT');
addColumnIfNotExists('atendimentos', 'hora_recepcao', 'TEXT');
addColumnIfNotExists('atendimentos', 'urgencia', 'TEXT');
addColumnIfNotExists('atendimentos', 'coletador', 'TEXT');
addColumnIfNotExists('atendimentos', 'celular', 'TEXT');
addColumnIfNotExists('atendimentos', 'cep', 'TEXT');
addColumnIfNotExists('atendimentos', 'empresa', 'TEXT');
addColumnIfNotExists('atendimentos', 'local', 'TEXT');
addColumnIfNotExists('atendimentos', 'idade_completa', 'TEXT');
addColumnIfNotExists('atendimentos', 'idade_anos', 'TEXT');
addColumnIfNotExists('atendimentos', 'total_pago', 'REAL DEFAULT 0');
addColumnIfNotExists('atendimentos', 'total_ch', 'REAL DEFAULT 0');
addColumnIfNotExists('atendimentos', 'formas_pagamento_resumo', 'TEXT');
addColumnIfNotExists('atendimentos', 'sit', 'TEXT');
// Payload bruto completo da API (garante que nenhum campo se perca)
addColumnIfNotExists('atendimentos', 'payload', 'TEXT');

addColumnIfNotExists('exames', 'exame_id', 'INTEGER');
addColumnIfNotExists('exames', 'descricao', 'TEXT');
addColumnIfNotExists('exames', 'valor', 'REAL DEFAULT 0');
addColumnIfNotExists('exames', 'secao_sigla', 'TEXT');
addColumnIfNotExists('exames', 'secao_descricao', 'TEXT');
// Identificador do exame do paciente (necessário para capturar o laudo) + campos completos
addColumnIfNotExists('exames', 'paciente_exame_id', 'INTEGER');
addColumnIfNotExists('exames', 'flag', 'TEXT');
addColumnIfNotExists('exames', 'codigo_amb', 'TEXT');
addColumnIfNotExists('exames', 'valor_ch', 'REAL DEFAULT 0');
addColumnIfNotExists('exames', 'pgtoato', 'TEXT');
addColumnIfNotExists('exames', 'm1', 'TEXT');
addColumnIfNotExists('exames', 'm2', 'TEXT');
addColumnIfNotExists('exames', 'm3', 'TEXT');
addColumnIfNotExists('exames', 'payload', 'TEXT');
addColumnIfNotExists('exames', 'laudo_status', "TEXT DEFAULT 'NAO_CAPTURADO'");
addColumnIfNotExists('exames', 'laudo_capturado_em', 'TEXT');

try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_exames_paciente_exame ON exames(paciente_exame_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_capture_module ON capture_records(module)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_atendimentos_worklab ON atendimentos(worklab_id)');
} catch {
  // índices já existentes
}

// Métricas adicionais nos logs de sincronização
addColumnIfNotExists('sync_logs', 'registros_atualizados', 'INTEGER DEFAULT 0');
addColumnIfNotExists('sync_logs', 'duracao_ms', 'INTEGER DEFAULT 0');

// Migracoes defensivas para sync_logs legados (renomeacao de colunas)
addColumnIfNotExists('sync_logs', 'module', "TEXT DEFAULT 'atendimentos'");
addColumnIfNotExists('sync_logs', 'registros_encontrados', 'INTEGER DEFAULT 0');
addColumnIfNotExists('sync_logs', 'novos_registros', 'INTEGER DEFAULT 0');

export default db;
