import express from 'express';
import cors from 'cors';
import path from 'path';
import { ENV } from './config/env';
import apiRoutes from './routes/api';
import { WorklabCollector } from './services/worklabCollector';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos do Dashboard Frontend
app.use(express.static(path.join(__dirname, '../public')));

// Rotas da API REST
app.use('/api/v1', apiRoutes);

// Fallback para servir a página inicial do Dashboard SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Inicialização do Servidor
app.listen(ENV.PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 api-worklabweb Servidor Rodando na porta ${ENV.PORT}`);
  console.log(`📊 Dashboard Frontend: http://localhost:${ENV.PORT}`);
  console.log(`🔌 API REST: http://localhost:${ENV.PORT}/api/v1`);
  console.log(`⏱️ Sincronização 24/7 configurada para cada ${ENV.SYNC_INTERVAL_MINUTES} minuto(s)`);
  console.log(`=======================================================`);

  // Executar sincronização inicial ao subir o servidor
  WorklabCollector.runSync();

  // Configurar timer contínuo de sincronização 24/7
  const intervalMs = Math.max(1, ENV.SYNC_INTERVAL_MINUTES) * 60 * 1000;
  setInterval(() => {
    WorklabCollector.runSync();
  }, intervalMs);
});

export default app;
