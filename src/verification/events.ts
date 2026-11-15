/**
 * Événements membres : arrivée (rôle Non vérifié) et changement de grade
 * (rôle commun du personnel + préfixe du pseudo).
 */
import type { GuildMember, PartialGuildMember } from 'discord.js';
import { gradeRoleIds } from '../config/grades.js';
import { env } from '../env.js';
import { roleId } from '../config/settings.js';
import { isStaff, safeAddRole, safeRemoveRole, type OpError } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { syncNickname } from './fiches.js';

export async function onMemberJoin(member: GuildMember): Promise<void> {
  if (member.guild.id !== env.GUILD_ID || member.user.bot) return;
  const error = await safeAddRole(member, 'non_verifie', 'Arrivée sur le serveur');
  await sendLog(member.guild, {
    title: '👋 Nouveau membre',
    description: error ? `⚠️ Rôle Non vérifié non attribué : ${error}` : 'Rôle **Non vérifié** attribué.',
    color: error ? LogColor.warning : LogColor.info,
    target: member.user,
  });
}

export async function onMemberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
  if (newMember.guild.id !== env.GUILD_ID || newMember.user.bot) return;

  // On ne réagit qu'aux ajouts/retraits de rôles de grade.
  const gradeIds = gradeRoleIds();
  const changed = oldMember.partial
    ? true
    : gradeIds.some((id) => oldMember.roles.cache.has(id) !== newMember.roles.cache.has(id));
  if (!changed) return;

  // Rôle commun du personnel (EMS) : présent dès qu'il y a au moins un grade.
  const staffRole = await syncStaffRole(newMember, 'Changement de grade');
  if (staffRole.changed) {
    await sendLog(newMember.guild, {
      title: staffRole.error ? '⚠️ Rôle du personnel non mis à jour' : staffRole.added ? '🩺 Rôle du personnel ajouté' : '🩺 Rôle du personnel retiré',
      description: staffRole.error ?? undefined,
      color: staffRole.error ? LogColor.warning : LogColor.info,
      target: newMember.user,
    });
  }

  const result = await syncNickname(newMember, 'Changement de grade');
  if (!result.changed) return;
  await sendLog(newMember.guild, {
    title: result.error ? '⚠️ Préfixe non mis à jour' : '🏷️ Préfixe de grade mis à jour',
    description: result.error ? `Pseudo attendu : **${result.nick}**\n${result.error}` : `Nouveau pseudo : **${result.nick}**`,
    color: result.error ? LogColor.warning : LogColor.info,
    target: newMember.user,
  });
}

/**
 * Ajoute le rôle « personnel » configuré (EMS) aux membres qui ont au moins un grade,
 * et le retire à ceux qui n'en ont plus aucun.
 */
export async function syncStaffRole(
  member: GuildMember,
  reason: string,
): Promise<{ changed: false } | { changed: true; added: boolean; error: OpError }> {
  const id = roleId('personnel');
  if (!id) return { changed: false };
  const shouldHave = isStaff(member);
  if (shouldHave === member.roles.cache.has(id)) return { changed: false };
  const error = shouldHave ? await safeAddRole(member, 'personnel', reason) : await safeRemoveRole(member, 'personnel', reason);
  return { changed: true, added: shouldHave, error };
}
