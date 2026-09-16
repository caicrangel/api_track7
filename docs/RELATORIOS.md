# Como criar um relatório

O módulo de relatórios é **declarativo**: a API descreve parâmetros e colunas, e o
front-end monta formulário, tabela e exportação automaticamente. Não há código de
interface por relatório.

Arquivo: `apps/api/src/modules/reports/report-catalog.ts`.

## Anatomia de uma definição

```ts
{
  code: 'multas-por-veiculo',          // identificador na URL: /api/reports/{code}/run
  name: 'Multas por veículo',
  description: 'Texto exibido acima do formulário.',
  category: 'CONFORMIDADE',            // FROTA | OPERACAO | SEGURANCA | CONFORMIDADE

  params: [
    { name: 'from', label: 'Início', type: 'date', required: true },
    { name: 'to',   label: 'Fim',    type: 'date', required: true },
    { name: 'siteId', label: 'Grupo/Site', type: 'select-site' },
  ],

  columns: [
    { key: 'veiculo',      label: 'Veículo' },
    { key: 'placa',        label: 'Placa' },
    { key: 'ocorrencias',  label: 'Ocorrências', type: 'number' },
    { key: 'tempo_total',  label: 'Tempo total', type: 'duration' },
    { key: 'ocorrido_em',  label: 'Data',        type: 'datetime' },
  ],

  build: (organizationId, params) => ({
    sql: `SELECT ... WHERE e.organization_id = $1 AND e.start_at BETWEEN $2 AND $3`,
    values: [organizationId, params.from, params.to],
  }),
}
```

### Tipos de parâmetro

| `type` | Controle renderizado |
|--------|----------------------|
| `date` | seletor de data |
| `number` | campo numérico |
| `text` | campo de texto |
| `select-vehicle` | lista de veículos sincronizados |
| `select-site` | lista de grupos/sites |
| `select-driver` | lista de motoristas |

### Tipos de coluna

| `type` | Formatação aplicada |
|--------|---------------------|
| *(omitido)* | texto cru |
| `number` | inteiro com separador de milhar |
| `decimal` | duas casas decimais |
| `datetime` | `dd/mm/aaaa hh:mm` |
| `duration` | segundos → `12h 30min` |

## Regras

1. **Sempre** filtre por `organization_id = $1` — é a fronteira de isolamento entre organizações.
2. Use apenas parâmetros posicionais (`$1`, `$2`, …); nunca interpole valores na string SQL.
3. As chaves de `columns` precisam bater com os apelidos das colunas do `SELECT`.
4. Relatórios muito extensos devem trazer `LIMIT` — o teto de exportação é 50.000 linhas.
5. Toda execução é registrada em `report_executions` (usuário, parâmetros, linhas, duração).

## Tabelas disponíveis

| Tabela | Conteúdo |
|--------|----------|
| `vehicles` | frota sincronizada |
| `drivers` | motoristas |
| `t7_groups` | grupos e sites (hierarquia) |
| `vehicle_last_position` | última posição por veículo |
| `positions` | histórico de posições (particionada por mês) |
| `trips` | viagens |
| `telemetry_events` | eventos de telemetria |

Depois de acrescentar a definição, reinicie a API (`docker compose restart api`): o
relatório aparece no catálogo da tela e no espelho em `report_definitions`.
