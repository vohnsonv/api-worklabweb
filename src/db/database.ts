import Database from 'better-sqlite3';
import { ENV } from '../config/env';

const db = new Database(ENV.DB_PATH);
db.pragma('journal_mode = WAL');

// Inicialização das tabelas relacionais
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

  CREATE TABLE IF NOT EXISTS laudos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atendimento_id INTEGER UNIQUE NOT NULL,
    filepath TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT DEFAULT 'application/pdf',
    downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(atendimento_id) REFERENCES atendimentos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    description TEXT,
    secret TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT 'laudo_concluido,novo_atendimento',
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
    status TEXT NOT NULL,
    atendimentos_encontrados INTEGER DEFAULT 0,
    novos_atendimentos INTEGER DEFAULT 0,
    laudos_baixados INTEGER DEFAULT 0,
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

// Função auxiliar para migrar colunas em bancos SQLite legados já criados
function addColumnIfNotExists(table: string, column: string, type: string) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    const exists = columns.some((c: any) => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (e) {
    // Coluna já existe ou erro ignorável em SQLite
  }
}

// Executar migrations defensivas
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

addColumnIfNotExists('exames', 'exame_id', 'INTEGER');
addColumnIfNotExists('exames', 'descricao', 'TEXT');
addColumnIfNotExists('exames', 'valor', 'REAL DEFAULT 0');
addColumnIfNotExists('exames', 'secao_sigla', 'TEXT');
addColumnIfNotExists('exames', 'secao_descricao', 'TEXT');

export default db;
