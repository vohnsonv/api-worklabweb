// Painel de integracao WorkLab Web - logica do frontend
const state = {
  modules: [],
  currentView: 'overview'
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  initTheme();
  ensureApiKey();
  bindNav();
  bindGlobalButtons();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeInfoModal();
  });
  await loadCollectorStatus();
  await loadModules();
  await loadStats();
  renderView('overview');
  setInterval(loadStats, 10000);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey() {
  return localStorage.getItem('wl_api_key') || '';
}

function ensureApiKey() {
  if (localStorage.getItem('wl_api_key')) return;
  const key = window.prompt('Informe a API key para acessar o painel WorkLab:');
  if (key && key.trim()) {
    localStorage.setItem('wl_api_key', key.trim());
  }
}

async function api(path, opts = {}) {
  const res = await fetch('/api/v1' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) {
    localStorage.removeItem('wl_api_key');
  }
  return res.json();
}

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(val) {
  const num = parseFloat(val || 0);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setTitle(title, subtitle) {
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle || '';
}

// ---------------------------------------------------------------------------
// Navegacao
// ---------------------------------------------------------------------------

function bindNav() {
  document.getElementById('nav-menu').addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    const view = item.getAttribute('data-view');
    setActiveNav(item);
    renderView(view);
  });
}

function setActiveNav(activeItem) {
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  if (activeItem) activeItem.classList.add('active');
}

