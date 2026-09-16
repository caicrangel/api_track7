import { one, query } from './db/pool.js';
import { runMigrations, ensurePartitions } from './db/migrate.js';
import { env } from './env.js';
import { hashPassword } from './lib/crypto.js';
import { saveCredentials, getCredentialRow } from './modules/integration/credentials.js';
import { REPORTS } from './modules/reports/report-catalog.js';

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'organizacao';
}

export interface BootstrapResult {
  organizationId: string;
  createdAdmin: boolean;
}

/** Prepara o banco: migrações, organização inicial, admin e catálogo de relatórios. */
export async function bootstrap(log: (msg: string) => void = console.log): Promise<BootstrapResult> {
  await runMigrations(log);
  await ensurePartitions();

  let org = await one<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`);
  if (!org) {
    org = await one<{ id: string }>(
      `INSERT INTO organizations (name, slug, timezone, settings)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [
        env.BOOTSTRAP_ORG_NAME,
        slugify(env.BOOTSTRAP_ORG_NAME),
        env.TZ,
        JSON.stringify({
          brandName: 'FleetGov',
          primaryColor: '#16a34a',
          offlineThresholdHours: 24,
          speedLimitDefault: 80,
        }),
      ],
    );
    log(`[bootstrap] organização criada: ${env.BOOTSTRAP_ORG_NAME}`);
  }

  const organizationId = org!.id;

  const admin = await one<{ id: string }>(`SELECT id FROM users WHERE organization_id = $1 LIMIT 1`, [
    organizationId,
  ]);
  let createdAdmin = false;
  if (!admin) {
    await query(
      `INSERT INTO users (organization_id, name, email, password_hash, role, must_change_password)
       VALUES ($1,$2,$3,$4,'ADMIN', true)`,
      [
        organizationId,
        env.BOOTSTRAP_ADMIN_NAME,
        env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
        await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD),
      ],
    );
    createdAdmin = true;
    log(`[bootstrap] administrador criado: ${env.BOOTSTRAP_ADMIN_EMAIL}`);
  }

  // Credenciais Track7 vindas do .env (apenas na primeira vez)
  const credentials = await getCredentialRow(organizationId);
  const hasEnvCredentials = Boolean(env.TRACK7_CLIENT_ID && env.TRACK7_CLIENT_SECRET && env.TRACK7_USERNAME);
  if (!credentials || (!credentials.client_id_enc && hasEnvCredentials)) {
    await saveCredentials(organizationId, {
      region: 'us',
      identityUrl: env.TRACK7_IDENTITY_URL,
      apiUrl: env.TRACK7_API_URL,
      scope: env.TRACK7_SCOPE,
      clientId: env.TRACK7_CLIENT_ID,
      clientSecret: env.TRACK7_CLIENT_SECRET,
      username: env.TRACK7_USERNAME,
      password: env.TRACK7_PASSWORD,
      organisationId: env.TRACK7_ORGANISATION_ID ? Number(env.TRACK7_ORGANISATION_ID) : null,
      syncEnabled: env.SYNC_ENABLED,
      syncCron: env.SYNC_CRON,
      historyDays: env.SYNC_HISTORY_DAYS,
    });
    log(
      hasEnvCredentials
        ? '[bootstrap] credenciais Track7 carregadas do .env'
        : '[bootstrap] integração Track7 preparada (credenciais pendentes)',
    );
  }

  // Catálogo de relatórios do sistema espelhado no banco
  for (const report of REPORTS) {
    await query(
      `INSERT INTO report_definitions (organization_id, code, name, description, category, is_system, config)
       VALUES (NULL, $1, $2, $3, $4, true, $5::jsonb)
       ON CONFLICT (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code)
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
                     category = EXCLUDED.category, config = EXCLUDED.config, updated_at = now()`,
      [
        report.code,
        report.name,
        report.description,
        report.category,
        JSON.stringify({ params: report.params, columns: report.columns }),
      ],
    );
  }

  return { organizationId, createdAdmin };
}
