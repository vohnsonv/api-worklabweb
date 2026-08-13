document.addEventListener('DOMContentLoaded', () => {
  // Navegação por Abas
  const navItems = document.querySelectorAll('.nav-item');
  const tabViews = document.querySelectorAll('.tab-view');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');

      navItems.forEach(n => n.classList.remove('active'));
      tabViews.forEach(v => v.classList.remove('active'));

      item.classList.add('active');
      const activeView = document.getElementById(targetTab);
      if (activeView) activeView.classList.add('active');
    });
  });

  // Event Listeners Globais
  document.getElementById('btn-refresh').addEventListener('click', loadAllData);
  document.getElementById('btn-trigger-sync').addEventListener('click', triggerManualSync);
  document.getElementById('btn-trigger-historical').addEventListener('click', triggerHistoricalSync);
  document.getElementById('form-create-webhook').addEventListener('submit', createWebhook);

  document.getElementById('search-atendimentos').addEventListener('input', loadFullAtendimentos);
  document.getElementById('filter-status').addEventListener('change', loadFullAtendimentos);

  // Carregar dados iniciais
  loadAllData();

  // Atualização periódica a cada 10 segundos
  setInterval(loadStats, 10000);
});

// Utility para formatação de moeda em BRL
function formatCurrency(val) {
  const num = parseFloat(val || 0);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Utility para formatação de data no fuso de Recife (America/Recife - UTC-3)
function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Recife',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (e) {
    return dateStr;
  }
}

// 1. Carregar Estatísticas Gerais
async function loadStats() {
  try {
    const res = await fetch('/api/v1/stats');
    const data = await res.json();

    if (data.success && data.stats) {
      const { totalAtendimentos, laudosConcluidos, webhooksAtivos, taxaSucessoWebhook, totalFaturado, mesesHistoricosConcluidos, ultimaSync } = data.stats;

      document.getElementById('stat-total-atendimentos').textContent = totalAtendimentos.toLocaleString();
      document.getElementById('stat-total-faturado').textContent = formatCurrency(totalFaturado);
      document.getElementById('stat-laudos-concluidos').textContent = laudosConcluidos.toLocaleString();
      document.getElementById('stat-webhooks-ativos').textContent = webhooksAtivos.toLocaleString();

      if (ultimaSync) {
        const dateStr = formatDate(ultimaSync.executed_at);
        document.getElementById('txt-last-sync').textContent = `Última sync: ${dateStr} (${ultimaSync.status})`;
      } else {
        document.getElementById('txt-last-sync').textContent = 'Última sync: Nenhuma';
      }
    }
  } catch (err) {
    console.error('Erro ao carregar estatísticas:', err);
  }
}

