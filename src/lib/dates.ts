/**
 * Utilitaires de dates. Toute la logique métier raisonne en jours calendaires
 * à l'heure de Paris, stockés au format ISO « AAAA-MM-JJ » (comparables comme des chaînes).
 * L'affichage se fait toujours au format JJ/MM/AAAA.
 */

export const TIMEZONE = 'Europe/Paris';

const isoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Date du jour à Paris, au format AAAA-MM-JJ. */
export function todayParis(now: Date = new Date()): string {
  return isoFmt.format(now);
}

/**
 * Convertit « JJ/MM/AAAA » (séparateurs / . ou - acceptés, jour et mois sur 1 ou 2 chiffres)
 * en AAAA-MM-JJ. Retourne null si la saisie n'est pas une date réelle.
 */
export function parseFrDate(input: string): string | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(input);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejette les dates impossibles (ex. 31/02) que Date « corrigerait ».
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return toIso(d);
}

/** AAAA-MM-JJ → JJ/MM/AAAA */
export function formatFr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Ajoute (ou retire) des jours à une date AAAA-MM-JJ. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return toIso(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Nombre de jours entre deux dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const toMs = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

/** Formate un instant en JJ/MM/AAAA à HH:MM (heure de Paris). */
export function formatFrDateTime(date: Date): string {
  const s = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return s.replace(' ', ' à ');
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
