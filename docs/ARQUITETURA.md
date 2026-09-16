# Arquitetura

## Serviços (docker-compose)

| Serviço | Imagem | Papel |
|---------|--------|-------|
| `postgres` | `postgres:16-alpine` | banco relacional, com parâmetros de desempenho ajustados |
| `redis` | `redis:7-alpine` | cache do dashboard e *lock* distribuído da sincronização |
| `api` | build de `apps/api` | API HTTP (Fastify + TypeScript) |
| `worker` | mesma imagem da API, `node dist/worker.js` | agendador de sincronização e manutenção de partições |
| `web` | build de `apps/web` + nginx | SPA React servida estaticamente, com proxy `/api` → `api:3333` |

`api` só sobe depois do healthcheck do banco e do Redis; `worker` depois do healthcheck da API.

## Decisões técnicas

**Fastify + TypeScript, sem ORM.** As consultas são SQL parametrizado sobre `pg`. Isso
mantém previsível o plano de execução das consultas analíticas (relatórios) e permite
usar recursos do Postgres — particionamento, BRIN, `pg_trgm`, agregações com `FILTER` —
sem lutar contra uma camada de abstração.

**Migrações em SQL versionado.** `apps/api/src/db/migrations/*.sql`, aplicadas em
transação e registradas em `schema_migrations`. Rodam sozinhas no boot da API.

**Multi-tenant por `organization_id`.** Toda tabela de domínio carrega a coluna e todas
as consultas filtram por ela — a organização vem do JWT, nunca do corpo da requisição.

**Segredos cifrados na aplicação.** As credenciais da Track7 são cifradas com
AES-256-GCM usando `APP_ENCRYPTION_KEY` antes de irem ao banco. A API devolve apenas
*flags* (`hasClientId`, …), nunca o valor — por isso os campos aparecem vazios na tela.

**Senhas com `scrypt` do Node.** Sem dependência nativa (`bcrypt`/`argon2`), o que
mantém a imagem Alpine pequena e o build reprodutível.

## Modelo de dados

```
organizations ──┬── users ── refresh_tokens
                ├── audit_logs
                ├── integration_credentials ── sync_runs
                ├── t7_groups
                ├── drivers
                ├── vehicles ──┬── vehicle_last_position
                │              ├── trips
                │              └── telemetry_events
                ├── positions  (particionada por mês)
                └── report_definitions / report_executions
```

### Chaves

Tabelas sincronizadas usam chave natural composta `(organization_id, <id da Track7>)`.
Isso torna a sincronização um `INSERT … ON CONFLICT DO UPDATE` idempotente, sem
consultas de leitura prévia e sem risco de duplicidade em execuções concorrentes.

### Particionamento

`positions` é `PARTITION BY RANGE (recorded_at)`, com partições mensais criadas pela
função `ensure_month_partitions(tabela, início, meses)` — invocada no boot (mês anterior
+ 12 meses à frente) e diariamente às 3h pelo worker. Séries longas ficam em partições
separadas, o *pruning* elimina meses irrelevantes das consultas e a limpeza de histórico
antigo vira um `DROP TABLE` de partição.

### Índices

| Índice | Finalidade |
|--------|-----------|
| `vehicles_search_trgm_idx` (GIN/trigram) | busca por descrição, placa ou nº de frota |
| `vehicles_org_plate_idx`, `vehicles_site_idx` | filtros da listagem |
| `positions_asset_time_idx` | histórico por veículo |
| `trips_asset_start_idx`, `trips_driver_idx` | relatórios por veículo e por motorista |
| `trips_start_brin`, `events_start_brin` | varreduras por período em tabelas grandes, com índice minúsculo |
| `events_category_idx` | relatórios por categoria de evento |

## Sincronização

```
runSync(kind)
  ├─ lock Redis  sync:{orgId}
  ├─ INSERT sync_runs (RUNNING)
  ├─ etapas: organizacao → grupos → veiculos → motoristas → posicoes_atuais → viagens → eventos
  │          cada etapa cronometrada e contabilizada
  ├─ UPDATE sync_runs (SUCCESS | PARTIAL | ERROR, stats, steps, duração)
  └─ invalida cache  org:{orgId}:*
```

Falha em uma etapa após outras terem concluído resulta em `PARTIAL`: o que já entrou
permanece. Escritas usam `bulkUpsert`, que fatia os lotes conforme o limite de
parâmetros do protocolo do Postgres.

## Autenticação

1. `POST /api/auth/login` → *access token* JWT (15 min) + *refresh token* opaco (7 dias).
2. O *refresh* é guardado apenas como hash SHA-256 e é **rotativo**: ao ser usado, é revogado e um novo é emitido.
3. O cliente renova a sessão automaticamente ao receber `401`, uma única vez por requisição.
4. Desativar ou excluir um usuário, e a troca de senha, revogam todos os seus tokens.
5. Cinco tentativas malsucedidas bloqueiam a conta por 15 minutos.

## Front-end

React 18 + Vite + TypeScript + Tailwind. TanStack Query cuida de cache, revalidação e
estados de carregamento. O *bundle* é dividido em três blocos (`react`, `charts`, `app`)
e servido por nginx com gzip e cache imutável nos *assets* com hash.

A camada `src/lib/api.ts` centraliza autenticação, renovação de sessão, tratamento de
erro e download de arquivos.
