import express from 'express';
import cors from 'cors';
import path from 'path';
import { ENV } from './config/env';
import apiRoutes from './routes/api';
import { WorklabCollector } from './services/worklabCollector';
import { Scheduler } from './services/scheduler';
import { SettingsService } from './services/settingsService';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estaticos do frontend
app.use(express.static(path.join(__dirname, '../public')));

// Rotas da API REST
app.use('/api/v1', apiRoutes);

// Fallback para a SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(ENV.PORT, () => {
  console.log('==============================================');
  console.log(`api-worklabweb rodando na porta ${ENV.PORT}`);
  console.log(`Frontend: http://localhost:${ENV.PORT}`);
  console.log(`API: http://localhost:${ENV.PORT}/api/v1`);
  console.log('==============================================');

  // Modo "somente frontend": serve a API e o painel sem conectar ao WorkLab.
  if (process.env.FRONTEND_ONLY === 'true') {
    console.log('[app] Modo frontend-only: coletor e sincronizacao desativados.');
    return;
  }

  // Sincronizacao inicial de atendimentos (somente se o coletor estiver ligado)
  if (SettingsService.isCollectorEnabled()) {
    WorklabCollector.runSync().catch((err) => console.error('[app] Sync inicial falhou:', err.message));
  }

  // Timer da sincronizacao de atendimentos
  const intervalMs = Math.max(1, SettingsService.getNumber('sync_interval_minutes', ENV.SYNC_INTERVAL_MINUTES)) * 60 * 1000;
  setInterval(() => {
    if (SettingsService.isCollectorEnabled()) {
      WorklabCollector.runSync().catch((err) => console.error('[app] Sync atendimentos falhou:', err.message));
    }
  }, intervalMs);

  // Agendador dos modulos de captura (orçamentos, fichario, cadastros, etc.)
  Scheduler.start();
});

export default app;
