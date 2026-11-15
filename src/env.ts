/**
 * Lecture et validation des variables d'environnement.
 * Le bot refuse de démarrer si une variable obligatoire manque.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  }
  return value;
}

function intOr(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) throw new Error(`${name} doit être un entier positif (reçu : ${raw})`);
  return n;
}

export const env = {
  DISCORD_TOKEN: required('DISCORD_TOKEN'),
  /** Serveur Discord de l'OMC : les commandes y sont enregistrées directement. */
  GUILD_ID: required('GUILD_ID'),
  DATABASE_URL: required('DATABASE_URL'),
  /** Heure de la tâche quotidienne des absences (heure de Paris). */
  ABSENCE_CHECK_HOUR: intOr('ABSENCE_CHECK_HOUR', 9),
  /** Nombre de jours sans réponse au rappel avant le statut « Retour non confirmé ». */
  ABSENCE_CONFIRM_DAYS: intOr('ABSENCE_CONFIRM_DAYS', 2),
} as const;
