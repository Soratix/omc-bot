/**
 * Journal console lisible avec `docker compose logs -f bot`.
 * Une ligne par événement, horodatée à l'heure de Paris.
 */

const fmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

type Level = 'INFO' | 'WARN' | 'ERREUR';

function write(level: Level, msg: string, err?: unknown): void {
  const line = `${fmt.format(new Date())} [${level}] ${msg}`;
  if (level === 'ERREUR') {
    console.error(line);
    if (err) console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg: string) => write('INFO', msg),
  warn: (msg: string) => write('WARN', msg),
  error: (msg: string, err?: unknown) => write('ERREUR', msg, err),
};
