/**
 * Grades de l'hôpital (rôle Discord → préfixe de pseudo), stockés en base avec cache mémoire.
 * L'ordre des grades suit la hiérarchie des rôles du serveur : pas d'ordre à maintenir ici.
 */
import { eq } from 'drizzle-orm';
import type { GuildMember } from 'discord.js';
import { db } from '../db/index.js';
import { grades, type GradeRow } from '../db/schema.js';

/** Longueur maximale d'un préfixe : avec l'espace, « Préfixe Prénom Nom » tient dans 32 caractères. */
export const MAX_PREFIX_LENGTH = 6;

export interface Grade {
  roleId: string;
  prefix: string;
  direction: boolean;
  /** Nom du rôle sur le serveur. */
  label: string;
}

const cache = new Map<string, GradeRow>();

export async function loadGrades(): Promise<void> {
  cache.clear();
  for (const row of await db.select().from(grades)) cache.set(row.roleId, row);
}

export async function upsertGrade(roleId: string, prefix: string, direction: boolean): Promise<void> {
  const [row] = await db
    .insert(grades)
    .values({ roleId, prefix, direction })
    .onConflictDoUpdate({ target: grades.roleId, set: { prefix, direction, updatedAt: new Date() } })
    .returning();
  cache.set(roleId, row!);
}

export async function removeGrade(roleId: string): Promise<boolean> {
  const deleted = await db.delete(grades).where(eq(grades.roleId, roleId)).returning();
  cache.delete(roleId);
  return deleted.length > 0;
}

export function allGrades(): GradeRow[] {
  return [...cache.values()];
}

export function gradeRoleIds(): string[] {
  return [...cache.keys()];
}

/** Grade du membre dont le rôle est le plus haut dans la hiérarchie du serveur, ou null. */
export function highestGrade(member: GuildMember): Grade | null {
  let best: Grade | null = null;
  let bestPos = -1;
  for (const row of cache.values()) {
    const role = member.roles.cache.get(row.roleId);
    if (role && role.position > bestPos) {
      bestPos = role.position;
      best = { roleId: row.roleId, prefix: row.prefix, direction: row.direction, label: role.name };
    }
  }
  return best;
}

/** Le membre a-t-il au moins un grade marqué « direction » ? */
export function hasDirectionGrade(member: GuildMember): boolean {
  for (const row of cache.values()) {
    if (row.direction && member.roles.cache.has(row.roleId)) return true;
  }
  return false;
}
