# api-worklabweb

Coletor e API de integração com o sistema **WorkLab Web** (laboratório de análises clínicas).

A aplicação autentica no WorkLab, extrai dados de diversos módulos (atendimentos, exames, orçamentos, fichário, cadastros e relatórios) em intervalos configuráveis, guarda tudo em SQLite e expõe via API REST + painel web.

## Funcionalidades

- **Autenticação automática** via Chromium headless (Playwright), com reuso de sessão por 30 minutos.
- **Coletor modular**: cada módulo do WorkLab tem endpoint e intervalo próprios.
  - Orçamentos e fichário a cada 2 minutos.
  - Relatórios operacionais (status dos exames, movimento diário, particular em atraso) em intervalos próprios.
  - Cadastros (médicos, exames, convênios, tabelas de preços, modelos, etc.) diariamente.
  - Laudos (modelos XML) sob demanda.
- **Sincronização de atendimentos** em janela configurável (padrão 5 meses) + carga histórica retroativa.
- **Webhooks** com assinatura HMAC SHA-256 e retry.
- **Configurações editáveis** pelo painel (credenciais e intervalos), persistidas em SQLite.
- **Painel web** com visão por módulo, busca e exportação CSV.

## Stack

Node.js + TypeScript, Express, better-sqlite3, Playwright, Axios.

## Configuração

Copie `.env.example` para `.env` e preencha:

| Variável | Descrição |
|---|---|
| `PORT` | Porta HTTP (padrão `3000`) |
| `WORKLAB_URL` | URL de login do WorkLab |
| `WORKLAB_ID` | Usuário no formato `clientId/user` (ex.: `881/0`) |
| `WORKLAB_PASSWORD` | Senha |
| `SYNC_INTERVAL_MINUTES` | Intervalo da sincronização de atendimentos |
| `DB_PATH` | Caminho do SQLite |
| `API_KEY` | Chave de API (reservada) |

As credenciais também podem ser alteradas em tempo de execução pela aba **Configurações** do painel (gravadas na tabela `settings`).

## Executar

```bash
npm install
npx playwright install chromium
npm run build
npm start
```

Modo desenvolvimento:

```bash
npm run dev
```

Docker:

```bash
docker-compose up -d --build
```

## Estrutura

```
src/
├── app.ts                    # entrada Express + agendamento
├── config/env.ts             # variáveis de ambiente
├── db/database.ts            # schema SQLite + migrations
├── routes/api.ts             # endpoints REST
├── services/
│   ├── worklabAuth.ts        # login + clientes HTTP
│   ├── worklabCollector.ts   # atendimentos/exames + carga histórica
│   ├── modules.ts            # catálogo de módulos
│   ├── fetchers.ts           # jqGrid / DataTables / upsert
│   ├── scheduler.ts          # agendamento multi-intervalo
│   ├── settingsService.ts    # configurações (DB com fallback .env)
│   └── webhookDispatcher.ts  # disparo de webhooks
└── utils/dateUtils.ts        # datas no fuso America/Recife

public/                       # painel web (HTML/CSS/JS)
```

## API

Prefix: `/api/v1`

- `GET /stats` — estatísticas gerais
- `GET /modules` — catálogo de módulos com intervalo atual
- `GET/PUT /settings` — configurações
- `GET /atendimentos`, `GET /atendimentos/:id` — atendimentos
- `GET /exames` — exames dos atendimentos
- `GET /data/:module` — registros capturados de um módulo
- `POST /sync/module/:key` — dispara sincronização de um módulo
- `GET /export/:module.csv` — exporta módulo em CSV
- `POST /sync/trigger` — sincroniza atendimentos agora
- `POST /sync/historical`, `GET /sync/historical/status` — carga histórica
- `GET/POST /webhooks`, `DELETE /webhooks/:id`, `POST /webhooks/:id/test` — webhooks
- `GET /logs/sync`, `GET /logs/webhook` — logs

## Banco de dados

Tabelas principais:

- `atendimentos` e `exames` — dados de pacientes e exames.
- `capture_records` — payload JSON de cada módulo (orçamentos, fichário, cadastros, etc.).
- `settings` — configurações em tempo de execução.
- `webhooks`, `webhook_logs`, `sync_logs`, `historico_sync` — infraestrutura.

## Licença

ISC
