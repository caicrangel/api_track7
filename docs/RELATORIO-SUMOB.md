# Relatório georreferenciado de viagem (SMMUR/SUMOB)

Modelo canônico para instruir contestações de cumprimento de itinerário, conforme o
**Ofício DGOD/TRANSFACIL nº 001/2026**.

Existe porque o ofício **rejeitou o relatório nativo da Track7**:

> *"o arquivo denominado 'RELATÓRIO DE VIAGEM 1', atribuído à fornecedora Track7,
> não apresenta os dados de latitude e longitude. Dessa forma, o arquivo não
> possibilita a reconstrução do trajeto percorrido e não será aceito como evidência."*

## 1. Estrutura do arquivo

Exatamente os cinco campos da alínea (c), na ordem em que o ofício os lista:

| # | Campo | Tipo | Formato | Exemplo |
|---|-------|------|---------|---------|
| 1 | `NUMERO_ORDEM` | texto | como cadastrado na Track7 | `20874` |
| 2 | `DATA` | data | `DD/MM/AAAA` | `13/04/2026` |
| 3 | `HORA` | hora | `HH:MM:SS` (24 h) | `12:31:07` |
| 4 | `LATITUDE` | decimal | graus decimais WGS-84, 6 casas, ponto decimal | `-19.916681` |
| 5 | `LONGITUDE` | decimal | graus decimais WGS-84, 6 casas, ponto decimal | `-43.934493` |

O modelo é deliberadamente enxuto. O ofício pede "no mínimo" esses campos, mas cada
coluna a mais é uma superfície a justificar na validação da alínea (b) — e a
associação com a viagem contestada já é feita pelo **nome do arquivo**, alínea (k).

**Ordenação:** cronológica crescente.
**Fuso horário:** local da conta (padrão `America/Sao_Paulo`). As posições chegam da
API em UTC e são convertidas na extração — o itinerário da SUMOB é especificado em
horário local, então entregar UTC invalidaria a comparação.

### Formatos

| | XLSX *(recomendado)* | CSV |
|---|---|---|
| Coordenadas | número real, sem ambiguidade | texto com ponto decimal |
| Separador de campos | — | `;` |
| Codificação | — | UTF-8 com BOM |
| Quebra de linha | — | CRLF |

O XLSX é preferível porque tipa as coordenadas: não há como um leitor interpretar
`-19.916681` como texto ou trocar o separador decimal.

## 2. Nome do arquivo

Alínea (k): exclusivamente o ID da viagem da planilha de apuração mais a extensão.

```
ID41257202604131231.xlsx
ID41257202604131231.csv
```

O sistema recusa IDs com espaço, barra ou qualquer caractere que não sirva em nome de
arquivo — *"não serão avaliados os arquivos cuja nomenclatura não corresponda ao ID da
viagem"*.

## 3. Integridade (alíneas e, f e g)

O ofício proíbe alteração manual, inclusão de imagens e qualquer edição do que foi
extraído. O sistema responde a isso pela própria arquitetura: **o arquivo é gerado
direto da API, sem humano no meio**.

Como evidência adicional, cada emissão registra em `sumob_exports`:

- o **SHA-256** do conteúdo exato entregue;
- veículo, número de ordem, período e decêndio;
- quantidade de registros, tamanho, formato e fuso;
- quem emitiu e quando.

`POST /api/reports/sumob/verificar` confere um hash contra todas as emissões daquele
ID de viagem — serve para provar que o arquivo em análise é o mesmo que saiu do sistema.

## 4. Decêndio (alínea h)

Calculado no fuso local a partir do início do período:

| Decêndio | Dias |
|----------|------|
| `AAAA-MM-D1` | 1 a 10 |
| `AAAA-MM-D2` | 11 a 20 |
| `AAAA-MM-D3` | 21 ao fim do mês |

É a chave de organização da pasta compartilhada exigida pelo ofício, junto da empresa
operadora.

## 5. Número de ordem do veículo

A Track7 tem três campos candidatos, e a convenção varia entre operadoras. Por isso é
configurável por empresa, em `operators.vehicle_order_field`:

| Valor | Campo na Track7 |
|-------|-----------------|
| `fleet_number` *(padrão)* | `FleetNumber` |
| `description` | `Description` |
| `registration_number` | `RegistrationNumber` |

**Confirme esse mapeamento antes da primeira contestação.** Sair o campo errado invalida
o arquivo inteiro, e o erro não é visível a olho nu.

## 6. Densidade de pings

O mérito da contestação é decidido pela Portaria SUMOB nº 048/2026: ping em **pelo menos
90% dos trechos** do itinerário.

A tela mostra o **intervalo médio entre pings** do período e alerta acima de 120 s. Um
ônibus urbano a 30 km/h percorre 500 m em um minuto — com amostragem esparsa, trechos
curtos ficam sem cobertura e a viagem reprova mesmo tendo sido cumprida.

> Medir isso com dados reais é a primeira verificação a fazer quando a conexão com a
> Track7 estiver ativa.

## 7. Rotas da API

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/reports/sumob/modelo` | modelo e dicionário de dados (`?format=csv` baixa o dicionário) |
| POST | `/api/reports/sumob/preview` | confere registros, intervalo médio e decêndio antes de emitir |
| POST | `/api/reports/sumob/arquivo` | emite o arquivo com o nome exigido e registra o hash |
| GET | `/api/reports/sumob/viagens` | viagens sincronizadas do veículo, para preencher o período |
| GET | `/api/reports/sumob/exports` | trilha das emissões |
| POST | `/api/reports/sumob/verificar` | confere um SHA-256 contra as emissões |

## 8. O que ainda falta

- **Validação do modelo pela SMMUR/SUMOB** — alínea (b): nada pode ser usado em
  contestação antes disso. `GET /modelo` é o material a submeter.
- **Importação da planilha de apuração** — hoje o ID da viagem é digitado. Com o layout
  da planilha, dá para importar o lote e emitir todos os arquivos de uma vez.
- **Pasta em nuvem** — alíneas (h), (i) e (j): organizar por operadora e decêndio e
  publicar no Drive/OneDrive/SharePoint, devolvendo o link.
- **Pré-validação dos 90%** — depende da geometria dos itinerários da SUMOB, que não
  vem da Track7.
