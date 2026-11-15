/**
 * Événements membres : arrivée (rôle Non vérifié) et changement de grade
 * (rôle commun du personnel + préfixe du pseudo).
 */
import type { Guild, GuildMember, PartialGuildMember } from 'discord.js';
import { gradeRoleIds, hasDirectionGrade } from '../config/grades.js';
import { env } from '../env.js';
import { autoRoleIds, roleId } from '../config/settings.js';
import { addDossierEvent, archiveOnLeave, reconcileDossier } from '../dossiers/service.js';
import { peekGradeContext, reasonSuffix } from '../grades/context.js';
import { changeRoleById, highestGrade, isStaff, safeAddRole, type OpError } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { syncNickname } from './fiches.js';

export async function onMemberJoin(member: GuildMember): Promise<void> {
  if (member.guild.id !== env.GUILD_ID || member.user.bot) return;
  const errors = [await safeAddRole(member, 'non_verifie', 'Arrivée sur le serveur')];
  const extra = autoRoleIds('arrivee');
  for (const id of extra) errors.push(await changeRoleById(member, id, 'add', 'Arrivée sur le serveur'));
  const error = errors.filter((e): e is string => !!e).join('\n') || null;
  await sendLog(member.guild, {
    title: '👋 Nouveau membre',
    description: error
      ? `⚠️ Rôles d’arrivée non attribués :\n${error}`
      :`Rôles attribués : **Non vérifié**${extra.map((id) => `, <@&${id}>`).join('')}.`,
    color: error ? LogColor.warning : LogColor.info,
    target: member.user,
    alert: !!error,
  });
}

export async function onMemberLeave(member: GuildMember | PartialGuildMember): Promise<void> {
  if (member.guild.id !== env.GUILD_ID || member.user?.bot) return;
  if (await archiveOnLeave(member.guild, member.id)) {
    await sendLog(member.guild, { title: '🗄️ Dossier archivé (départ du serveur)', color: LogColor.neutral, target: member.user ?? undefined });
  }
}

export async function onMemberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
  if (newMember.guild.id !== env.GUILD_ID || newMember.user.bot) return;

  // On ne réagit qu'aux ajouts/retraits de rôles de grade ou du rôle du personnel (EMS).
  const personnelId = roleId('personnel');
  const watched = personnelId ? [...gradeRoleIds(), personnelId] : gradeRoleIds();
  const changed = oldMember.partial
    ? true
    : watched.some((id) => oldMember.roles.cache.has(id) !== newMember.roles.cache.has(id));
  if (!changed) return;

  // Dossier du personnel : créé / rouvert / archivé selon le rôle EMS.
  const dossier = await reconcileDossier(newMember);
  if (dossier) {
    const titles = { cree: '📁 Dossier du personnel créé', rouvert: '📁 Dossier du personnel rouvert', archive: '🗄️ Dossier du personnel archivé' };
    await sendLog(newMember.guild, { title: titles[dossier], color: LogColor.info, target: newMember.user });
  }

  // Changement de grade inscrit dans le dossier : promotion si le nouveau grade est plus haut
  // dans la hiérarchie des rôles, rétrogradation sinon. Le premier grade (embauche), le retour
  // (réintégration) et le retrait de tous les grades (départ) sont inscrits par reconcileDossier.
  if (!oldMember.partial && !dossier) {
    const before = highestGrade(oldMember);
    const after = highestGrade(newMember);
    if (before && after && before.roleId !== after.roleId) {
      const pos = (id: string) => newMember.guild.roles.cache.get(id)?.position ?? 0;
      const type = pos(after.roleId) > pos(before.roleId) ? 'promotion' : 'retrogradation';
      const ctx = peekGradeContext(newMember.id);
      await addDossierEvent(newMember.guild, newMember.id, type, `**${before.label}** → **${after.label}**${reasonSuffix(ctx)}`, ctx?.byUserId);
    }
  }

  // Rôles liés aux grades : EMS (tout grade) et Direction (grades « direction »).
  for (const change of await syncLinkedRoles(newMember, 'Changement de grade')) {
    await sendLog(newMember.guild, {
      title: change.error ? `⚠️ ${change.label} non mis à jour` : `${change.emoji} ${change.label} ${change.added ? 'ajouté' : 'retiré'}`,
      description: change.error ?? undefined,
      color: change.error ? LogColor.warning : LogColor.info,
      alert: !!change.error,
      target: newMember.user,
    });
  }

  const result = await syncNickname(newMember, 'Changement de grade');
  if (!result.changed) return;
  await sendLog(newMember.guild, {
    title: result.error ? '⚠️ Préfixe non mis à jour' : '🏷️ Préfixe de grade mis à jour',
    description: result.error ? `Pseudo attendu : **${result.nick}**\n${result.error}` : `Nouveau pseudo : **${result.nick}**`,
    color: result.error ? LogColor.warning : LogColor.info,
    // Le propriétaire du serveur ne peut jamais être renommé : inutile d'alerter.
    alert: !!result.error && newMember.id !== newMember.guild.ownerId,
    target: newMember.user,
  });
}

/**
 * Rôles liés aux grades, gérés automatiquement :
 *  - « personnel » (EMS) : présent dès que le membre a au moins un grade ;
 *  - « direction »       : présent dès que le membre a au moins un grade marqué « direction ».
 */
const LINKED_ROLES = [
  { key: 'personnel', label: 'Rôle du personnel (EMS)', emoji: '🩺', shouldHave: (m: GuildMember) => isStaff(m) },
  { key: 'direction', label: 'Rôle Direction', emoji: '👑', shouldHave: (m: GuildMember) => hasDirectionGrade(m) },
] as const;

/** Liste des rôles liés : rôles principaux (EMS, Direction) + rôles automatiques du même déclencheur (/config auto). */
function linkedRoleTargets(guild: Guild): { roleId: string; label: string; emoji: string; shouldHave: (m: GuildMember) => boolean }[] {
  const out = [];
  for (const linked of LINKED_ROLES) {
    const main = roleId(linked.key);
    if (main) out.push({ roleId: main, label: linked.label, emoji: linked.emoji, shouldHave: linked.shouldHave });
    for (const extra of autoRoleIds(linked.key)) {
      out.push({ roleId: extra, label: `Rôle ${guild.roles.cache.get(extra)?.name ?? extra}`, emoji: linked.emoji, shouldHave: linked.shouldHave });
    }
  }
  return out;
}

export interface LinkedRoleChange {
  label: string;
  emoji: string;
  added: boolean;
  error: OpError;
}

/** Ajoute / retire les rôles liés aux grades. Retourne uniquement les rôles modifiés (ou en échec). */
export async function syncLinkedRoles(member: GuildMember, reason: string): Promise<LinkedRoleChange[]> {
  const changes: LinkedRoleChange[] = [];
  for (const target of linkedRoleTargets(member.guild)) {
    const shouldHave = target.shouldHave(member);
    if (shouldHave === member.roles.cache.has(target.roleId)) continue;
    const error = await changeRoleById(member, target.roleId, shouldHave ? 'add' : 'remove', reason);
    changes.push({ label: target.label, emoji: target.emoji, added: shouldHave, error });
  }
  return changes;
}
