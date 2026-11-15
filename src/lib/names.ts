/**
 * Validation et mise en forme des noms RP.
 *
 * Règles :
 *  - lettres (accents compris), espaces, tirets et apostrophes uniquement ;
 *  - majuscule en début de chaque mot (après espace, tiret ou apostrophe), le reste en minuscules ;
 *  - « Prénom Nom » ≤ MAX_RP_NAME_LENGTH caractères, pour que le pseudo final
 *    (préfixe de grade compris) tienne dans la limite Discord de 32 caractères.
 */

/** Longueur maximale de « Prénom Nom » : 32 − longueur du préfixe le plus long (« [Méd.] » + espace = 7). */
export const MAX_RP_NAME_LENGTH = 25;
export const DISCORD_NICK_LIMIT = 32;

const PART_RE = /^\p{L}+(?:[ '\-]\p{L}+)*$/u;

export type NameResult = { ok: true; value: string } | { ok: false; error: string };

/** Nettoie et met en forme un prénom ou un nom RP. `label` sert au message d'erreur. */
export function normalizeNamePart(raw: string, label: string): NameResult {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[’`´]/g, "'") // apostrophes typographiques → droite
    .replace(/\s+/g, ' ')
    .replace(/\s*([-'])\s*/g, '$1') // pas d'espace autour des tirets / apostrophes
    .trim();

  if (cleaned.length < 2) return { ok: false, error: `Le ${label} doit contenir au moins 2 lettres.` };
  if (!PART_RE.test(cleaned)) {
    return {
      ok: false,
      error: `Le ${label} ne peut contenir que des lettres, des espaces, des tirets et des apostrophes (pas de chiffres, d'emojis ni de symboles).`,
    };
  }

  const value = cleaned
    .toLocaleLowerCase('fr-FR')
    .replace(/(^|[ '\-])(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toLocaleUpperCase('fr-FR'));

  return { ok: true, value };
}

/** Valide le couple prénom/nom et retourne le nom complet mis en forme. */
export function validateRpName(
  prenomRaw: string,
  nomRaw: string,
): { ok: true; prenom: string; nom: string; full: string } | { ok: false; error: string } {
  const prenom = normalizeNamePart(prenomRaw, 'prénom');
  if (!prenom.ok) return prenom;
  const nom = normalizeNamePart(nomRaw, 'nom');
  if (!nom.ok) return nom;
  const full = `${prenom.value} ${nom.value}`;
  if (full.length > MAX_RP_NAME_LENGTH) {
    return {
      ok: false,
      error: `« ${full} » fait ${full.length} caractères : le prénom et le nom ensemble ne doivent pas dépasser ${MAX_RP_NAME_LENGTH} caractères (limite Discord avec le grade).`,
    };
  }
  return { ok: true, prenom: prenom.value, nom: nom.value, full };
}

/** Construit le pseudo final : « [Préfixe] Prénom Nom » ou « Prénom Nom ». */
export function buildNickname(prefix: string | null, prenom: string, nom: string): string {
  const base = `${prenom} ${nom}`;
  const nick = prefix ? `${prefix} ${base}` : base;
  return nick.slice(0, DISCORD_NICK_LIMIT);
}
