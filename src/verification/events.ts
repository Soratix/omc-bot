/**
 * Événements membres : arrivée (rôle Non vérifié) et changement de grade (préfixe du pseudo).
 */
import type { GuildMember, PartialGuildMember } from 'discord.js';
import { GRADES } from '../config/keys.js';
import { roleId } from '../config/settings.js';
import { env } from '../env.js';
import { safeAddRole } from '../lib/members.js';
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
  const gradeIds = GRADES.map((g) => roleId(g.key)).filter((id): id is string => !!id);
  const changed = oldMember.partial
    ? true
    : gradeIds.some((id) => oldMember.roles.cache.has(id) !== newMember.roles.cache.has(id));
  if (!changed) return;

  const result = await syncNickname(newMember, 'Changement de grade');
  if (!result.changed) return;
  await sendLog(newMember.guild, {
    title: result.error ? '⚠️ Préfixe non mis à jour' : '🏷️ Préfixe de grade mis à jour',
    description: result.error ? `Pseudo attendu : **${result.nick}**\n${result.error}` : `Nouveau pseudo : **${result.nick}**`,
    color: result.error ? LogColor.warning : LogColor.info,
    target: newMember.user,
  });
}
