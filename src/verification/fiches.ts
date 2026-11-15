/**
 * Accès aux fiches RP et synchronisation du pseudo « [Grade] Prénom Nom ».
 */
import { eq } from 'drizzle-orm';
import type { GuildMember } from 'discord.js';
import { db } from '../db/index.js';
import { fiches, type Fiche } from '../db/schema.js';
import { highestGrade, safeSetNickname, type OpError } from '../lib/members.js';
import { buildNickname } from '../lib/names.js';

export async function getFiche(userId: string): Promise<Fiche | undefined> {
  const [row] = await db.select().from(fiches).where(eq(fiches.userId, userId)).limit(1);
  return row;
}

export async function saveFiche(userId: string, prenom: string, nom: string, by: string): Promise<void> {
  await db
    .insert(fiches)
    .values({ userId, prenom, nom, updatedBy: by })
    .onConflictDoUpdate({ target: fiches.userId, set: { prenom, nom, updatedBy: by, updatedAt: new Date() } });
}

/** Pseudo attendu pour ce membre d'après sa fiche et son grade le plus haut. */
export function expectedNickname(member: GuildMember, fiche: Fiche): string {
  return buildNickname(highestGrade(member)?.prefix ?? null, fiche.prenom, fiche.nom);
}

/** Nom RP lisible (« Prénom Nom ») ou, à défaut, le nom affiché Discord. */
export async function displayRpName(member: GuildMember | null, userId: string): Promise<string> {
  const fiche = await getFiche(userId);
  if (fiche) return `${fiche.prenom} ${fiche.nom}`;
  return member?.displayName ?? `<@${userId}>`;
}

/**
 * Applique le pseudo attendu. Retourne :
 *  - { changed: false } si le membre n'a pas de fiche ou a déjà le bon pseudo ;
 *  - { changed: true, nick, error } sinon (error = null si le renommage a réussi).
 */
export async function syncNickname(
  member: GuildMember,
  reason: string,
): Promise<{ changed: false } | { changed: true; nick: string; error: OpError }> {
  const fiche = await getFiche(member.id);
  if (!fiche) return { changed: false };
  const nick = expectedNickname(member, fiche);
  if (member.nickname === nick) return { changed: false };
  const error = await safeSetNickname(member, nick, reason);
  return { changed: true, nick, error };
}
