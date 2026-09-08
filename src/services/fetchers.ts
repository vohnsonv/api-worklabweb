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
  if (module.idField && row[module.idField] !== undefined && row[module.idField] !== null && row[module.idField] !== '') {
    return String(row[module.idField]);
  }
  if (row.__snapshot) return 'snapshot';
  return crypto.createHash('sha1').update(stablePayload(row)).digest('hex');
}

export interface UpsertResult {
  gravados: number;
  novos: number;
  atualizados: number;
  invalidos: number;
}

// Persiste linhas de um modulo na tabela generica capture_records (upsert),
// contabilizando novos x atualizados e descartando linhas vazias.
export function upsertModuleRows(moduleKey: string, module: ModuleDef, rows: Record<string, any>[]): UpsertResult {
  const existsStmt = db.prepare('SELECT 1 FROM capture_records WHERE module = ? AND record_id = ?');
  const stmt = db.prepare(`
    INSERT INTO capture_records (module, record_id, payload, synced_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(module, record_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at
  `);

  let novos = 0;
  let atualizados = 0;
  let invalidos = 0;

  const items: [string, string, string][] = [];
  for (const row of rows) {
    // Descarta linhas totalmente vazias (ruído de parsing de HTML)
    const temConteudo = Object.entries(row).some(([k, v]) => !k.startsWith('__') && v !== null && v !== undefined && String(v).trim() !== '');
    if (!temConteudo) {
      invalidos++;
      continue;
    }
    // Registro com id estável composto informado pelo coletor (evita duplicar a cada sync)
    let recordId: string;
    let payload: string;
    if (row.__rid) {
      recordId = String(row.__rid);
      delete row.__rid;
      payload = JSON.stringify(row);
    } else {
      recordId = resolveRecordId(module, row);
      payload = JSON.stringify(row);
    }
    if (existsStmt.get(moduleKey, recordId)) {
      atualizados++;
    } else {
      novos++;
    }
    items.push([moduleKey, recordId, payload]);
  }

  const tx = db.transaction((list: [string, string, string][]) => {
    for (const [mod, rid, payload] of list) {
      stmt.run(mod, rid, payload);
    }
  });
  tx(items);

  return { gravados: items.length, novos, atualizados, invalidos };
}

