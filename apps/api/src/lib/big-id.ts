/**
 * Identificadores da Track7 chegam como number quando cabem em 2^53 e como
 * string quando não cabem (ver parseLossless no cliente). O Postgres guarda
 * todos em bigint e aceita string no parâmetro, então normalizar para string
 * decimal é o único caminho que não perde dígito em nenhuma das pontas.
 *
 * Devolve null para ausente ou malformado — quem chama decide se a linha é
 * descartável. Number() devolveria NaN, que o Postgres recusa com um erro que
 * não aponta para o campo culpado.
 */
export function bigId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^-?\d+$/.test(trimmed) ? trimmed : null;
  }
  return null;
}

/** Mesma normalização, para comparar dois ids de origens diferentes. */
export function sameId(a: unknown, b: unknown): boolean {
  const x = bigId(a);
  return x !== null && x === bigId(b);
}

/**
 * Schema Zod para um identificador da Track7 recebido pela API HTTP.
 * `z.coerce.number()` truncaria os ids longos — no relatório de contestação
 * isso extrairia as posições de outro veículo, sem erro visível.
 */
export const zBigId = (z: typeof import('zod').z) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const id = bigId(v);
    if (id === null) {
      ctx.addIssue({ code: 'custom', message: 'Identificador inválido.' });
      return z.NEVER;
    }
    return id;
  });
