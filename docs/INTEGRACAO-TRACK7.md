# Integração com a API oficial da Track7 (MiX Integrate)

A Track7 opera sobre a plataforma **MiX Telematics** (hoje apresentada como
**Unity · On-Road IoT**, da Powerfleet). A integração usa a API pública
**MiX Integrate**, e o contrato foi conferido campo a campo contra o
**Swagger oficial** publicado em `https://integrate.us.mixtelematics.com`
(`MiX.Integrate.Api` v1 — 185 rotas, 156 definições).

Implementação: `apps/api/src/modules/integration/track7-client.ts`.

## 0. Modo de integração (configuração da conta)

Na plataforma da Track7 um mesmo login pode enxergar **várias organizações** —
`api/organisationgroups` devolve uma lista. A conta escolhe como opera, em
**Configurações › Integrações › Modo de integração**:

| Modo | Quando usar | Como fica |
|------|-------------|-----------|
| **POR_OPERADORA** *(padrão)* | cada empresa tem o próprio contrato e as próprias chaves | uma credencial em cada operadora |
| **CONSORCIO** | a Track7 emite um acesso único que enxerga todas | uma credencial na conta; as empresas vêm da API |

No modo **CONSORCIO** o sistema deixa de pedir credencial empresa por empresa:
a lista de operadoras é derivada das organizações visíveis, e as credenciais
individuais ficam **guardadas mas ignoradas** — desligar o modo as reativa.

No modo **POR_OPERADORA** a credencial própria tem precedência e a compartilhada
funciona como reserva, o que torna a transição entre os modos suave.

### Travas da troca de modo

| Trava | Porquê |
|-------|--------|
| Só perfil **ADMIN** altera | é uma decisão estrutural da conta |
| Ligar o consórcio exige **autenticação real** na Track7 | credencial preenchida não é credencial que funciona |
| O acesso precisa enxergar ao menos uma organização | senão não há de onde derivar as empresas |
| `PUT /integrations/track7` é **bloqueado** no modo consórcio | evita dúvida sobre qual credencial vale |
| Quem trocou e quando fica registrado | em `organizations` e na trilha de auditoria |
| Nenhuma credencial é apagada na troca | voltar atrás precisa ser possível |

### Reconciliação automática

No modo consórcio o worker mantém a lista de empresas em dia com a API
(intervalo padrão: 60 minutos, em `discovery_interval_minutes`):

- organização nova na API → **operadora criada** com `source = DESCOBERTA`;
- organização que reaparece → `api_visible = true`, `api_last_seen_at` atualizado;
- organização que some → `api_visible = false`, **sem apagar nada**.

A última regra é deliberada: uma indisponibilidade momentânea da API não pode
destruir histórico de GPS. A empresa fica sinalizada na tela de Operadoras e a
decisão de removê-la é sempre humana.

O identificador da organização na Track7 (`track7_organisation_id`) é atributo da
**operadora**, não da credencial. É isso que permite um acesso só atender 33
empresas: cada operadora aponta para a sua organização dentro daquele login.

### Descoberta de operadoras

Com a credencial compartilhada salva, **Configurações › Integrações › Acesso único
da conta › Descobrir operadoras** lista as organizações visíveis e as compara com
as operadoras cadastradas:

| Situação | Significado |
|----------|-------------|
| Vinculada | já existe operadora apontando para essa organização |
| Nova | será criada |
| Conflito de nome | já há operadora com esse nome vinculada a outra organização — resolver à mão |

O vínculo por nome é feito sem acento e sem diferenciar maiúsculas. Nada é alterado
na pré-visualização; a criação só acontece ao confirmar.

Rotas: `GET/PUT /api/integrations/track7/shared` e `POST /api/integrations/track7/discover`
(com `apply: true` para efetivar).

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
| Eventos por período | `POST api/events/assets/from/{from}/to/{to}` · body **`EventFilter`** |
| Biblioteca de tipos de evento | `GET api/libraryevents/organisation/{organisationId}` |
| **Fluxo contínuo de posições** | `GET api/positions/groups/createdsince/organisation/{organisationId}/sincetoken/{t}/quantity/{q}` |

