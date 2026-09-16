# Referência da API

Base: `/api`. Exceto `POST /auth/login`, `POST /auth/refresh` e `GET /health`, todas as
rotas exigem `Authorization: Bearer <accessToken>`.

Papéis: `ADMIN` · `MANAGER` · `OPERATOR` · `VIEWER`.

## Saúde

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | status do serviço e latência do banco |

## Autenticação

| Método | Rota | Papel | Descrição |
|--------|------|-------|-----------|
| POST | `/auth/login` | público | `{ email, password }` → tokens + usuário + organização |
| POST | `/auth/refresh` | público | `{ refreshToken }` → novo par de tokens (rotativo) |
| POST | `/auth/logout` | público | revoga o *refresh token* enviado |
| GET | `/auth/me` | autenticado | dados da sessão |
| POST | `/auth/change-password` | autenticado | `{ currentPassword, newPassword }` |

## Usuários

| Método | Rota | Papel |
|--------|------|-------|
| GET | `/users` | autenticado |
| POST | `/users` | ADMIN |
| PATCH | `/users/:id` | ADMIN |
| POST | `/users/:id/reset-password` | ADMIN |
| DELETE | `/users/:id` | ADMIN |

Criar sem `password` devolve uma senha temporária. O sistema impede remover ou desativar
o último administrador ativo.

## Configurações

| Método | Rota | Papel |
|--------|------|-------|
| GET | `/settings` | autenticado |
| PUT | `/settings` | ADMIN |
| GET | `/settings/audit` | ADMIN, MANAGER |

## Integração Track7

| Método | Rota | Papel | Descrição |
|--------|------|-------|-----------|
| GET | `/integrations/track7` | autenticado | configuração (sem segredos) + presets de região |
| PUT | `/integrations/track7` | ADMIN, MANAGER | salva; segredos em branco preservam o valor atual |
| POST | `/integrations/track7/test` | ADMIN, MANAGER | autentica e lista organizações |
| GET | `/integrations/track7/groups` | autenticado | grupos locais, ou `?live=true` direto da Track7 |
| POST | `/integrations/track7/sync` | ADMIN, MANAGER, OPERATOR | `{ kind, wait?, from?, to? }` |
| GET | `/integrations/track7/sync-runs` | autenticado | histórico de execuções |
| GET | `/integrations/track7/diagnostics` | ADMIN, MANAGER | verificação ponta a ponta |

`kind`: `catalog` · `incremental` (padrão) · `history`.
Sem `wait: true` a resposta é `202` e a execução segue em segundo plano.

## Veículos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/vehicles` | lista paginada — `search`, `status`, `siteId`, `fuelType`, `make`, `connectivity`, `sort`, `order`, `page`, `pageSize`, `offlineHours` |
| GET | `/vehicles/summary` | indicadores da frota |
| GET | `/vehicles/filters` | opções de marca, combustível e grupos |
| GET | `/vehicles/export` | CSV com os mesmos filtros |
| GET | `/vehicles/:assetId` | detalhe + viagens e eventos recentes |
| GET | `/vehicles/:assetId/positions` | histórico de posições — `from`, `to`, `limit` |

`connectivity`: `MOVENDO` · `PARADO` · `SEM_COMUNICACAO`.

## Motoristas

| Método | Rota |
|--------|------|
| GET | `/drivers` — `search`, `page`, `pageSize`, `includeSystem` |

## Relatórios

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/reports` | catálogo com parâmetros e colunas |
| POST | `/reports/:code/run` | `{ params, format: 'json' \| 'csv', limit }` |
| GET | `/reports/executions` | histórico de execuções |

## Dashboard

| Método | Rota |
|--------|------|
| GET | `/dashboard` — indicadores, séries de 14 dias, ranking e última sincronização |

## Erros

```json
{ "error": "VALIDATION_ERROR", "message": "Dados inválidos.",
  "issues": [{ "field": "email", "message": "Informe um e-mail válido" }] }
```

| Código HTTP | `error` |
|-------------|---------|
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 422 | `VALIDATION_ERROR` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 502 | `UPSTREAM_ERROR` (falha ao falar com a Track7) |
