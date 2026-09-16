# Integração com a API oficial da Track7 (MiX Integrate)

A Track7 opera sobre a plataforma **MiX Telematics**. A integração usa a API pública
**MiX Integrate**, cujas rotas foram conferidas contra a biblioteca cliente oficial
[`MiXTelematics/MiX.Integrate.Api.Client`](https://github.com/MiXTelematics/MiX.Integrate.Api.Client)
(arquivo `MiX.Integrate.Shared/Constants/APIControllerRoutes.cs`).

Implementação: `apps/api/src/modules/integration/track7-client.ts`.

## 1. Autenticação

OpenID Connect · **Resource Owner Password Flow**.

```http
POST {identityUrl}/connect/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=password
&username={usuário do MiX Fleet Manager}
&password={senha}
&scope=offline_access MiX.Integrate
```

Resposta: `{ "access_token": "...", "expires_in": 3600, ... }`. O token é reaproveitado
em memória até 30 s antes de expirar; em `401` é renovado e a chamada é repetida.

### URLs por região

| Região | Identity Server | API |
|--------|-----------------|-----|
| Américas (US) | `https://identity.us.mixtelematics.com/core` | `https://integrate.us.mixtelematics.com` |
| Europa (EU) | `https://identity.eu.mixtelematics.com/core` | `https://integrate.eu.mixtelematics.com` |
| Reino Unido | `https://identity.uk.mixtelematics.com/core` | `https://integrate.uk.mixtelematics.com` |
| África do Sul | `https://identity.za.mixtelematics.com/core` | `https://integrate.za.mixtelematics.com` |
| Austrália | `https://identity.au.mixtelematics.com/core` | `https://integrate.au.mixtelematics.com` |
| Oriente Médio | `https://identity.om.mixtelematics.com/core` | `https://integrate.om.mixtelematics.com` |
| Homologação (UAT) | `https://identity.uat.mixtelematics.com/core` | `https://integrate.uat.mixtelematics.com` |

As URLs são editáveis na tela de integrações caso a Track7 informe um endpoint próprio.

## 2. Endpoints utilizados

| Uso | Método e rota |
|-----|---------------|
| Organizações visíveis ao login | `GET api/organisationgroups` |
| Hierarquia de grupos e sites | `GET api/organisationgroups/subgroups/{groupId}` |
| Veículos (assets) de um grupo | `GET api/assets/group/{groupId}` |
| Motoristas da organização | `GET api/drivers/organisation/{organisationId}` |
| Últimas posições por grupo | `POST api/positions/groups/latest/{quantity}` · body `[groupIds]` |
| Posições por período | `POST api/positions/assets/from/{from}/to/{to}` · body `[assetIds]` |
| Viagens por período | `POST api/trips/assets/from/{from}/to/{to}` · body `[assetIds]` |
| Eventos por período | `POST api/events/assets/from/{from}/to/{to}` · body `[assetIds]` |

**Formato de data nos segmentos de URL:** `yyyyMMddHHmmss` em **UTC**
(constante `DataFormats.DateTime_Format` da biblioteca oficial).

**Datas nas respostas** vêm sem fuso e são tratadas como UTC antes de gravar em
`timestamptz`.

**Lotes:** consultas por ativo são enviadas em blocos de 50 IDs.

**Resiliência:** *timeout* de 60 s, retentativa com *backoff* exponencial em `429` e
`5xx`, e renovação de token em `401`.

## 3. Mapeamento de campos

### Asset → `vehicles`

| API | Coluna |
|-----|--------|
| `AssetId` | `asset_id` (PK junto de `organization_id`) |
| `Description` | `description` |
| `RegistrationNumber` | `registration_number` (placa) |
| `FleetNumber` | `fleet_number` |
| `SiteId` | `site_id` → join com `t7_groups` |
| `Make` · `Model` · `Year` | `make` · `model` · `year` |
| `VinNumber` · `EngineNumber` · `SerialNumber` | idem |
| `FuelType` · `FuelTankCapacity` | `fuel_type` · `fuel_tank_capacity` |
| `Odometer` | `odometer_km` |
| `EngineHours` (`TimeSpan` .NET) | `engine_hours_seconds` (convertido) |
| `DefaultDriverId` | `default_driver_id` → join com `drivers` |
| *(payload completo)* | `raw` (jsonb) |

Veículos que deixam de vir da Track7 são marcados como `status = 'INACTIVE'` em vez de
excluídos — o histórico é preservado.

### Driver → `drivers`
`DriverId`, `SiteId`, `Name`, `EmployeeNumber`, `MobileNumber`, `Email`,
`ExtendedDriverId`, `Country`, `IsSystemDriver`, `raw`.

### Position → `positions` (+ `vehicle_last_position`)
`PositionId`, `AssetId`, `DriverId`, `Timestamp` → `recorded_at`, `Latitude`,
`Longitude`, `SpeedKilometresPerHour`, `SpeedLimit`, `AltitudeMetres`, `Heading`,
`OdometerKilometres`, `FormattedAddress`, `Source`.

### Trip → `trips`
`TripId`, `AssetId`, `DriverId`, `TripStart`/`TripEnd`, `FirstDepart`/`LastHalt`,
`DrivingTime`, `StandingTime`, `Duration`, `DistanceKilometers`, odômetros,
`MaxSpeedKilometersPerHour`, acelerações, `MaxRpm`, `FuelUsedLitres` e as posições de
início/fim (lat/lon/endereço).

### Event → `telemetry_events`
`EventId`, `AssetId`, `DriverId`, `EventTypeId`, `EventCategory`, `Description`,
`StartDateTime`/`EndDateTime`, `Value`/`ValueType`/`ValueUnits`, `SpeedLimit`,
`TotalTimeSeconds`, `TotalOccurances` e a posição inicial.

## 4. Fluxo da sincronização

`apps/api/src/modules/integration/sync-service.ts`

1. **organizacao** — `api/organisationgroups`; usa a organização configurada ou a primeira retornada (e a persiste).
2. **grupos** — `api/organisationgroups/subgroups/{id}`, achatando a árvore com nível e pai.
3. **veiculos** — `api/assets/group/{id}` para cada grupo alvo; upsert em lote.
4. **motoristas** — `api/drivers/organisation/{id}`.
5. **posicoes_atuais** — últimas posições por grupo; atualiza `vehicle_last_position`.
6. **viagens** e **eventos** — período desde a última sincronização (limitado por `history_days`).

Cada execução grava um registro em `sync_runs` com status, duração, contadores por etapa
e erro — visível em **Configurações › Integrações › Histórico**.

Um *lock* no Redis (`sync:{organizationId}`) impede duas sincronizações simultâneas.

## 5. Teste e diagnóstico

- **Testar conexão** (`POST /api/integrations/track7/test`) — autentica e lista as
  organizações visíveis; funciona com os campos ainda não salvos.
- **Diagnóstico** (`GET /api/integrations/track7/diagnostics`) — verifica credenciais,
  obtenção de token, organizações visíveis e volume de dados já sincronizado.
- **CLI** — `docker compose exec api node dist/cli/sync.js incremental`.
