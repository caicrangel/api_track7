import { query } from '../db/pool.js';

export interface AuditInput {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Registro de auditoria — nunca deve derrubar a requisição principal. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (organization_id, user_id, action, entity, entity_id, metadata, ip)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        input.organizationId ?? null,
        input.userId ?? null,
        input.action,
        input.entity ?? null,
        input.entityId != null ? String(input.entityId) : null,
        JSON.stringify(input.metadata ?? {}),
        input.ip ?? null,
      ],
    );
  } catch {
    /* auditoria é best-effort */
  }
}
