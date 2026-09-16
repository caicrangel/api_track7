/**
 * Relatório georreferenciado de viagem — modelo SMMUR/SUMOB.
 *
 * Atende ao Ofício DGOD/TRANSFACIL nº 001/2026, que rejeitou o relatório
 * nativo da Track7 por não trazer latitude e longitude. A alínea (c) exige,
 * no mínimo, cinco campos por registro:
 *
 *   I. número de ordem do veículo   II. data   III. hora
 *   IV. latitude                     V. longitude
 *
 * O modelo é deliberadamente enxuto: exatamente os campos exigidos, na ordem
 * em que o ofício os lista. Cada coluna a mais é uma superfície a explicar na
 * validação da alínea (b), e a associação com a viagem contestada é feita pelo
 * nome do arquivo, como manda a alínea (k).
 */
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { rows } from '../../db/pool.js';
import { badRequest } from '../../lib/errors.js';

export type SumobFormat = 'csv' | 'xlsx';

export interface SumobColumn {
  key: string;
  label: string;
  type: 'texto' | 'data' | 'hora' | 'decimal';
  description: string;
  format: string;
  example: string;
}

/** Dicionário de dados exigido pela alínea (l). */
export const SUMOB_COLUMNS: SumobColumn[] = [
  {
    key: 'numero_ordem',
    label: 'NUMERO_ORDEM',
    type: 'texto',
    description: 'Número de ordem do veículo na frota da empresa operadora.',
    format: 'Texto, como cadastrado na plataforma de telemetria.',
    example: '20874',
  },
  {
    key: 'data',
    label: 'DATA',
    type: 'data',
    description: 'Data do registro de localização, no fuso horário local.',
    format: 'DD/MM/AAAA',
    example: '13/04/2026',
  },
  {
    key: 'hora',
    label: 'HORA',
    type: 'hora',
    description: 'Hora do registro de localização, no fuso horário local.',
    format: 'HH:MM:SS (24 horas)',
    example: '12:31:07',
  },
  {
    key: 'latitude',
    label: 'LATITUDE',
    type: 'decimal',
    description: 'Latitude do veículo no instante do registro.',
    format: 'Graus decimais (WGS-84), 6 casas, ponto como separador decimal. Negativo no hemisfério sul.',
    example: '-19.916681',
  },
  {
    key: 'longitude',
    label: 'LONGITUDE',
    type: 'decimal',
    description: 'Longitude do veículo no instante do registro.',
    format: 'Graus decimais (WGS-84), 6 casas, ponto como separador decimal. Negativo a oeste de Greenwich.',
    example: '-43.934493',
  },
];

export interface SumobRow {
  numero_ordem: string;
  data: string;
  hora: string;
  latitude: number;
  longitude: number;
}

export interface SumobExtraction {
  rows: SumobRow[];
  assetId: number;
  vehicleOrder: string;
  timezone: string;
  from: Date;
  to: Date;
}

/** Colunas da Track7 que podem representar o número de ordem. */
const ORDER_FIELDS = new Set(['fleet_number', 'description', 'registration_number']);

/**
 * Extrai os pings de um veículo num período, já no fuso local.
 *
 * As posições são gravadas em UTC; o itinerário da SUMOB é especificado em
 * horário local, então a conversão acontece no banco, com o fuso da conta.
 */