**Formato de data nos segmentos de URL:** `yyyyMMddHHmmss` em **UTC**
(constante `DataFormats.DateTime_Format` da biblioteca oficial).

**Datas nas respostas** vêm sem fuso e são tratadas como UTC antes de gravar em
`timestamptz`.

**Corpo de `api/events/*`:** diferente das demais rotas, eventos **não** aceitam uma
lista simples de IDs. O corpo é um objeto `EventFilter`:

```json
{ "EntityIds": [9001, 9002], "EventTypeIds": [], "MenuId": "" }
```

`EventTypeIds` vazio significa "todos os tipos"; preenchido, filtra por tipo de evento.

**Limite de 7 dias por consulta:** posições, viagens e eventos aceitam no máximo uma
janela de 7 dias por chamada. `splitWindows()` fatia períodos maiores automaticamente —
uma sincronização de 30 dias vira 5 chamadas sequenciais por lote de veículos.

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

> `Source` é **texto** no contrato (ex.: `"GPS"`), não um código numérico.

A consulta de últimas posições envia `ensureReverseGeocoded=true`, para que a API
devolva o endereço já resolvido em `FormattedAddress`.

### Trip → `trips`
`TripId`, `AssetId`, `DriverId`, `TripStart`/`TripEnd`, `FirstDepart`/`LastHalt`,
`DrivingTime`, `StandingTime`, `Duration`, `DistanceKilometers`, odômetros,
`MaxSpeedKilometersPerHour`, acelerações, `MaxRpm`, `FuelUsedLitres` e as posições de
início/fim (lat/lon/endereço).

> `Classification` é um **objeto** `{ Classification, Comment }`, com os valores
> `None` · `Business` · `Private`. A coluna `classification` guarda o primeiro campo.

### Event → `telemetry_events`
`EventId`, `AssetId`, `DriverId`, `EventTypeId`, `EventCategory`,
`StartDateTime`/`EndDateTime`, `Value`/`ValueType`/`ValueUnits`, `SpeedLimit`,
`TotalTimeSeconds`, `TotalOccurances` e a posição inicial.

> O evento **não** traz descrição. O nome legível vem de
> `api/libraryevents/organisation/{id}`, sincronizado na tabela `t7_event_types` e
> gravado em `telemetry_events.event_description` durante o upsert.

### LibraryEvent → `t7_event_types`
`EventTypeId`, `Description`, `EventType`, `DisplayUnits`, `FormatType`, `ValueName`.

### Group / GroupSummary → `t7_groups`
`GroupId`, `Name`, `Type`, `DisplayTimeZone` e `SubGroups` (recursivo).

> `Type` é um **enum em texto** (`OrganisationGroup`, `OrganisationSubGroup`,
> `SiteGroup`, `DefaultSite`, …) — guardado em `group_type_name` e traduzido na tela.

## 4. Fluxo da sincronização

`apps/api/src/modules/integration/sync-service.ts`

1. **organizacao** — `api/organisationgroups`; usa a organização configurada ou a primeira retornada (e a persiste).
2. **grupos** — `api/organisationgroups/subgroups/{id}`, achatando a árvore com nível e pai.
3. **veiculos** — `api/assets/group/{id}` para cada grupo alvo; upsert em lote.
4. **motoristas** — `api/drivers/organisation/{id}`.
5. **posicoes_atuais** — últimas posições por grupo; atualiza `vehicle_last_position`.
6. **tipos_evento** — `api/libraryevents/organisation/{id}`.
7. **viagens** e **eventos** — período desde a última sincronização (limitado por
   `history_days`), fatiado em janelas de 7 dias.

Cada execução grava um registro em `sync_runs` com status, duração, contadores por etapa
e erro — visível em **Configurações › Integrações › Histórico**.

Um *lock* no Redis (`sync:{organizationId}`) impede duas sincronizações simultâneas.

## 4.1. Coletor contínuo de posições (tempo real)

Endpoint indicado pelo suporte da Track7 e usado como fonte do histórico de GPS:

