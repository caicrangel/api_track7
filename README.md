# FleetGov · Gestão de frota com telemetria Track7

Plataforma SaaS para gestão de frota pública integrada à **API oficial da Track7**
(plataforma **MiX Telematics** / *MiX Integrate*). Sincroniza veículos, motoristas,
grupos, posições, viagens e eventos, e entrega os módulos **Veículos** e **Relatórios**
prontos para customização conforme as exigências do órgão gestor.

```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌────────────┐
│   web    │───▶│   api    │───▶│ postgres  │    │   worker   │
│ React+   │    │ Fastify  │    │    16     │◀───│ sync agend.│
│ nginx    │    │   +TS    │    └───────────┘    └────────────┘
└──────────┘    └────┬─────┘    ┌───────────┐          │
                     └─────────▶│   redis   │◀─────────┘
                                └───────────┘
                          │
                          ▼
              API oficial Track7 (MiX Integrate)
```

---

## 1. Subir o sistema

Pré-requisitos: **Docker** e **Docker Compose v2**.

```bash
git clone <este-repositorio> && cd api_track7

cp .env.example .env
./scripts/gen-secrets.sh          # gera JWT_SECRET, chave de criptografia e senha do banco

docker compose up -d --build      # ou: make up
docker compose ps
```

Acesse **http://localhost:8080**.

Primeiro acesso (definido no `.env`):

| Campo | Valor padrão |
|-------|--------------|
| E-mail | `admin@fleetgov.local` |
| Senha  | `Admin@123456` |

> A senha inicial é marcada como temporária — troque em **Perfil › Alterar senha**.

Comandos úteis (`make help` lista todos):

```bash
make up        # sobe a stack
make logs      # logs em tempo real
make ps        # status
make psql      # abre um psql no banco
make sync      # dispara uma sincronização manual
make down      # derruba a stack
```

---

## 2. Conectar à Track7

A Track7 opera sobre a MiX Telematics e a API usa **OpenID Connect · Resource Owner
Password Flow**. São necessários quatro dados, fornecidos pelo suporte da Track7:

| Dado | Origem |
|------|--------|
| **Client ID** / **Client Secret** | emitidos pelo suporte da Track7 mediante solicitação (SR) |
| **Usuário** / **Senha** | as mesmas credenciais do MiX Fleet Manager |
| **Região** | define as URLs de identidade e da API (Américas, Europa, UK, ZA, AU, OM) |

Cadastre em **Configurações › Integrações**, clique em **Testar conexão** e depois em
**Salvar**. As credenciais são cifradas com **AES-256-GCM** antes de irem ao banco e
nunca voltam para a tela.

Também é possível semear as credenciais pelo `.env` no primeiro boot
(`TRACK7_CLIENT_ID`, `TRACK7_CLIENT_SECRET`, `TRACK7_USERNAME`, `TRACK7_PASSWORD`).

### Modos de sincronização

| Modo | O que traz |
|------|------------|
| `catalog` | grupos/sites, veículos, motoristas e última posição |
| `incremental` *(padrão)* | o catálogo + viagens e eventos desde a última execução |
| `history` | recarrega viagens e eventos de um período informado |

O agendamento roda no serviço `worker`, respeita o intervalo definido na tela e relê a
configuração a cada minuto — mudanças na UI entram em vigor sem reiniciar nada.

---

## 3. Módulos

### Veículos
Frota completa vinda da Track7: identificação, grupo/site, odômetro, horímetro,
última transmissão e situação operacional (em movimento / parado / sem comunicação).
Filtros por texto, situação, grupo e marca; exportação em CSV respeitando os filtros;
detalhe com cadastro, última posição, viagens e eventos recentes.

### Relatórios
Catálogo declarativo — cada relatório descreve seus **parâmetros** e **colunas**, e a
tela monta formulário e tabela sozinha. Já acompanham:

| Código | Relatório | Categoria |
|--------|-----------|-----------|
| `inventario-frota` | Inventário da frota | Frota |
| `sem-transmissao` | Veículos sem transmissão | Operação |
| `quilometragem-periodo` | Quilometragem por veículo | Operação |
| `conducao-motorista` | Condução por motorista | Operação |
| `viagens-detalhado` | Viagens detalhadas | Conformidade |
| `utilizacao-frota` | Utilização da frota | Conformidade |
| `excesso-velocidade` | Excesso de velocidade | Segurança |
| `eventos-categoria` | Eventos por categoria | Segurança |

