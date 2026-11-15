/**
 * Connexion PostgreSQL et application des migrations au démarrage.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { logger } from '../logger.js';
import * as schema from './schema.js';

const sql = postgres(env.DATABASE_URL, { max: 5, onnotice: () => {} });
export const db = drizzle(sql, { schema });

/** Dossier des migrations SQL générées par drizzle-kit (racine du projet). */
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Attend que la base réponde, puis applique les migrations en attente. */
export async function initDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await sql`select 1`;
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      logger.warn(`Base de données injoignable (tentative ${attempt}/30), nouvel essai dans 2 s…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await migrate(db, { migrationsFolder });
  logger.info('Base de données prête (migrations appliquées).');
}

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
