import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  WORKLAB_URL: process.env.WORKLAB_URL || 'https://www.worklabweb.com.br/index.php',
  WORKLAB_ID: process.env.WORKLAB_ID || '881/0',
  WORKLAB_PASSWORD: process.env.WORKLAB_PASSWORD || 'SUA_SENHA_AQUI',
  SYNC_INTERVAL_MINUTES: parseInt(process.env.SYNC_INTERVAL_MINUTES || '1', 10),
  DB_PATH: path.resolve(process.env.DB_PATH || './data/worklab.db'),
  API_KEY: process.env.API_KEY || 'SUA_CHAVE_API_AQUI'
};

// Garante que o diretorio do banco exista
const dbDir = path.dirname(ENV.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
