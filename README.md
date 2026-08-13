# API WorkLab Web — Integration & Webhook Platform 24/7

Solução completa e containerizada para integração automatizada com o sistema de laboratório de análises clínicas **WorkLab Web**.

---

## Sumário

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Stack Tecnológica](#stack-tecnológica)
4. [Estrutura de Diretórios](#estrutura-de-diretórios)
5. [Configuração — Variáveis de Ambiente](#configuração--variáveis-de-ambiente)
6. [Banco de Dados — Schema Completo](#banco-de-dados--schema-completo)
7. [API REST — Endpoints](#api-rest--endpoints)
8. [Engine de Webhooks](#engine-de-webhooks)
9. [Coletor WorkLab (WorklabCollector)](#coletor-worklab-worklabcollector)
10. [Dashboard Frontend](#dashboard-frontend)
11. [Docker — Deploy em Produção](#docker--deploy-em-produção)
12. [Desenvolvimento Local](#desenvolvimento-local)

---

## Visão Geral

O **api-worklabweb** é uma plataforma Node.js/TypeScript que atua como ponte de integração entre o sistema legado WorkLab Web (laboratório de análises clínicas) e sistemas externos. Seus três pilares são:

| Pilar | Descrição |
|---|---|
| **Coletor 24/7** | Autentica-se no WorkLab via Chromium headless (Playwright) e extrai dados de pacientes, exames e laudos em ciclos contínuos. |
| **API REST** | Expõe os dados coletados através de endpoints HTTP com busca, paginação e download de PDFs. |
| **Engine de Webhooks** | Dispara notificações assinadas (HMAC SHA-256) para endpoints externos sempre que um novo atendimento é registrado ou um laudo é concluído. |

### Funcionalidades Completas

- **Coleta automatizada** com autenticação via browser headless (Playwright) e reuso de cookies/JWT por 30 minutos
- **Sincronização 24/7** com janela rolante de 5 meses, executada a cada 1 minuto (configurável)
- **Carga histórica retroativa** (2020—2026) mês a mês com retomada de ponto de parada
- **Idempotência total** — upsert de atendimentos, sem duplicação mesmo em execuções concorrentes
- **Download de PDFs** de laudos concluídos com armazenamento local
- **13 endpoints REST** para consulta, gestão de webhooks e disparo manual de sincronizações
- **Dashboard SPA** com tema Dark Glassmorphism, 4 abas de navegação e atualização a cada 10s
- **Containerização Docker** com healthcheck, volume persistente e restart automático

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│                    Docker Container (:3000)                   │
│                                                              │
│  ┌─────────────┐     ┌──────────────────┐     ┌──────────┐  │
│  │  Dashboard   │     │   Express.js     │     │  SQLite  │  │
│  │  (SPA HTML)  │◄───▶│   /api/v1/*      │◄───▶│  (WAL)   │  │
│  │  public/     │     │   Static Files   │     │  data/   │  │
│  └─────────────┘     └───────┬──────────┘     └──────────┘  │
│                              │                               │
│              ┌───────────────┼───────────────┐               │
│              │               │               │               │
│     ┌────────▼────────┐ ┌───▼──────────┐ ┌──▼───────────┐   │
│     │ WorklabCollector │ │  Webhook     │ │   Arquivos   │   │
│     │ (Playwright +    │ │  Dispatcher  │ │   PDF Laudos │   │
│     │  Axios)          │ │  (HMAC+Retry)│ │  data/laudos │   │
│     └────────┬─────────┘ └──────┬───────┘ └──────────────┘   │
│              │                  │                             │
└──────────────┼──────────────────┼─────────────────────────────┘
               │                  │
    ┌──────────▼──────────┐  ┌────▼────────────────┐
    │ WorkLab Web System  │  │ External Webhooks   │
    │ api.worklabweb.com.br│  │ (user-configured)   │
    │ (API REST + PDFs)   │  │                     │
    └─────────────────────┘  └─────────────────────┘
```

### Fluxo de Dados

1. A cada `SYNC_INTERVAL_MINUTES`, o `WorklabCollector.runSync()` é acionado
2. Playwright lança Chromium headless, faz login no WorkLab e captura cookies (`PHPSESSID`) e token JWT (`worklab-api-token`)
3. Axios (com cookies de sessão) consulta `POST /relatorios/pacientes_por_convenio` na API nativa do WorkLab para a janela de 5 meses
4. Cada paciente/atendimento sofre **upsert** no SQLite (tabelas `atendimentos` + `exames`)
5. Se o laudo está concluído, o PDF é baixado de `/printLaudo.php?id=<id>` e salvo em `data/laudos/`
6. O `WebhookDispatcher` envia payloads JSON assinados (HMAC SHA-256) para todos os webhooks ativos inscritos nos eventos `novo_atendimento` e `laudo_concluido`
7. O Dashboard (`public/index.html`) faz polling de `/api/v1/stats` a cada 10 segundos

---

## Stack Tecnológica

| Camada | Tecnologia | Versão |
|---|---|---|
| **Runtime** | Node.js | 22+ |
| **Linguagem** | TypeScript | 5.7 |
| **Servidor HTTP** | Express.js | 4.21 |
| **Banco de Dados** | SQLite (better-sqlite3) | 11.8 |
| **Browser Automation** | Playwright (Chromium headless) | 1.50 |
| **HTTP Client** | Axios | 1.7 |
| **Fuso Horário** | America/Recife (UTC-3) | — |
| **Container Base** | `playwright:v1.50.0-noble` | — |

---

## Estrutura de Diretórios

```
api-worklabweb/
├── .dockerignore                     # Arquivos ignorados no build Docker
├── .env                              # Variáveis de ambiente (não versionar)
├── .env.example                      # Template de variáveis de ambiente
├── Dockerfile                        # Build da imagem Docker
├── docker-compose.yml                # Orquestração do container
├── package.json                      # Manifesto npm (deps + scripts)
├── package-lock.json                 # Lockfile de dependências
├── tsconfig.json                     # Configuração do compilador TypeScript
├── README.md                         # Este documento
│
├── data/                             # Dados persistentes (volume Docker)
│   ├── laudos/                       # PDFs de laudos baixados
│   ├── worklab.db                    # Arquivo do banco SQLite
│   ├── worklab.db-shm                # Shared memory (WAL)
│   └── worklab.db-wal                # Write-Ahead Log
│
├── public/                           # Dashboard Frontend (SPA)
│   ├── index.html                    # Página principal com 4 abas
│   ├── css/
│   │   └── style.css                 # Tema Dark Glassmorphism
│   └── js/
│       └── app.js                    # Lógica do dashboard (fetch, UI, eventos)
│
├── src/                              # Código-fonte TypeScript
│   ├── app.ts                        # Entry point do Express + timer 24/7
│   ├── config/
│   │   └── env.ts                    # Carregador de variáveis de ambiente
│   ├── db/
│   │   └── database.ts               # Schema SQLite + migrations defensivas
│   ├── routes/
│   │   └── api.ts                    # Todos os 13 endpoints REST
│   ├── services/
│   │   ├── worklabCollector.ts       # Coletor: login Playwright + API + PDFs
│   │   └── webhookDispatcher.ts      # Disparador: HMAC + retry + logs
│   └── utils/
│       └── dateUtils.ts              # Utilitários de data (fuso Recife)
│
└── dist/                             # Output compilado (JavaScript)
    └── ... (espelho de src/)
```

---

## Configuração — Variáveis de Ambiente

Arquivo `.env` (copie de `.env.example`):

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor HTTP |
| `WORKLAB_URL` | `https://www.worklabweb.com.br/index.php` | URL da página de login do WorkLab |
| `WORKLAB_ID` | `881/0` | Nome de usuário (login) do WorkLab |
| `WORKLAB_PASSWORD` | `SUA_SENHA_AQUI` | Senha do WorkLab |
| `SYNC_INTERVAL_MINUTES` | `1` | Intervalo em minutos entre ciclos de sincronização 24/7 |
| `DB_PATH` | `./data/worklab.db` | Caminho do arquivo SQLite |
| `STORAGE_PATH` | `./data/laudos` | Diretório de armazenamento dos PDFs |
| `API_KEY` | `SUA_CHAVE_API_AQUI` | Chave de API (reservada para uso futuro como autenticação) |

---

## Banco de Dados — Schema Completo

O banco é **SQLite3** com WAL habilitado (`PRAGMA journal_mode = WAL`). O schema é criado via `CREATE TABLE IF NOT EXISTS` em `src/db/database.ts:8-106`. Não há ORM — todas as queries são SQL direto via `better-sqlite3`.

### Diagrama de Relacionamentos

```
atendimentos (1) ──────< (N) exames        │ FK: atendimento_id CASCADE
atendimentos (1) ──────< (1) laudos         │ FK: atendimento_id UNIQUE CASCADE
webhooks     (1) ──────< (N) webhook_logs   │ FK: webhook_id SET NULL
```

---

### Tabela: `atendimentos`

Registro principal de cada atendimento/paciente importado do WorkLab.

| # | Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|---|
| 1 | `id` | INTEGER | PK, AUTOINCREMENT | ID local do registro |
| 2 | `worklab_id` | TEXT | UNIQUE, NOT NULL | ID original do paciente no WorkLab (`pacienteid`) |
| 3 | `protocolo` | TEXT | NOT NULL | Número do protocolo (`codigo_ficha`) |
| 4 | `data_cadastro` | TEXT | | Data de cadastro do atendimento (YYYY-MM-DD) |
| 5 | `paciente_nome` | TEXT | NOT NULL | Nome completo do paciente |
| 6 | `unidade` | TEXT | | Sigla da unidade de atendimento |
| 7 | `convenio` | TEXT | | Nome do convênio / plano de saúde |
| 8 | `medico` | TEXT | | Nome do médico solicitante |
| 9 | `cpf` | TEXT | | CPF do paciente |
| 10 | `rg` | TEXT | | RG do paciente |
| 11 | `datnasc` | TEXT | | Data de nascimento |
| 12 | `sexo` | TEXT | | Sexo (M/F) |
| 13 | `cidade` | TEXT | | Cidade do paciente |
| 14 | `endereco` | TEXT | | Endereço completo |
| 15 | `telefone` | TEXT | | Telefone / celular |
| 16 | `email` | TEXT | | E-mail |
| 17 | `atendente` | TEXT | | Nome do atendente que registrou |
| 18 | `valor_total` | REAL | DEFAULT 0 | Valor total bruto |
| 19 | `desconto` | REAL | DEFAULT 0 | Desconto aplicado |
| 20 | `acrescimo` | REAL | DEFAULT 0 | Acréscimo aplicado |
| 21 | `valor_final` | REAL | DEFAULT 0 | Valor final (`total_desconto_acrescimo`) |
| 22 | `forma_pagamento` | TEXT | | Forma de pagamento |
| 23 | `situacao` | TEXT | | Situação geral do atendimento |
| 24 | `medicamentos` | TEXT | | Medicamentos associados |
| 25 | `observacao` | TEXT | | Observações gerais |
| 26 | `status_laudo` | TEXT | DEFAULT 'PENDENTE' | Status do laudo: `PENDENTE` ou `CONCLUIDO` |
| 27 | `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Data/hora de criação local |
| 28 | `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Data/hora da última atualização |

---

### Tabela: `exames`

Exames realizados dentro de um atendimento. Cada atendimento pode ter N exames.

| # | Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|---|
| 1 | `id` | INTEGER | PK, AUTOINCREMENT | ID local |
| 2 | `atendimento_id` | INTEGER | NOT NULL, FK → `atendimentos(id)` ON DELETE CASCADE | Vínculo com o atendimento |
| 3 | `exame_id` | INTEGER | | ID original do exame no WorkLab |
| 4 | `codigo_exame` | TEXT | | Código do exame |
| 5 | `nome_exame` | TEXT | NOT NULL | Nome/descrição do exame |
| 6 | `descricao` | TEXT | | Descrição adicional (igual a `nome_exame`) |
| 7 | `valor` | REAL | DEFAULT 0 | Preço unitário do exame |
| 8 | `secao_sigla` | TEXT | | Sigla da seção do laboratório |
| 9 | `secao_descricao` | TEXT | | Descrição da seção |
| 10 | `status` | TEXT | | Status (`OK`) |
| 11 | `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Data/hora de inserção |

> **Nota sobre substituição:** Antes de inserir os exames, a rotina `processSingleRecord` deleta todos os exames existentes do atendimento para evitar duplicidade (`src/services/worklabCollector.ts:394`).

---

### Tabela: `laudos`

Arquivos PDF de laudos médicos baixados. Relacionamento 1:1 com `atendimentos`.

| # | Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|---|
| 1 | `id` | INTEGER | PK, AUTOINCREMENT | ID local |
| 2 | `atendimento_id` | INTEGER | UNIQUE, NOT NULL, FK → `atendimentos(id)` ON DELETE CASCADE | Vínculo 1:1 com o atendimento |
| 3 | `filepath` | TEXT | NOT NULL | Caminho absoluto do arquivo PDF |
| 4 | `filename` | TEXT | NOT NULL | Nome do arquivo (formato: `LAUDO_{protocolo}_{worklab_id}_{PACIENTE}.pdf`) |
| 5 | `mime_type` | TEXT | DEFAULT 'application/pdf' | Tipo MIME |
| 6 | `downloaded_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Data/hora do download |

---

### Tabela: `webhooks`

Endpoints de webhook cadastrados pelo usuário via API/Dashboard.

| # | Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|---|
| 1 | `id` | INTEGER | PK, AUTOINCREMENT | ID local |
| 2 | `url` | TEXT | NOT NULL | URL de destino (POST) |
| 3 | `description` | TEXT | | Descrição amigável para identificação |
| 4 | `secret` | TEXT | NOT NULL | Segredo para assinatura HMAC (prefixo `whsec_` se gerado automaticamente) |
| 5 | `events` | TEXT | NOT NULL, DEFAULT 'laudo_concluido,novo_atendimento' | Lista de eventos inscritos (separados por vírgula). Use `*` para todos. |
| 6 | `active` | INTEGER | DEFAULT 1 | `1` = ativo, `0` = desabilitado |
| 7 | `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Data/hora de criação |

---

### Tabela: `webhook_logs`

Histórico de tentativas de entrega de webhooks (auditoria).

| # | Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|---|
| 1 | `id` | INTEGER | PK, AUTOINCREMENT | ID local |
| 2 | `webhook_id` | INTEGER | FK → `webhooks(id)` ON DELETE SET NULL | Referência ao webhook (torna-se NULL se webhook for excluído) |
| 3 | `event` | TEXT | NOT NULL | Tipo do evento (`novo_atendimento`, `laudo_concluido`, `test_ping`) |
| 4 | `payload` | TEXT | NOT NULL | Payload JSON completo enviado |
| 5 | `status_code` | INTEGER | | Código HTTP da resposta (ou 500 em caso de erro de rede) |
| 6 | `response_body` | TEXT | | Corpo da resposta (truncado em 2000 caracteres) |
| 7 | `attempt_count` | INTEGER | DEFAULT 1 | Número de tentativas realizadas (1 a 3) |
| 8 | `success` | INTEGER | DEFAULT 0 | `1` = entregue (2xx), `0` = falhou |
| 9 | `executed_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Data/hora da execução (fuso Recife) |

---

### Tabela: `sync_logs`

Log de cada ciclo de sincronização 24/7 executado.

| # | Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|---|
| 1 | `id` | INTEGER | PK, AUTOINCREMENT | ID local |
| 2 | `status` | TEXT | NOT NULL | `SUCCESS` ou `ERROR` |
| 3 | `atendimentos_encontrados` | INTEGER | DEFAULT 0 | Total de registros retornados pela API do WorkLab |
| 4 | `novos_atendimentos` | INTEGER | DEFAULT 0 | Quantos desses eram novos (INSERT) |
| 5 | `laudos_baixados` | INTEGER | DEFAULT 0 | Quantos PDFs foram baixados neste ciclo |
| 6 | `webhooks_disparados` | INTEGER | DEFAULT 0 | Quantos eventos de webhook foram enviados |
| 7 | `error_message` | TEXT | | Mensagem de erro (se `status = ERROR`) |
| 8 | `executed_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Data/hora da execução (fuso Recife) |

---

### Tabela: `historico_sync`

Progresso da carga histórica retroativa (2020—2026) por mês.

| # | Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|---|
| 1 | `id` | INTEGER | PK, AUTOINCREMENT | ID local |
| 2 | `mes_ano` | TEXT | UNIQUE, NOT NULL | Identificador do mês (formato `YYYY-MM`) |
| 3 | `status` | TEXT | NOT NULL | `SUCCESS` ou `ERROR` |
| 4 | `registros_processados` | INTEGER | DEFAULT 0 | Quantidade de registros processados naquele mês |
| 5 | `executed_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Data/hora da execução |

---

### Migrations Defensivas

O módulo `src/db/database.ts:109-145` contém a função `addColumnIfNotExists(table, column, type)` que verifica via `PRAGMA table_info()` se uma coluna já existe antes de executar `ALTER TABLE ADD COLUMN`. Isso garante compatibilidade com bancos SQLite criados em versões anteriores que não possuíam todas as colunas.

---

## API REST — Endpoints

Prefixo base: `/api/v1`

### Legenda de Símbolos

| Símbolo | Significado |
|---|---|
| 🔵 `GET` | Leitura |
| 🟢 `POST` | Criação / Ação |
| 🔴 `DELETE` | Remoção |

---

### 1. Estatísticas

| Método | Rota |
|---|---|
| 🔵 GET | `/api/v1/stats` |

**Resposta:**
```json
{
  "success": true,
  "stats": {
    "totalAtendimentos": 1543,
    "laudosConcluidos": 1201,
    "webhooksAtivos": 3,
    "taxaSucessoWebhook": 98,
    "totalFaturado": 256780.50,
    "mesesHistoricosConcluidos": 52,
    "ultimaSync": {
      "id": 847,
      "status": "SUCCESS",
      "atendimentos_encontrados": 1543,
      "novos_atendimentos": 0,
      "laudos_baixados": 2,
      "webhooks_disparados": 2,
      "error_message": null,
      "executed_at": "2026-08-12 14:30:05"
    }
  }
}
```

---

### 2. Atendimentos — Listagem paginada

| Método | Rota |
|---|---|
| 🔵 GET | `/api/v1/atendimentos` |

**Query Params:**

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `page` | int | `1` | Número da página |
| `limit` | int | `20` | Itens por página |
| `status` | string | — | Filtrar por `PENDENTE` ou `CONCLUIDO` |
| `search` | string | — | Busca textual (nome, protocolo, worklab_id, CPF, atendente) |

**Resposta:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "worklab_id": "18543",
      "protocolo": "0018543",
      "paciente_nome": "RAMON LIMA DA SILVA",
      "cpf": "123.456.789-00",
      "data_cadastro": "2026-08-01",
      "status_laudo": "CONCLUIDO",
      "valor_final": 150.00,
      "pdf_filename": "LAUDO_0018543_18543_RAMON_LIMA_DA_SILVA.pdf",
      "exames": [
        {
          "id": 1,
          "atendimento_id": 1,
          "exame_id": 42,
          "codigo_exame": "HEM",
          "nome_exame": "Hemograma Completo",
          "valor": 50.00,
          "secao_sigla": "HEM",
          "status": "OK"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1543,
    "totalPages": 78
  }
}
```

---

### 3. Atendimento — Detalhe completo

| Método | Rota |
|---|---|
| 🔵 GET | `/api/v1/atendimentos/:id` |

`:id` pode ser tanto o `id` local quanto o `worklab_id` original.

**Resposta:** Igual ao item da listagem, mas com o campo adicional `laudo` (objeto do registro em `laudos` ou `null`).

---

### 4. Download do PDF do Laudo

| Método | Rota |
|---|---|
| 🔵 GET | `/api/v1/atendimentos/:id/pdf` |

**Resposta:** Stream binário `application/pdf` com cabeçalho `Content-Disposition: inline`.

---

### 5. Webhooks — Listar

| Método | Rota |
|---|---|
| 🔵 GET | `/api/v1/webhooks` |

---

### 6. Webhooks — Criar

| Método | Rota |
|---|---|
| 🟢 POST | `/api/v1/webhooks` |

**Body:**
```json
{
  "url": "https://meu-sistema.com/webhook",
  "description": "Integração ERP",
  "secret": "meu-segredo-hmac",
  "events": "laudo_concluido,novo_atendimento"
}
```

- `secret`: se omitido, gerado automaticamente (`whsec_xxxxxxxxx`)
- `events`: se omitido, usa o padrão `laudo_concluido,novo_atendimento`

---

### 7. Webhooks — Excluir

| Método | Rota |
|---|---|
| 🔴 DELETE | `/api/v1/webhooks/:id` |

---

### 8. Webhooks — Testar

| Método | Rota |
|---|---|
| 🟢 POST | `/api/v1/webhooks/:id/test` |

Envia um evento `test_ping` com payload de teste para o webhook.

---

### 9. Sync — Disparo Manual

| Método | Rota |
|---|---|
| 🟢 POST | `/api/v1/sync/trigger` |

Dispara a sincronização 24/7 (janela de 5 meses) em segundo plano. Retorna imediatamente.

---

### 10. Sync — Carga Histórica

| Método | Rota |
|---|---|
| 🟢 POST | `/api/v1/sync/historical` |

Dispara a carga retroativa de 2020 a 2026, mês a mês, em segundo plano.

---

### 11. Sync — Status da Carga Histórica

| Método | Rota |
|---|---|
| 🔵 GET | `/api/v1/sync/historical/status` |

Retorna o progresso mês a mês da tabela `historico_sync`.

---

### 12. Logs de Webhook

| Método | Rota |
|---|---|
| 🔵 GET | `/api/v1/logs/webhook` |

Últimos 50 registros de `webhook_logs` com a URL do webhook (join com `webhooks`).

---

### 13. Logs de Sincronização

| Método | Rota |
|---|---|
| 🔵 GET | `/api/v1/logs/sync` |

Últimos 50 registros de `sync_logs`.

---

## Engine de Webhooks

### Eventos Disparados

| Evento | Gatilho | Momento do Disparo |
|---|---|---|
| `novo_atendimento` | Um paciente é inserido pela primeira vez | Durante `processSingleRecord`, logo após o INSERT |
| `laudo_concluido` | Um PDF de laudo é baixado com sucesso | Durante `processSingleRecord`, após `tryDownloadLaudo` retornar `true` |
| `test_ping` | Usuário clica "Testar" no Dashboard/API | Imediato, via `POST /api/v1/webhooks/:id/test` |

### Payload

Todo webhook envia um JSON com a seguinte estrutura:

```json
{
  "event": "novo_atendimento",
  "timestamp": "2026-08-12T14:30:05.000Z",
  "data": {
    "id": 1,
    "worklab_id": "18543",
    "protocolo": "0018543",
    "paciente_nome": "RAMON LIMA DA SILVA",
    "cpf": "123.456.789-00",
    "data_cadastro": "2026-08-01",
    "unidade": "CENTRAL",
    "convenio": "UNIMED",
    "medico": "DR. CARLOS",
    "valor_final": 150.00,
    "status_laudo": "PENDENTE"
  }
}
```

### Assinatura HMAC SHA-256

Cabeçalhos HTTP enviados:

| Cabeçalho | Formato | Descrição |
|---|---|---|
| `X-WorkLab-Signature` | `t={unix_timestamp},v1={hex_hash}` | Assinatura criptográfica |
| `X-WorkLab-Event` | `{event_name}` | Nome do evento |
| `Content-Type` | `application/json` | — |
| `User-Agent` | `WorkLabWeb-Webhook-Engine/1.0` | — |

**Algoritmo de verificação (no lado receptor):**

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const [t, v1] = signature.split(',').map(s => s.split('=')[1]);
  const expected = crypto.createHmac('sha256', secret)
    .update(`${t}.${payload}`)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(v1)
  );
}
```

### Política de Retry

- Até **3 tentativas** por disparo
- Backoff exponencial: 1s, 2s, 3s entre tentativas
- Timeout de 10 segundos por requisição
- Considera sucesso apenas status HTTP 2xx
- Todos os logs (inclusive falhas) são registrados em `webhook_logs`

---

## Coletor WorkLab (WorklabCollector)

Módulo central localizado em `src/services/worklabCollector.ts`.

### Autenticação

1. Playwright lança Chromium headless com flags `--no-sandbox --disable-setuid-sandbox`
2. Navega até `WORKLAB_URL` com até 3 tentativas contra instabilidade de rede
3. Preenche `input[name="username"]` e `input[name="password"]`
4. Clica em `button#logar`
5. Aguarda redirect para `welcome.php` ou `index.php`
6. Extrai cookies: `PHPSESSID` (sessão PHP) e `worklab-api-token` (JWT)
7. **Cache de sessão:** reutilizada por até 30 minutos antes de reautenticar

### Modos de Sincronização

| Modo | Método | Escopo | Gatilho |
|---|---|---|---|
| **24/7** | `runSync()` | Últimos 5 meses até hoje | Timer (`setInterval` a cada N minutos) + inicial ao subir + manual via API |
| **Histórico** | `runHistoricalLoad()` | Janeiro/2020 até mês atual, mês a mês | Manual via API/Dashboard |

### Proteções

- **Mutex:** apenas uma sincronização 24/7 e uma histórica podem rodar por vez (`isSyncing`, `isHistoricalSyncing`)
- **Resumo histórico:** antes de processar um mês, verifica se já consta como `SUCCESS` em `historico_sync`
- **Pausa entre meses:** 1 segundo de intervalo na carga histórica para não sobrecarregar o servidor legado

### Processamento de cada registro (`processSingleRecord`)

```
┌─────────────────────────────────────────┐
│ 1. Extrair campos do JSON da API        │
│    (pacienteid, codigo_ficha, nome...)  │
├─────────────────────────────────────────┤
│ 2. SELECT por worklab_id no SQLite      │
├──────────────────┬──────────────────────┤
│   NÃO EXISTE     │     JÁ EXISTE        │
│   (INSERT)       │     (UPDATE)         │
│   + dispara      │     + atualiza dados │
│   novo_atendimento│                      │
├──────────────────┴──────────────────────┤
│ 3. DELETE + INSERT exames do paciente   │
│    (substitui array paciente_exame)     │
├─────────────────────────────────────────┤
│ 4. Se status != CONCLUIDO:              │
│    GET /printLaudo.php?id={worklab_id}  │
│    Se PDF válido → salvar + marcar      │
│    CONCLUIDO + disparar laudo_concluido │
└─────────────────────────────────────────┘
```

### Download de PDF (`tryDownloadLaudo`)

- Requisita `GET /printLaudo.php?id={worklab_id}` via Axios com `responseType: arraybuffer`
- Verifica se o conteúdo contém `EXAMES EM ANALISE`, `NAO CONFERIDOS` ou `alert(` — se sim, laudo não está pronto
- Verifica se os primeiros 4 bytes são `%PDF` (assinatura de arquivo PDF)
- Nome do arquivo: `LAUDO_{protocolo}_{worklab_id}_{NOME_PACIENTE_SANITIZADO}.pdf`
- Salva em `STORAGE_PATH` e registra em `laudos` (upsert via `ON CONFLICT`)

---

## Dashboard Frontend

Localizado em `public/`. É uma SPA (Single Page Application) servida como arquivos estáticos pelo Express.

### Abas

| Aba | Conteúdo |
|---|---|
| **Visão Geral** | 4 cards de métricas (total atendimentos, faturamento, laudos concluídos, webhooks ativos) + tabela com últimos 6 atendimentos |
| **Atendimentos & Exames** | Tabela completa com busca, filtro por status e listagem de exames por atendimento |
| **Webhooks & Gatilhos** | Formulário de cadastro + tabela de webhooks ativos com botões Testar e Excluir |
| **Logs & Auditoria** | Logs de disparo de webhooks + histórico de sincronizações 24/7 |

### Funcionamento

- Frontend faz fetch para a própria API (`/api/v1/*`)
- Atualização automática de estatísticas a cada **10 segundos**
- Tema **Dark Glassmorphism** definido em `public/css/style.css`
- Fonte **Outfit** carregada do Google Fonts

---

## Docker — Deploy em Produção

### Pré-requisitos

- Docker Engine 20.10+
- Docker Compose 2.0+

### Subir a aplicação

```bash
cd api-worklabweb
docker-compose up -d --build
```

### O que acontece

1. Build da imagem baseada em `mcr.microsoft.com/playwright:v1.50.0-noble` (Chromium pré-instalado)
2. `npm install` para dependências
3. `npm run build` (compila TypeScript → JavaScript em `/dist`)
4. Cria `data/` e `data/laudos/` dentro do container
5. Inicia com `npm start` (roda `node dist/app.js`)
6. Sincronização inicial disparada automaticamente

### Acessar

- **Dashboard:** http://localhost:3000
- **API:** http://localhost:3000/api/v1/stats

### Healthcheck

O `docker-compose.yml` configura healthcheck via `curl -f http://localhost:3000/api/v1/stats` a cada 30 segundos.

### Persistência

O diretório `./data` no host é montado como volume em `/app/data` dentro do container, garantindo que o banco SQLite e os PDFs sobrevivam a reinicializações.

### Parar

```bash
docker-compose down
```

---

## Desenvolvimento Local

### Pré-requisitos

- Node.js 22+
- npm 10+
- Playwright com Chromium instalado (`npx playwright install chromium`)

### Setup

```bash
git clone <repo-url>
cd api-worklabweb
cp .env.example .env        # Ajustar credenciais se necessário
npm install
npx playwright install chromium
```

### Executar

```bash
# Modo desenvolvimento (ts-node, com hot-reload manual)
npm run dev

# Modo produção
npm run build
npm start
```

### Scripts npm

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia com `ts-node` diretamente do TypeScript |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Executa o JavaScript compilado em `dist/app.js` |

---

## Licença

ISC — Antigravity Senior Software Engineer