// ---------------------------------------------------------------------------
// jqGrid — percorre TODAS as páginas até esgotar os registros
// ---------------------------------------------------------------------------
export async function fetchJqGrid(client: AxiosInstance, endpoint: string, pageSize = 5000): Promise<Record<string, any>[]> {
  const todas: Record<string, any>[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  let totalRegistros = 0;

  do {
    const url = `/${endpoint}?grid_id=list1&_search=false&nd=${Date.now()}&rows=${pageSize}&page=${pagina}&jqgrid_page=${pagina}&sidx=1&sord=asc`;
    const response = await client.get(url);
    const data = response.data;

    if (!data || !Array.isArray(data.rows)) break;

    const linhas = data.rows.map((row: any) => {
      if (row && typeof row === 'object' && !Array.isArray(row.cell)) {
        const { id, ...fields } = row;
        return fields;
      }
      if (row && Array.isArray(row.cell)) {
        const obj: Record<string, any> = { id: row.id };
        row.cell.forEach((c: any, i: number) => {
          obj[`col${i}`] = c;
        });
        return obj;
      }
      return row;
    });

    todas.push(...linhas);

    totalRegistros = Number(data.records || data.total_records || 0);
    totalPaginas = Number(data.total || 1);
    if (linhas.length === 0) break;
    if (totalRegistros > 0 && todas.length >= totalRegistros) break;
    pagina++;
  } while (pagina <= totalPaginas && pagina <= 200);

  return todas;
}

// ---------------------------------------------------------------------------
// DataTables — percorre todas as páginas (start/length)
// ---------------------------------------------------------------------------
export async function fetchDataTable(client: AxiosInstance, endpoint: string, pageSize = 5000): Promise<Record<string, any>[]> {
  const todas: Record<string, any>[] = [];
  let start = 0;
  let total = Infinity;

  while (start < total && start < 500000) {
    const url = `/${endpoint}?draw=1&start=${start}&length=${pageSize}&order%5B0%5D%5Bcolumn%5D=0&order%5B0%5D%5Bdir%5D=desc`;
    const response = await client.get(url);
    const data = response.data;
    const aaData = data && Array.isArray(data.aaData) ? data.aaData : data && Array.isArray(data.data) ? data.data : [];

    const linhas = aaData.map((row: any) => {
      if (!Array.isArray(row)) return row as Record<string, any>;
      const result: Record<string, any> = {};
      row.forEach((cell, j) => {
        result[`col${j}`] = cell;
        if (typeof cell === 'string' && cell.trim().startsWith('{')) {
          try {
            Object.assign(result, JSON.parse(cell));
          } catch {
            // célula não é JSON válido
          }
        }
      });
      return result;
    });

    todas.push(...linhas);

    const declarado = Number(data?.iTotalRecords ?? data?.recordsTotal ?? data?.recordsFiltered ?? 0);
    total = declarado > 0 ? declarado : todas.length;
    if (linhas.length === 0 || linhas.length < pageSize) break;
    start += pageSize;
  }

  return todas;
}

// ---------------------------------------------------------------------------
// HTML — utilidades de parsing de tabelas das telas legadas
// ---------------------------------------------------------------------------
export function parseHtmlTables(html: string): string[][][] {
  const tabelas: string[][][] = [];
  for (const t of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const linhas = [...t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        c[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim(),
      ),
    );
    const naoVazias = linhas.filter((l) => l.some((c) => c));
    if (naoVazias.length >= 2) tabelas.push(naoVazias);
  }
  return tabelas;
}

function normalizarCabecalho(valor: string, indice: number): string {
  const limpo = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return limpo || `col${indice}`;
}

// Converte a maior tabela do HTML em registros objeto (cabeçalho -> campos).
export function tabelaParaRegistros(html: string): Record<string, any>[] {
  const tabelas = parseHtmlTables(html);
  if (tabelas.length === 0) return [];

  // Escolhe a tabela com mais linhas (a de resultados, não a de filtros)
  const tabela = tabelas.reduce((maior, atual) => (atual.length > maior.length ? atual : maior), tabelas[0]);
  if (tabela.length < 2) return [];

  const cabecalho = tabela[0].map(normalizarCabecalho);
  const registros: Record<string, any>[] = [];

  for (let i = 1; i < tabela.length; i++) {
    const linha = tabela[i];
    // Linhas de totalização/rodapé costumam ter menos células
    if (linha.length < Math.max(2, Math.floor(cabecalho.length / 2))) continue;
    const registro: Record<string, any> = {};
    linha.forEach((celula, j) => {
      registro[cabecalho[j] || `col${j}`] = celula;
    });
    registros.push(registro);
  }

  return registros;
}

// Relatórios legados que respondem a um POST de formulário e devolvem HTML.
export async function fetchFormReport(
  client: AxiosInstance,
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, any>[]> {
  const body = new URLSearchParams(params).toString();
  const response = await client.post(`/${endpoint}`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    responseType: 'text',
  });
  return tabelaParaRegistros(String(response.data || ''));
}

// Tela de parâmetros: extrai pares (rótulo, valor) dos inputs/selects do formulário.
export async function fetchParametros(client: AxiosInstance, endpoint: string): Promise<Record<string, any>[]> {
  const response = await client.get(`/${endpoint}`, { responseType: 'text' });
  const html = String(response.data || '');
  const registros: Record<string, any>[] = [];

  // Tabela "Parâmetro | Valor" com inputs embutidos
  for (const t of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const linhaHtml = t[1];
    const celulas = [...linhaHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]);
    if (celulas.length < 2) continue;

    const rotulo = celulas[0].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rotulo) continue;

    const celulaValor = celulas.slice(1).join(' ');
    const inputValor = (celulaValor.match(/<input[^>]*value=["']([^"']*)["']/i) || [])[1];
    const inputNome = (celulaValor.match(/<input[^>]*name=["']([^"']+)["']/i) || [])[1];
    const selectNome = (celulaValor.match(/<select[^>]*name=["']([^"']+)["']/i) || [])[1];
    const selecionado = (celulaValor.match(/<option[^>]*selected[^>]*>([\s\S]*?)<\/option>/i) || [])[1];
    const textoPuro = celulaValor.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    const valor = inputValor ?? (selecionado ? selecionado.replace(/<[^>]+>/g, '').trim() : textoPuro);
    if (!valor && !inputNome && !selectNome) continue;

    registros.push({
      parametro: rotulo,
      campo: inputNome || selectNome || '',
      valor: valor || '',
    });
  }

  return registros;
}

// Relatórios da API JSON oficial (api.worklabweb.com.br): POST com filtros e linhas em array.
export async function fetchApiReport(
  apiClient: AxiosInstance,
  apiPath: string,
  corpo: Record<string, unknown>,
): Promise<Record<string, any>[]> {
  const response = await apiClient.post(apiPath, corpo);
  const data = response.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && typeof data === 'object') {
    // Objeto único (ex.: estatísticas aninhadas) vira um snapshot completo
    return [{ __snapshot: true, payload: data }];
  }
  return [];
}