**Para atender o órgão gestor**, basta acrescentar uma definição em
`apps/api/src/modules/reports/report-catalog.ts` — nenhum código de front-end é
necessário. Veja `docs/RELATORIOS.md`.

### Contestações
Módulo dedicado ao **relatório georreferenciado de viagem** exigido pelo Ofício
DGOD/TRANSFACIL nº 001/2026 (SMMUR/SUMOB de Belo Horizonte): número de ordem, data,
hora, latitude e longitude, um arquivo por viagem contestada, em XLSX ou CSV, nomeado
com o ID da planilha de apuração. Cada emissão fica registrada com o SHA-256 do
conteúdo — evidência de que não houve alteração manual.
Veja [`docs/RELATORIO-SUMOB.md`](docs/RELATORIO-SUMOB.md).

### Global
**Configurações** (organização, integrações, auditoria), **Usuários** (CRUD com quatro
perfis de acesso), **Ajuda** e **Perfil**.

---

## 4. Desenvolvimento local (sem Docker)

```bash
# banco
docker compose up -d postgres redis

# API
cd apps/api && npm install && npm run dev      # http://localhost:3333

# Front-end
cd apps/web && npm install && npm run dev      # http://localhost:5173 (proxy p/ :3333)
```

Variáveis mínimas para a API: `DATABASE_URL`, `JWT_SECRET`, `APP_ENCRYPTION_KEY`.

---

## 5. Segurança

- Senhas com **scrypt** + sal por usuário (sem dependências nativas);
- Credenciais de integração cifradas em repouso (**AES-256-GCM**);
- Sessão com *access token* curto (15 min) e *refresh token* rotativo, revogável e com hash no banco;
- Bloqueio temporário da conta após 5 tentativas de login malsucedidas;
- RBAC com quatro perfis: `ADMIN`, `MANAGER`, `OPERATOR`, `VIEWER`;
- Trilha de auditoria de login, alterações de usuários, integrações e sincronizações;
- Rate limiting global e reforçado no endpoint de login;
- Helmet, CORS configurável e validação de entrada com Zod em todas as rotas.

---

## 6. Desempenho

- **Postgres 16** com parâmetros ajustados no compose (`shared_buffers`, `work_mem`,
  `effective_cache_size`, `wal_compression`, `pg_stat_statements`);
- Tabela `positions` **particionada por mês**, com partições criadas automaticamente
  no boot e diariamente pelo worker;
- Índices compostos por organização + ativo + tempo, **BRIN** nas séries temporais e
  **GIN/pg_trgm** para busca textual de veículos e motoristas;
- Upserts em lote com *chunking* automático pelo limite de parâmetros do protocolo;
- Tabela `vehicle_last_position` desnormalizada para listagens e dashboard instantâneos;
- Cache em Redis para o dashboard e *lock* distribuído impedindo sincronizações concorrentes;
- Front-end com *code-splitting* (React / charts / app) e build estático servido por nginx com gzip.

---

## 7. Estrutura

```
.
├── docker-compose.yml          # postgres · redis · api · worker · web
├── Makefile                    # atalhos de operação
├── scripts/gen-secrets.sh      # gera segredos no .env
├── apps
│   ├── api                     # Fastify + TypeScript
│   │   └── src
│   │       ├── db/migrations   # SQL versionado
│   │       ├── lib             # cripto, cache, csv, auditoria, guardas
│   │       ├── modules
│   │       │   ├── integration # cliente Track7 + sincronização
│   │       │   ├── vehicles    # módulo Veículos
│   │       │   ├── reports     # módulo Relatórios (catálogo)
│   │       │   ├── auth · users · settings · drivers · dashboard
│   │       ├── server.ts       # API HTTP
│   │       ├── worker.ts       # agendador de sincronização
│   │       └── cli/sync.ts     # sincronização por linha de comando
│   └── web                     # React + Vite + Tailwind
└── docs                        # arquitetura, integração e relatórios
```

---

## 8. Documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — decisões técnicas e modelo de dados
- [`docs/INTEGRACAO-TRACK7.md`](docs/INTEGRACAO-TRACK7.md) — endpoints, autenticação e mapeamento de campos
- [`docs/RELATORIOS.md`](docs/RELATORIOS.md) — como criar um relatório novo
- [`docs/RELATORIO-SUMOB.md`](docs/RELATORIO-SUMOB.md) — modelo canônico para contestações
- [`docs/API.md`](docs/API.md) — referência dos endpoints HTTP
