import { defineConfig } from 'drizzle-kit';

// Utilisé uniquement en développement pour générer les migrations SQL (npm run db:generate).
// Les migrations sont ensuite appliquées automatiquement par le bot au démarrage.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