async function loadModules() {
  const data = await api('/modules');
  if (!data.success) return;
  state.modules = data.data;

  const container = document.getElementById('nav-modules');
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';
  container.innerHTML = state.modules
    .map((m) => `<div class="nav-item" data-view="module:${m.key}">${icon}<span>${esc(m.label)}</span></div>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function renderView(view) {
  state.currentView = view;
  const content = document.getElementById('tab-content');

  if (view === 'overview') renderOverview(content);
  else if (view === 'atendimentos') renderAtendimentos(content);
  else if (view === 'exames') renderExames(content);
  else if (view === 'webhooks') renderWebhooks(content);
  else if (view === 'logs') renderLogs(content);
  else if (view === 'config') renderConfig(content);
  else if (view.startsWith('module:')) renderModuleView(content, view.slice(7));
}

// --- Visao Geral ---
function renderOverview(content) {
  setTitle('Painel de Controle | API', 'Gerenciamento, monitoramento, ajustes, configurações');
  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header"><h3>Atendimentos recentes</h3></div>
      <div class="table-wrap"><table class="data-table" id="tbl-recent"></table></div>
    </div>
    <div class="panel-card">
      <div class="panel-header"><h3>Registros por módulo</h3></div>
      <div class="table-wrap"><table class="data-table" id="tbl-modules"></table></div>
    </div>
  `;
  loadRecentAtendimentos();
  loadModuleCounts();
}

async function loadRecentAtendimentos() {
  const data = await api('/atendimentos?limit=8');
  const tbody = document.getElementById('tbl-recent');
  if (!tbody) return;

  if (!data.success || !data.data || data.data.length === 0) {
    tbody.innerHTML = '<thead><tr><th>Nenhum atendimento</th></tr></thead>';
    return;
  }

  const headers = ['Protocolo', 'Paciente', 'CPF', 'Data', 'Convênio', 'Valor'];
  const rows = data.data.map((a) => [
    esc(a.protocolo), esc(a.paciente_nome), esc(a.cpf || '-'), esc(a.data_cadastro || '-'), esc(a.convenio || '-'), formatCurrency(a.valor_final)
  ]);
  tbody.innerHTML = buildTable(headers, rows);
}

async function loadModuleCounts() {
  const data = await api('/stats');
  const tbody = document.getElementById('tbl-modules');
  if (!tbody || !data.success) return;

  const counts = data.stats.moduleCounts || [];
  if (counts.length === 0) {
    tbody.innerHTML = '<thead><tr><th>Nenhum módulo sincronizado ainda</th></tr></thead>';
    return;
  }
  const headers = ['Módulo', 'Registros'];
  const rows = counts.map((c) => [esc(c.module), c.c]);
  tbody.innerHTML = buildTable(headers, rows);
}

// --- Atendimentos ---
function renderAtendimentos(content) {
  setTitle('Atendimentos', 'Busca por protocolo, nome, CPF ou atendente');
  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h3>Atendimentos</h3>
        <input type="text" class="input-control" id="search-atendimentos" placeholder="Buscar...">
      </div>
      <div class="table-wrap"><table class="data-table" id="tbl-atendimentos"></table></div>
    </div>
  `;
  document.getElementById('search-atendimentos').addEventListener('input', loadAtendimentos);
  loadAtendimentos();
}

async function loadAtendimentos() {
  const search = document.getElementById('search-atendimentos')?.value || '';
  const data = await api('/atendimentos?limit=100' + (search ? `&search=${encodeURIComponent(search)}` : ''));
  const table = document.getElementById('tbl-atendimentos');
  if (!table || !data.success) return;

  const headers = ['Protocolo', 'Paciente', 'CPF', 'Data', 'Unidade', 'Convênio', 'Atendente', 'Valor', 'Exames'];
  const rows = (data.data || []).map((a) => {
    const exames = Array.isArray(a.exames) ? a.exames.map((e) => e.codigo_exame || e.nome_exame).join(', ') : '-';
    return [esc(a.protocolo), esc(a.paciente_nome), esc(a.cpf || '-'), esc(a.data_cadastro || '-'), esc(a.unidade || '-'), esc(a.convenio || '-'), esc(a.atendente || '-'), formatCurrency(a.valor_final), esc(exames)];
  });
  table.innerHTML = buildTable(headers, rows);
}

// --- Exames ---
function renderExames(content) {
  setTitle('Exames', 'Exames dos atendimentos');
  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h3>Exames</h3>
        <input type="text" class="input-control" id="search-exames" placeholder="Buscar...">
      </div>
      <div class="table-wrap"><table class="data-table" id="tbl-exames"></table></div>
    </div>
  `;
  document.getElementById('search-exames').addEventListener('input', loadExames);
  loadExames();
}

async function loadExames() {
  const search = document.getElementById('search-exames')?.value || '';
  const data = await api('/exames?limit=100' + (search ? `&search=${encodeURIComponent(search)}` : ''));
  const table = document.getElementById('tbl-exames');
  if (!table || !data.success) return;

  const headers = ['Paciente', 'Protocolo', 'Código', 'Exame', 'Seção', 'Valor'];
  const rows = (data.data || []).map((e) => [
    esc(e.paciente_nome || '-'), esc(e.protocolo || '-'), esc(e.codigo_exame || '-'), esc(e.nome_exame), esc(e.secao_sigla || '-'), formatCurrency(e.valor)
  ]);
  table.innerHTML = buildTable(headers, rows);
}

// --- Modulo generico ---
function renderModuleView(content, key) {
  const mod = state.modules.find((m) => m.key === key);
  if (!mod) { content.innerHTML = '<p>Módulo não encontrado.</p>'; return; }

  setTitle(mod.label, `Dados capturados do WorkLab · intervalo ${mod.intervalMin} min`);
  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h3>${esc(mod.label)}</h3>
        <div class="panel-actions">
          <button class="btn btn-ghost btn-info" onclick="openInfoModal('${esc(key)}')" title="Como é capturado" aria-label="Como é capturado">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </button>
          <span class="muted">Intervalo: ${mod.intervalMin} min</span>
          <button class="btn btn-secondary" onclick="syncModule('${esc(key)}')">Sincronizar agora</button>
          <a class="btn btn-secondary" href="/api/v1/export/${esc(key)}.csv?key=${encodeURIComponent(getApiKey())}" target="_blank">Exportar CSV</a>
        </div>
      </div>
      <div class="table-wrap"><table class="data-table" id="tbl-module"></table></div>
    </div>
  `;
  loadModuleData(key);
}

async function loadModuleData(key) {
  const table = document.getElementById('tbl-module');
  if (!table) return;
  table.innerHTML = '<thead><tr><th>Carregando...</th></tr></thead>';

  const data = await api(`/data/${key}?limit=200`);
  if (!data.success || !data.data || data.data.length === 0) {
    table.innerHTML = '<thead><tr><th>Sem registros capturados ainda.</th></tr></thead>';
    return;
  }

  const columns = collectColumns(data.data);
  const headers = columns.map((c) => esc(c));
  const rows = data.data.map((row) => columns.map((c) => {
    const v = row[c];
    return typeof v === 'object' ? esc(JSON.stringify(v)) : esc(v);
  }));

  table.innerHTML = buildTable(headers, rows, true);
}

function collectColumns(rows) {
  const set = new Set();
  const preferred = ['record_id', 'synced_at'];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!k.startsWith('__')) set.add(k);
    }
  }
  const all = Array.from(set);
  return preferred.filter((p) => all.includes(p)).concat(all.filter((c) => !preferred.includes(c))).slice(0, 20);
}

async function syncModule(key) {
  const data = await api(`/sync/module/${key}`, { method: 'POST' });
  alert(data.message || 'Sincronização iniciada.');
  setTimeout(() => loadModuleData(key), 3000);
}

// --- Modal de detalhes de captura ---
function openInfoModal(key) {
  const mod = state.modules.find((m) => m.key === key);
  const d = mod && mod.detail;
  if (!d) return;

  const body = document.getElementById('info-modal-body');
  body.innerHTML = `
    <h2 class="info-title">${esc(d.label)}</h2>
    <p class="info-desc">${esc(d.description)}</p>
    <div class="info-grid">
      <div class="info-row"><span class="info-key">Fonte / origem</span><span class="info-val">${esc(d.source)}</span></div>
      <div class="info-row"><span class="info-key">Tipo de captura</span><span class="info-val">${esc(d.kindLabel)}</span></div>
      <div class="info-row"><span class="info-key">Como funciona</span><span class="info-val">${esc(d.kindDescription)}</span></div>
      <div class="info-row"><span class="info-key">Requisição</span><span class="info-val"><code>${esc(d.requestFormat)}</code></span></div>
      <div class="info-row"><span class="info-key">Identificação</span><span class="info-val">${esc(d.identifier)}</span></div>
      <div class="info-row"><span class="info-key">Armazenamento</span><span class="info-val">${esc(d.storage)}</span></div>
      <div class="info-row"><span class="info-key">Frequência</span><span class="info-val">${esc(d.interval)}</span></div>
      <div class="info-row"><span class="info-key">Configuração</span><span class="info-val"><code>${esc(d.intervalKey)}</code></span></div>
    </div>
    ${d.notes ? `<p class="info-notes">${esc(d.notes)}</p>` : ''}
  `;
  document.getElementById('info-modal').classList.add('open');
}

function closeInfoModal() {
  document.getElementById('info-modal').classList.remove('open');
}

// --- Webhooks ---
function renderWebhooks(content) {
  setTitle('Webhooks', 'Endpoints que recebem eventos de novo atendimento');
  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header"><h3>Cadastrar webhook</h3></div>
      <form id="form-webhook">
        <div class="form-row">
          <div class="form-group"><label>URL</label><input class="input-control" id="wh-url" type="url" required></div>
          <div class="form-group"><label>Descrição</label><input class="input-control" id="wh-desc"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Eventos</label><input class="input-control" id="wh-events" value="novo_atendimento"></div>
          <div class="form-group"><label>Segredo HMAC</label><input class="input-control" id="wh-secret" placeholder="opcional"></div>
        </div>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </form>
    </div>
    <div class="panel-card">
      <div class="panel-header"><h3>Webhooks ativos</h3></div>
      <div class="table-wrap"><table class="data-table" id="tbl-webhooks"></table></div>
    </div>
  `;
  document.getElementById('form-webhook').addEventListener('submit', createWebhook);
  loadWebhooks();
}

async function loadWebhooks() {
  const data = await api('/webhooks');
  const table = document.getElementById('tbl-webhooks');
  if (!table || !data.success) return;
  const headers = ['ID', 'URL', 'Descrição', 'Eventos', 'Ações'];
  const rows = (data.data || []).map((w) => [
    '#' + w.id,
    esc(w.url),
    esc(w.description || '-'),
    esc(w.events),
    `<button class="btn btn-secondary btn-sm" onclick="testWebhook(${w.id})">Testar</button>
     <button class="btn btn-secondary btn-sm danger" onclick="deleteWebhook(${w.id})">Excluir</button>`
  ]);
  table.innerHTML = buildTable(headers, rows, true);
}

async function createWebhook(e) {
  e.preventDefault();
  const body = {
    url: document.getElementById('wh-url').value,
    description: document.getElementById('wh-desc').value,
    events: document.getElementById('wh-events').value,
    secret: document.getElementById('wh-secret').value
  };
  const data = await api('/webhooks', { method: 'POST', body: JSON.stringify(body) });
  alert(data.success ? 'Webhook salvo.' : 'Erro: ' + data.error);
  if (data.success) { loadWebhooks(); loadStats(); }
}

async function testWebhook(id) {
  const data = await api(`/webhooks/${id}/test`, { method: 'POST' });
  alert(data.message);
}

async function deleteWebhook(id) {
  if (!confirm('Excluir este webhook?')) return;
  await api(`/webhooks/${id}`, { method: 'DELETE' });
  loadWebhooks();
}

// --- Logs ---
function renderLogs(content) {
  setTitle('Logs', 'Histórico de sincronizações e disparos');
  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header"><h3>Sincronizações</h3></div>
      <div class="table-wrap"><table class="data-table" id="tbl-sync-logs"></table></div>
    </div>
    <div class="panel-card">
      <div class="panel-header"><h3>Disparos de webhook</h3></div>
      <div class="table-wrap"><table class="data-table" id="tbl-webhook-logs"></table></div>
    </div>
  `;
  loadLogs();
}

async function loadLogs() {
  const sync = await api('/logs/sync');
  const t1 = document.getElementById('tbl-sync-logs');
  if (t1 && sync.success) {
    const headers = ['Data', 'Módulo', 'Status', 'Encontrados', 'Novos', 'Erro'];
    const rows = (sync.data || []).map((l) => [formatDate(l.executed_at), esc(l.module || 'atendimentos'), esc(l.status), l.registros_encontrados, l.novos_registros, esc(l.error_message || '-')]);
    t1.innerHTML = buildTable(headers, rows);
  }

  const wh = await api('/logs/webhook');
  const t2 = document.getElementById('tbl-webhook-logs');
  if (t2 && wh.success) {
    const headers = ['Data', 'Evento', 'Status', 'Tentativas'];
    const rows = (wh.data || []).map((l) => [formatDate(l.executed_at), esc(l.event), l.success ? 'OK' : 'FALHA', l.attempt_count]);
    t2.innerHTML = buildTable(headers, rows);
  }
}

// --- Configuracoes ---
function renderConfig(content) {
  setTitle('Configurações', 'Credenciais do WorkLab e intervalos de captura');
  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header"><h3>Conexão com o WorkLab</h3></div>
      <div class="form-row">
        <div class="form-group"><label>ID do laboratório</label><input class="input-control" id="cfg-client"></div>
        <div class="form-group"><label>Usuário</label><input class="input-control" id="cfg-user"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Senha</label><input class="input-control" id="cfg-pass" type="password" placeholder="********"></div>
        <div class="form-group"><label>URL de login</label><input class="input-control" id="cfg-url"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Intervalo de sync (min)</label><input class="input-control" id="cfg-interval" type="number"></div>
        <div class="form-group"><label>Janela de captura (meses)</label><input class="input-control" id="cfg-window" type="number"></div>
      </div>
      <button class="btn btn-primary" onclick="saveConfig()">Salvar configurações</button>
    </div>
    <div class="panel-card">
      <div class="panel-header"><h3>Intervalo por módulo (minutos)</h3></div>
      <div class="table-wrap"><table class="data-table" id="tbl-module-intervals"></table></div>
      <button class="btn btn-primary" onclick="saveModuleIntervals()">Salvar intervalos</button>
    </div>
  `;
  loadConfig();
}

async function loadConfig() {
  const data = await api('/settings');
  if (!data.success) return;
  const s = data.data;
  document.getElementById('cfg-client').value = s.worklab_client_id || '';
  document.getElementById('cfg-user').value = s.worklab_user || '';
  document.getElementById('cfg-pass').value = '';
  document.getElementById('cfg-url').value = s.worklab_url || '';
  document.getElementById('cfg-interval').value = s.sync_interval_minutes || '1';
  document.getElementById('cfg-window').value = s.sync_window_months || '5';

  const headers = ['Módulo', 'Intervalo (min)'];
  const rows = state.modules.map((m) => [
    esc(m.label),
    `<input type="number" class="input-control" id="iv-${esc(m.key)}" value="${m.intervalMin}" min="0">`
  ]);
  document.getElementById('tbl-module-intervals').innerHTML = buildTable(headers, rows, true);
}

async function saveConfig() {
  const body = {
    worklab_client_id: document.getElementById('cfg-client').value,
    worklab_user: document.getElementById('cfg-user').value,
    worklab_url: document.getElementById('cfg-url').value,
    sync_interval_minutes: document.getElementById('cfg-interval').value,
    sync_window_months: document.getElementById('cfg-window').value
  };
  const pass = document.getElementById('cfg-pass').value;
  if (pass && pass !== '********') body.worklab_password = pass;

  const data = await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
  alert(data.success ? 'Configurações salvas.' : 'Erro: ' + data.error);
}

async function saveModuleIntervals() {
  const body = {};
  state.modules.forEach((m) => {
    const el = document.getElementById('iv-' + m.key);
    if (el) body[`module.${m.key}.interval_minutes`] = el.value;
  });
  const data = await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
  alert(data.success ? 'Intervalos salvos.' : 'Erro: ' + data.error);
}

// ---------------------------------------------------------------------------
// Botoes globais
// ---------------------------------------------------------------------------

function bindGlobalButtons() {
  document.getElementById('btn-refresh').addEventListener('click', () => { loadStats(); renderView(state.currentView); });
  document.getElementById('btn-trigger-sync').addEventListener('click', triggerSync);
  document.getElementById('btn-trigger-historical').addEventListener('click', triggerHistorical);
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('collector-toggle').addEventListener('change', toggleCollector);
}

// ---------------------------------------------------------------------------
// Coletor (ligar/desligar)
// ---------------------------------------------------------------------------

async function loadCollectorStatus() {
  const data = await api('/collector/status');
  applyCollectorState(data && data.enabled !== false);
}

function applyCollectorState(enabled) {
  const toggle = document.getElementById('collector-toggle');
  const label = document.getElementById('collector-status-label');
  const dot = document.getElementById('collector-dot');
  const card = dot ? dot.closest('.collector-status-card') : null;

  if (toggle) toggle.checked = enabled;
  if (label) label.textContent = enabled ? 'Coletor ativo' : 'Coletor desligado';
  if (dot) dot.classList.toggle('off', !enabled);
  if (card) card.classList.toggle('off', !enabled);
}

async function toggleCollector() {
  const data = await api('/collector/toggle', { method: 'POST' });
  applyCollectorState(data && data.enabled !== false);
}

// Tema claro/escuro (persistido no navegador)
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(current);
  localStorage.setItem('theme', current);
}

