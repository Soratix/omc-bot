/**
 * Contexte d'un changement de grade fait via /grade : qui l'a fait et pourquoi.
 *
 * Le changement de rôle déclenche ensuite les événements Discord habituels (préfixe, EMS, dossier) ;
 * ce contexte permet à ces événements d'inscrire l'auteur et le motif dans le dossier.
 * Il expire au bout de 30 secondes.
 */
interface GradeContext {
  byUserId: string;
  reason: string | null;
  expires: number;
}

const contexts = new Map<string, GradeContext>();

export function setGradeContext(userId: string, byUserId: string, reason: string | null): void {
  contexts.set(userId, { byUserId, reason, expires: Date.now() + 30_000 });
}

export function peekGradeContext(userId: string): { byUserId: string; reason: string | null } | null {
  const ctx = contexts.get(userId);
  if (!ctx) return null;
  if (ctx.expires < Date.now()) {
    contexts.delete(userId);
    return null;
  }
  return ctx;
}

/** Texte « \nMotif : … » à ajouter à un événement, ou chaîne vide. */
export function reasonSuffix(ctx: { reason: string | null } | null): string {
  return ctx?.reason ? `\nMotif : ${ctx.reason}` : '';
}