export async function extractSumobRows(options: {
  operatorId: string;
  assetId: number;
  from: Date;
  to: Date;
  timezone: string;
  vehicleOrderField: string;
}): Promise<SumobExtraction> {
  const { operatorId, assetId, from, to, timezone } = options;
  const orderField = ORDER_FIELDS.has(options.vehicleOrderField)
    ? options.vehicleOrderField
    : 'fleet_number';

  if (from >= to) throw badRequest('O início do período precisa ser anterior ao fim.');

  const data = await rows<{
    numero_ordem: string | null;
    data: string;
    hora: string;
    latitude: number;
    longitude: number;
  }>(
    `SELECT v.${orderField}                                            AS numero_ordem,
            to_char(p.recorded_at AT TIME ZONE $4, 'DD/MM/YYYY')       AS data,
            to_char(p.recorded_at AT TIME ZONE $4, 'HH24:MI:SS')       AS hora,
            round(p.latitude::numeric, 6)                              AS latitude,
            round(p.longitude::numeric, 6)                             AS longitude
       FROM positions p
       JOIN vehicles v ON v.operator_id = p.operator_id AND v.asset_id = p.asset_id
      WHERE p.operator_id = $1
        AND p.asset_id = $2
        AND p.recorded_at >= $3 AND p.recorded_at <= $5
        AND p.latitude IS NOT NULL
        AND p.longitude IS NOT NULL
      ORDER BY p.recorded_at ASC`,
    [operatorId, assetId, from, timezone, to],
  );

  const vehicleOrder = data[0]?.numero_ordem ?? '';

  return {
    rows: data.map((r) => ({
      numero_ordem: r.numero_ordem ?? '',
      data: r.data,
      hora: r.hora,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    })),
    assetId,
    vehicleOrder,
    timezone,
    from,
    to,
  };
}

/**
 * CSV no padrão aceito pelo órgão: separador ";", UTF-8 com BOM e quebra
 * CRLF — abre direto no Excel em pt-BR. O separador decimal das coordenadas
 * é o ponto, para não conflitar com o separador de campos.
 */
export function toSumobCsv(extraction: SumobExtraction): Buffer {
  const header = SUMOB_COLUMNS.map((c) => c.label).join(';');
  const lines = extraction.rows.map((row) =>
    [
      row.numero_ordem,
      row.data,
      row.hora,
      row.latitude.toFixed(6),
      row.longitude.toFixed(6),
    ].join(';'),
  );
  return Buffer.from(`﻿${[header, ...lines].join('\r\n')}\r\n`, 'utf8');
}

/**
 * XLSX com os tipos corretos: datas e horas como texto no formato exigido,
 * coordenadas como número. Elimina qualquer ambiguidade de separador decimal.
 */
export async function toSumobXlsx(extraction: SumobExtraction): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FleetGov';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('REGISTROS');
  sheet.columns = SUMOB_COLUMNS.map((column) => ({
    header: column.label,
    key: column.key,
    width: column.type === 'decimal' ? 16 : 14,
  }));

  sheet.getRow(1).font = { bold: true };

  for (const row of extraction.rows) {
    const added = sheet.addRow(row);
    added.getCell('latitude').numFmt = '0.000000';
    added.getCell('longitude').numFmt = '0.000000';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Decêndio do período (alínea h): 1 = dias 1 a 10, 2 = 11 a 20,
 * 3 = 21 ao fim do mês. Calculado no fuso local.
 */
export function decendioOf(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = Number(get('day'));
  const index = day <= 10 ? 1 : day <= 20 ? 2 : 3;
  return `${get('year')}-${get('month')}-D${index}`;
}

/**
 * Nome do arquivo conforme a alínea (k): exclusivamente o ID da viagem da
 * planilha de apuração mais a extensão. Nome fora do padrão nem é avaliado,
 * então qualquer caractere que não sirva em sistema de arquivos é recusado.
 */
export function sumobFileName(tripExternalId: string, format: SumobFormat): string {
  const id = tripExternalId.trim();
  if (!id) throw badRequest('Informe o ID da viagem constante da planilha de apuração.');
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw badRequest(
      'O ID da viagem só pode conter letras, números, ponto, hífen e sublinhado — ' +
        'o arquivo é nomeado exatamente com ele.',
    );
  }
  return `${id}.${format}`;
}

export function sha256Of(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Dicionário de dados em formato tabular, para entregar ao órgão gestor. */
export function dataDictionaryRows() {
  return SUMOB_COLUMNS.map((column, index) => ({
    ordem: index + 1,
    campo: column.label,
    tipo: column.type,
    significado: column.description,
    formato: column.format,
    exemplo: column.example,
  }));
}
