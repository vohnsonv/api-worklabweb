import crypto from 'crypto';
import { AxiosInstance } from 'axios';
import db from '../db/database';
import { ModuleDef } from './modules';

// Serializa um registro ignorando chaves internas (prefixo __) para que o
// hash do fallback permaneca estavel entre sincronizacoes.
function stablePayload(row: Record<string, any>): string {
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('__')) continue;
    clean[key] = value;
  }
  return JSON.stringify(clean);
}

// Extrai um identificador estavel para um registro de modulo.
// Prioridade: idField configurado > snapshot (registro unico) > hash do conteudo.
function resolveRecordId(module: ModuleDef, row: Record<string, any>): string {
  if (module.idField && row[module.idField] !== undefined && row[module.idField] !== null) {
    return String(row[module.idField]);
  }
  if (row.__snapshot) return 'snapshot';
  return crypto.createHash('sha1').update(stablePayload(row)).digest('hex');
}

// Persiste linhas de um modulo na tabela generica capture_records (upsert).
export function upsertModuleRows(moduleKey: string, module: ModuleDef, rows: Record<string, any>[]): number {
  const stmt = db.prepare(`
    INSERT INTO capture_records (module, record_id, payload, synced_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(module, record_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at
  `);

  const tx = db.transaction((items: [string, string, string][]) => {
    for (const [mod, rid, payload] of items) {
      stmt.run(mod, rid, payload);
    }
  });

  const items: [string, string, string][] = rows.map((row) => {
    const recordId = resolveRecordId(module, row);
    return [moduleKey, recordId, JSON.stringify(row)];
  });

  tx(items);
  return rows.length;
}

// Busca dados de modulos jqGrid (paginas que respondem com JSON no formato
// { page, total, records, rows: [ { campo: valor, ... } ] }).
export async function fetchJqGrid(client: AxiosInstance, endpoint: string, rows = 10000): Promise<Record<string, any>[]> {
  const url = `/${endpoint}?grid_id=list1&_search=false&nd=1&rows=${rows}&jqgrid_page=1&sidx=1&sord=asc`;
  const response = await client.get(url);
  const data = response.data;

  if (!data || !Array.isArray(data.rows)) {
    return [];
  }

  return data.rows.map((row: any) => {
    // jqGrid pode retornar objetos nomeados (repeatitems:false) ou { id, cell: [...] }
    if (row && typeof row === 'object' && !Array.isArray(row.cell)) {
      const { id, ...fields } = row;
      return fields;
    }
    return row;
  });
}

// Busca dados de modulos DataTables (orcamentos).
// Formato esperado: { aaData: [ [col0, col1, ...], ... ] }.
// Celulas que contem JSON embutido sao expandidas no objeto final.
export async function fetchDataTable(client: AxiosInstance, endpoint: string, rows = 10000): Promise<Record<string, any>[]> {
  const url = `/${endpoint}?draw=1&start=0&length=${rows}&order%5B0%5D%5Bcolumn%5D=0&order%5B0%5D%5Bdir%5D=desc`;
  const response = await client.get(url);
  const data = response.data;

  const aaData = data && Array.isArray(data.aaData) ? data.aaData : [];

  return aaData.map((row: any[]) => {
    const result: Record<string, any> = {};
    (row || []).forEach((cell, j) => {
      result[`col${j}`] = cell;
      if (typeof cell === 'string' && cell.trim().startsWith('{')) {
        try {
          Object.assign(result, JSON.parse(cell));
        } catch {
          // celula nao e um JSON valido; mantem apenas em col{j}
        }
      }
    });
    return result;
  });
}
