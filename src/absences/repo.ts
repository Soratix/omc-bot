/**
 * Accès base de données pour les absences.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { absences, type Absence } from '../db/schema.js';

export const ACTIVE_STATUSES = ['en_cours', 'non_confirmee'] as const;

export const isActive = (a: Absence) => (ACTIVE_STATUSES as readonly string[]).includes(a.status);

export async function getAbsence(id: number): Promise<Absence | undefined> {
  const [row] = await db.select().from(absences).where(eq(absences.id, id)).limit(1);
  return row;
}

export async function createAbsence(values: { userId: string; startDate: string; endDate: string; reason: string | null }): Promise<Absence> {
  const [row] = await db.insert(absences).values(values).returning();
  return row!;
}

export async function updateAbsence(id: number, values: Partial<Omit<Absence, 'id'>>): Promise<Absence> {
  const [row] = await db.update(absences).set(values).where(eq(absences.id, id)).returning();
  return row!;
}

/** Absences en cours ou à venir (non terminées, non annulées), triées par date de début. */
export async function listActive(): Promise<Absence[]> {
  return db.select().from(absences).where(inArray(absences.status, [...ACTIVE_STATUSES])).orderBy(asc(absences.startDate));
}

/** Absences actives d'un membre qui chevauchent la période donnée (hors `excludeId`). */
export async function findOverlapping(userId: string, start: string, end: string, excludeId?: number): Promise<Absence[]> {
  const rows = await db
    .select()
    .from(absences)
    .where(
      and(
        eq(absences.userId, userId),
        inArray(absences.status, [...ACTIVE_STATUSES]),
        lte(absences.startDate, end),
        gte(absences.endDate, start),
      ),
    );
  return rows.filter((r) => r.id !== excludeId);
}

/** Absences actives d'un membre déjà commencées à la date donnée. */
export async function startedActiveFor(userId: string, today: string): Promise<Absence[]> {
  return db
    .select()
    .from(absences)
    .where(and(eq(absences.userId, userId), inArray(absences.status, [...ACTIVE_STATUSES]), lte(absences.startDate, today)));
}

/** Fiches terminées ou annulées dont le message est encore publié. */
export async function closedWithMessage(): Promise<Absence[]> {
  return db
    .select()
    .from(absences)
    .where(and(inArray(absences.status, ['terminee', 'annulee']), isNotNull(absences.messageId)));
}
