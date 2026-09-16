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
                ├── report_definitions / report_executions
                └── operators (empresas operadoras)
                     ├── integration_credentials ── sync_runs
                     ├── stream_cursors
                     ├── t7_groups · t7_event_types
                     ├── drivers
                     ├── vehicles ──┬── vehicle_last_position
                     │              ├── trips
                     │              └── telemetry_events
                     └── positions  (particionada por mês)
```

### Organização × operadora

A **organização** é a conta (o consórcio, ou uma empresa isolada). A **operadora**
é a empresa de ônibus: tem credenciais próprias da Track7, coletor próprio, ponteiro
de fluxo próprio e frota separada.

Essa separação atende diretamente o ofício do órgão gestor — alínea (a), relação
empresa operadora ↔ fornecedor de telemetria, e alínea (h), arquivos individualizados
por empresa operadora — e é o que permite a conta do consórcio consultar as 33 empresas
com um seletor, sem misturar dados.

Nas consultas, `operatorId` ausente significa **visão consolidada** de todas as
operadoras da conta; presente, restringe a uma. Ações que gravam (salvar credenciais,
sincronizar, coletar) sempre exigem uma operadora definida.

### Chaves

Tabelas sincronizadas usam chave natural composta `(operator_id, <id da Track7>)`.
A chave é por operadora, e não por conta, porque nada garante que os identificadores
da Track7 não se repitam entre contas diferentes da plataforma.
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
  ├─ lock Redis  sync:{operatorId}
  ├─ INSERT sync_runs (RUNNING)
  ├─ etapas: organizacao → grupos → veiculos → motoristas → posicoes_atuais → viagens → eventos
  │          cada etapa cronometrada e contabilizada
  ├─ UPDATE sync_runs (SUCCESS | PARTIAL | ERROR, stats, steps, duração)
  └─ invalida cache  org:{orgId}:*
```

Falha em uma etapa após outras terem concluído resulta em `PARTIAL`: o que já entrou
permanece. Escritas usam `bulkUpsert`, que fatia os lotes conforme o limite de
parâmetros do protocolo do Postgres.

## Coletores por operadora

O worker mantém um coletor de posições e um agendamento de sincronização **por
operadora**. Os coletores entram com defasagem distribuída dentro do intervalo
(`índice / total × intervalo`): com 33 operadoras a 30 s, um dispara a cada ~0,9 s,
em vez de 33 chamadas simultâneas a cada 30 s.

A configuração é relida a cada minuto — cadastrar uma operadora e salvar as
credenciais dela basta para o coletor entrar no ar, sem reiniciar nada.

### Dimensionamento

A 30 s, cada veículo gera ~2.880 posições por dia.

| Cenário | Veículos | Linhas/mês |
|---------|----------|-----------|
| Uma empresa | ~90 | ~7,5 milhões |
| Consórcio | ~3.000 | ~260 milhões |

A partição mensal de `positions` atende bem o primeiro caso. Passando de algumas
centenas de veículos, o passo seguinte é partição semanal e política de retenção —
a função `ensure_month_partitions` é o ponto de mudança.

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
