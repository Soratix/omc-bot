/**
 * Règles métier des absences : rôle Absent, retour, prolongation, annulation.
 */
import type { Guild, GuildMember, User } from 'discord.js';
import type { Absence } from '../db/schema.js';
import { todayParis } from '../lib/dates.js';
import { safeAddRole, safeRemoveRole, type OpError } from '../lib/members.js';
import { refreshAbsencesPanel } from './panel.js';
import { refreshAbsenceMessage } from './render.js';
import { startedActiveFor, updateAbsence } from './repo.js';

/**
 * Met le rôle Absent en accord avec la base :
 * présent si le membre a au moins une absence active déjà commencée, retiré sinon.
 */
export async function syncAbsentRole(member: GuildMember, reason: string): Promise<OpError> {
  const started = await startedActiveFor(member.id, todayParis());
  return started.length ? safeAddRole(member, 'absent', reason) : safeRemoveRole(member, 'absent', reason);
}

async function afterChange(guild: Guild, a: Absence, reason: string): Promise<{ absence: Absence; roleError: OpError }> {
  const member = await guild.members.fetch(a.userId).catch(() => null);
  const roleError = member ? await syncAbsentRole(member, reason) : null;
  const absence = await refreshAbsenceMessage(guild, a);
  await refreshAbsencesPanel(guild);
  return { absence, roleError };
}

export async function markReturned(guild: Guild, a: Absence, by: User) {
  const updated = await updateAbsence(a.id, { status: 'terminee', closedAt: new Date(), closedBy: by.id });
  return afterChange(guild, updated, 'Retour d’absence');
}

export async function cancelAbsence(guild: Guild, a: Absence, by: User) {
  const updated = await updateAbsence(a.id, { status: 'annulee', closedAt: new Date(), closedBy: by.id });
  return afterChange(guild, updated, 'Absence annulée');
}

export async function extendAbsence(guild: Guild, a: Absence, newEnd: string) {
  const updated = await updateAbsence(a.id, {
    endDate: newEnd,
    status: 'en_cours',
    remindedOn: null,
    extensions: a.extensions + 1,
  });
  return afterChange(guild, updated, 'Absence prolongée');
}

/** Utilisé à la création : rôle immédiat si l'absence commence aujourd'hui (ou avant). */
export async function afterCreate(guild: Guild, a: Absence) {
  return afterChange(guild, a, 'Déclaration d’absence');
}
