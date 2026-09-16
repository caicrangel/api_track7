export interface CsvColumn {
  key: string;
  label: string;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * CSV com separador ";" e BOM — abre corretamente no Excel em pt-BR.
 */
export function toCsv(data: Array<Record<string, unknown>>, columns: CsvColumn[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(';');
  const lines = data.map((row) => columns.map((c) => escapeCell(row[c.key])).join(';'));
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}
