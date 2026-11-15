/**
 * Accès base de données des tickets et des types de tickets.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ticketTypes, tickets, type Ticket, type TicketType } from '../db/schema.js';

export async function listTypes(includeDisabled = false): Promise<TicketType[]> {
  const rows = await db.select().from(ticketTypes).orderBy(asc(ticketTypes.id));
  return includeDisabled ? rows : rows.filter((t) => t.enabled);
}

export async function getType(id: number): Promise<TicketType | undefined> {
  const [row] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, id)).limit(1);
  return row;
}

export async function createType(values: typeof ticketTypes.$inferInsert): Promise<TicketType> {
  const [row] = await db.insert(ticketTypes).values(values).returning();
  return row!;
}

export async function updateType(id: number, values: Partial<typeof ticketTypes.$inferInsert>): Promise<TicketType> {
  const [row] = await db.update(ticketTypes).set(values).where(eq(ticketTypes.id, id)).returning();
  return row!;
}

export async function getTicket(id: number): Promise<Ticket | undefined> {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return row;
}

export async function getTicketByChannel(channelId: string): Promise<Ticket | undefined> {
  const [row] = await db.select().from(tickets).where(eq(tickets.channelId, channelId)).limit(1);
  return row;
}

/** Ticket ouvert d'un membre pour un type donné (limite : un seul à la fois). */
export async function openTicketOf(userId: string, typeId: number): Promise<Ticket | undefined> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.userId, userId), eq(tickets.typeId, typeId), eq(tickets.status, 'ouvert')))
    .limit(1);
  return row;
}

export async function createTicket(values: typeof tickets.$inferInsert): Promise<Ticket> {
  const [row] = await db.insert(tickets).values(values).returning();
  return row!;
}

export async function updateTicket(id: number, values: Partial<typeof tickets.$inferInsert>): Promise<Ticket> {
  const [row] = await db.update(tickets).set(values).where(eq(tickets.id, id)).returning();
  return row!;
}

export async function allTickets(): Promise<Ticket[]> {
  return db.select().from(tickets);
}