async function triggerSync() {
  const data = await api('/sync/trigger', { method: 'POST' });
  alert(data.message);
  setTimeout(loadStats, 3000);
}

async function triggerHistorical() {
  if (!confirm('Iniciar carga histórica retroativa (2020 até hoje)?')) return;
  const data = await api('/sync/historical', { method: 'POST' });
  alert(data.message);
}

async function loadStats() {
  const data = await api('/stats');
  if (!data.success || !data.stats) return;
  const s = data.stats;
  document.getElementById('stat-atendimentos').textContent = (s.totalAtendimentos || 0).toLocaleString('pt-BR');
  document.getElementById('stat-exames').textContent = (s.totalExames || 0).toLocaleString('pt-BR');
  document.getElementById('stat-faturado').textContent = formatCurrency(s.totalFaturado);
  document.getElementById('stat-webhooks').textContent = s.webhooksAtivos || 0;

  if (s.ultimaSync) {
    document.getElementById('txt-last-sync').textContent = `Última sync: ${formatDate(s.ultimaSync.executed_at)} (${s.ultimaSync.status})`;
  }
}

// ---------------------------------------------------------------------------
// Construcao de tabelas
// ---------------------------------------------------------------------------

function buildTable(headers, rows, rawActions = false) {
  const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return thead + tbody;
}