// 2. Carregar Atendimentos Recentes (Tab Visão Geral)
async function loadRecentAtendimentos() {
  try {
    const res = await fetch('/api/v1/atendimentos?limit=6');
    const data = await res.json();

    const tbody = document.getElementById('tbl-recent-atendimentos');
    if (!data.success || !data.data || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">Nenhum atendimento encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = data.data.map(item => `
      <tr>
        <td><strong>${item.protocolo}</strong></td>
        <td>${item.paciente_nome}</td>
        <td><code style="font-size: 0.75rem;">${item.cpf || '-'}</code></td>
        <td>${item.data_cadastro || '-'}</td>
        <td>${item.convenio || '-'}</td>
        <td><strong style="color: var(--accent-cyan);">${formatCurrency(item.valor_final)}</strong></td>
        <td>
          <span class="badge ${item.status_laudo === 'CONCLUIDO' ? 'badge-success' : 'badge-warning'}">
            ${item.status_laudo}
          </span>
        </td>
        <td>
          ${item.status_laudo === 'CONCLUIDO' ? `
            <a href="/api/v1/atendimentos/${item.id}/pdf" target="_blank" class="btn btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;">
              📄 Ver PDF
            </a>
          ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Em análise</span>'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar atendimentos recentes:', err);
  }
}

// 3. Carregar Listagem Completa de Atendimentos (Tab Atendimentos & Exames)
async function loadFullAtendimentos() {
  try {
    const search = document.getElementById('search-atendimentos').value;
    const status = document.getElementById('filter-status').value;

    const url = new URL('/api/v1/atendimentos', window.location.origin);
    url.searchParams.append('limit', '50');
    if (search) url.searchParams.append('search', search);
    if (status) url.searchParams.append('status', status);

    const res = await fetch(url);
    const data = await res.json();

    const tbody = document.getElementById('tbl-full-atendimentos');
    if (!data.success || !data.data || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">Nenhum registro encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = data.data.map(item => {
      const examesList = Array.isArray(item.exames) ? item.exames.map(e => e.codigo_exame || e.nome_exame).join(', ') : '-';

      return `
        <tr>
          <td><strong>${item.protocolo}</strong></td>
          <td>
            <div>${item.paciente_nome}</div>
            <code style="font-size: 0.75rem; color: var(--text-muted);">${item.cpf ? 'CPF: ' + item.cpf : ''}</code>
          </td>
          <td>${item.data_cadastro || '-'}</td>
          <td>
            <div>${item.convenio || '-'}</div>
            <small style="color: var(--text-muted);">${item.unidade || ''}</small>
          </td>
          <td><small>${item.atendente || '-'}</small></td>
          <td><strong style="color: var(--accent-cyan);">${formatCurrency(item.valor_final)}</strong></td>
          <td><small style="max-width: 180px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${examesList || '-'}</small></td>
          <td>
            <span class="badge ${item.status_laudo === 'CONCLUIDO' ? 'badge-success' : 'badge-warning'}">
              ${item.status_laudo}
            </span>
          </td>
          <td>
            ${item.status_laudo === 'CONCLUIDO' ? `
              <a href="/api/v1/atendimentos/${item.id}/pdf" target="_blank" class="btn btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
                Download PDF
              </a>
            ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Aguardando laudo</span>'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar atendimentos completos:', err);
  }
}

// 4. Carregar Webhooks Cadastrados (Tab Webhooks)
async function loadWebhooks() {
  try {
    const res = await fetch('/api/v1/webhooks');
    const data = await res.json();

    const tbody = document.getElementById('tbl-webhooks');
    if (!data.success || !data.data || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Nenhum webhook cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = data.data.map(wh => `
      <tr>
        <td>#${wh.id}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <a href="${wh.url}" target="_blank" style="color: var(--accent-cyan); text-decoration: none;">${wh.url}</a>
        </td>
        <td>${wh.description || '-'}</td>
        <td><span class="badge badge-warning">${wh.events}</span></td>
        <td><code>${wh.secret}</code></td>
        <td>
          <button onclick="testWebhook(${wh.id})" class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; margin-right: 0.25rem;">
            ⚡ Testar
          </button>
          <button onclick="deleteWebhook(${wh.id})" class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: var(--danger);">
            🗑 Excluir
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar webhooks:', err);
  }
}

// 5. Cadastrar Novo Webhook
async function createWebhook(e) {
  e.preventDefault();

  const url = document.getElementById('webhook-url').value;
  const description = document.getElementById('webhook-desc').value;
  const events = document.getElementById('webhook-events').value;
  const secret = document.getElementById('webhook-secret').value;

  try {
    const res = await fetch('/api/v1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, description, events, secret })
    });

    const data = await res.json();
    if (data.success) {
      alert('Webhook cadastrado com sucesso!');
      document.getElementById('form-create-webhook').reset();
      loadWebhooks();
      loadStats();
    } else {
      alert('Erro ao cadastrar webhook: ' + data.error);
    }
  } catch (err) {
    alert('Erro de conexão ao cadastrar webhook.');
  }
}

async function testWebhook(id) {
  try {
    const res = await fetch(`/api/v1/webhooks/${id}/test`, { method: 'POST' });
    const data = await res.json();
    alert(data.message);
    loadLogs();
  } catch (err) {
    alert('Erro ao testar webhook.');
  }
}

async function deleteWebhook(id) {
  if (!confirm('Deseja realmente excluir este webhook?')) return;

  try {
    const res = await fetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadWebhooks();
      loadStats();
    }
  } catch (err) {
    alert('Erro ao excluir webhook.');
  }
}

// 6. Carregar Logs de Auditoria (Tab Logs)
async function loadLogs() {
  try {
    const resWh = await fetch('/api/v1/logs/webhook');
    const dataWh = await resWh.json();
    const tbodyWh = document.getElementById('tbl-webhook-logs');

    if (dataWh.success && dataWh.data && dataWh.data.length > 0) {
      tbodyWh.innerHTML = dataWh.data.map(log => `
        <tr>
          <td>${formatDate(log.executed_at)}</td>
          <td><span class="badge badge-warning">${log.event}</span></td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${log.url || 'Webhook Excluído'}</td>
          <td><code>${log.status_code || 500}</code></td>
          <td>${log.attempt_count}</td>
          <td>
            <span class="badge ${log.success ? 'badge-success' : 'badge-danger'}">
              ${log.success ? 'SUCESSO' : 'FALHA'}
            </span>
          </td>
        </tr>
      `).join('');
    } else {
      tbodyWh.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Nenhum log de webhook registrado.</td></tr>';
    }

    const resSync = await fetch('/api/v1/logs/sync');
    const dataSync = await resSync.json();
    const tbodySync = document.getElementById('tbl-sync-logs');

    if (dataSync.success && dataSync.data && dataSync.data.length > 0) {
      tbodySync.innerHTML = dataSync.data.map(log => `
        <tr>
          <td>${formatDate(log.executed_at)}</td>
          <td>
            <span class="badge ${log.status === 'SUCCESS' ? 'badge-success' : 'badge-danger'}">
              ${log.status}
            </span>
          </td>
          <td>${log.atendimentos_encontrados}</td>
          <td>${log.novos_atendimentos}</td>
          <td>${log.laudos_baixados}</td>
          <td>${log.webhooks_disparados}</td>
          <td>${log.error_message || '-'}</td>
        </tr>
      `).join('');
    } else {
      tbodySync.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Nenhum log de sincronização registrado.</td></tr>';
    }
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
  }
}

// 7. Sincronização Manual
async function triggerManualSync() {
  const btn = document.getElementById('btn-trigger-sync');
  btn.disabled = true;
  btn.textContent = 'Sincronizando...';

  try {
    const res = await fetch('/api/v1/sync/trigger', { method: 'POST' });
    const data = await res.json();
    alert(data.message);

    setTimeout(() => {
      loadAllData();
      btn.disabled = false;
      btn.innerHTML = '⚡ Sincronizar Agora';
    }, 2000);
  } catch (err) {
    alert('Erro ao disparar sincronização manual.');
    btn.disabled = false;
  }
}

// 8. Carga Histórica Retroativa (2020-2026)
async function triggerHistoricalSync() {
  if (!confirm('Deseja iniciar a Carga Histórica Retroativa (2020 a 2026)? Este processo executará a varredura em segundo plano no servidor.')) return;

  const btn = document.getElementById('btn-trigger-historical');
  btn.disabled = true;
  btn.textContent = 'Processando 2020-2026...';

  try {
    const res = await fetch('/api/v1/sync/historical', { method: 'POST' });
    const data = await res.json();
    alert(data.message);

    setTimeout(() => {
      loadAllData();
      btn.disabled = false;
      btn.textContent = '⏳ Carga Histórica (2020-2026)';
    }, 2000);
  } catch (err) {
    alert('Erro ao disparar carga histórica.');
    btn.disabled = false;
  }
}

function loadAllData() {
  loadStats();
  loadRecentAtendimentos();
  loadFullAtendimentos();
  loadWebhooks();
  loadLogs();
}