```
GET api/positions/groups/createdsince/organisation/{organisationId}
    /sincetoken/{sinceToken}/quantity/{quantity}
```

Funciona por **ponteiro**, não por período:

| Elemento | Regra |
|----------|-------|
| `sinceToken` | formato `yyyyMMddHHmmssfff` (UTC, com milissegundos); `NEW` começa do instante atual |
| Validade do token | **máximo 7 dias** — token mais antigo é recusado pela API |
| `quantity` | até **1000** posições por entidade |
| `HasMoreItems` (cabeçalho) | `true` enquanto houver fila; repita a chamada antes de dormir |
| `GetSinceToken` (cabeçalho) | ponteiro a usar na próxima chamada |

O ciclo implementado é o mesmo do exemplo oficial `MiX.Integrate.Samples.PositionStream`:
drena a fila enquanto `HasMoreItems` for true e aguarda **30 segundos** até o próximo ciclo.

O ponteiro é persistido em `stream_cursors` — sem isso, um reinício abriria buraco no
histórico. Se o coletor ficar parado a ponto de o token vencer, a lacuna é registrada em
`last_gap_from`/`last_gap_to` e preenchida pelo **backfill** por período
(`api/positions/assets/from/{from}/to/{to}`, em janelas de 7 dias).

Deduplicação é garantida pela chave primária `(organization_id, recorded_at, position_id)`:
reprocessar a mesma janela nunca duplica ping.

### Rotas de operação

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/integrations/track7/stream` | ponteiro atual, última coleta e volume das últimas 24 h |
| POST | `/api/integrations/track7/stream/collect` | executa um ciclo sob demanda |
| POST | `/api/integrations/track7/stream/seed` | reposiciona o ponteiro (data ou presente) |
| POST | `/api/integrations/track7/stream/backfill` | preenche lacunas por período |

## 5. Endpoints ainda não usados (disponíveis para o órgão gestor)

O Swagger expõe 185 rotas. Além das que já sincronizamos, estas são as candidatas mais
prováveis para atender exigências específicas:

| Necessidade | Rota |
|-------------|------|
| Consumo e abastecimento | `GET api/fueltransactions/organisation/{id}/from/{from}/to/{to}` |
| Jornada do motorista (HOS) | `POST api/ghos/events/from/{from}/to/{to}` · `POST api/ghos/violations/drivers/from/{from}/to/{to}` |
| Escore de condução | `POST api/trips/driverscore/standard/from/{from}/to/{to}` · `POST api/scoring/scorecard_flexibledriver` |
| Falhas eletrônicas (DTC) | `GET api/dtc/faultedassets/{groupId}` · `GET api/dtc/messages/{assetId}/{from}/{to}` |
| CNH e certificações | `GET api/driverlicence/group/{groupId}` · `GET api/drivercertification/group/{groupId}` |
| Manutenção e vistoria | `GET api/reminders/group/{groupId}/service` · `.../licence` · `.../roadworthy-certificate` |
| Histórico de manutenção | `GET api/assets/servicehistory/group/{groupId}/{from}/to/{to}` |
| Cercas e pontos de interesse | `GET api/locations/group/{groupId}` · `POST api/locations/group/{groupId}/inrange/{meters}` |
| Viagens planejadas / rotas | `GET api/journeys/routes/{groupId}` · `GET api/journeys/progress/{journeyId}` |
| Tacógrafo | `GET api/tachos/asset/{assetId}/range/from/{from}/to/{to}` |
| Sincronização incremental por token | `.../createdsince/sincetoken/{sinceToken}/quantity/{quantity}` |

> As rotas `createdsince/sincetoken` permitem trocar a janela por data por um ponteiro
> incremental — o caminho natural caso o volume da frota cresça.

## 6. Teste e diagnóstico

- **Testar conexão** (`POST /api/integrations/track7/test`) — autentica e lista as
  organizações visíveis; funciona com os campos ainda não salvos.
- **Diagnóstico** (`GET /api/integrations/track7/diagnostics`) — verifica credenciais,
  obtenção de token, organizações visíveis e volume de dados já sincronizado.
- **CLI** — `docker compose exec api node dist/cli/sync.js incremental`.
