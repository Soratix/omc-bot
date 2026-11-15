/**
 * Droits des membres et opérations Discord « sûres » :
 * renommage et rôles ne font jamais planter le bot, ils renvoient un message d'erreur clair.
 */
import { DiscordAPIError, PermissionFlagsBits, RESTJSONErrorCodes, type GuildMember } from 'discord.js';
import { GRADES, type Grade } from '../config/keys.js';
import { roleId } from '../config/settings.js';

/** Direction = rôle Direction configuré, ou administrateur du serveur (utile avant la configuration). */
export function isDirection(member: GuildMember): boolean {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const id = roleId('direction');
  return !!id && member.roles.cache.has(id);
}

/** Personnel = au moins un rôle de grade (Interne → Direction). */
export function isStaff(member: GuildMember): boolean {
  return highestGrade(member) !== null;
}

/** Grade le plus haut du membre (selon l'ordre de GRADES), ou null. */
export function highestGrade(member: GuildMember): Grade | null {
  for (const grade of GRADES) {
    const id = roleId(grade.key);
    if (id && member.roles.cache.has(id)) return grade;
  }
  return null;
}

/** Résultat d'une opération : null si OK, sinon le message d'erreur à afficher. */
export type OpError = string | null;

/** Explique pourquoi le bot ne peut pas modifier ce membre, ou null s'il le peut. */
export function whyNotManageable(member: GuildMember): OpError {
  if (member.id === member.guild.ownerId) {
    return 'Discord ne permet à aucun bot de modifier le pseudo du propriétaire du serveur.';
  }
  const me = member.guild.members.me;
  if (!me) return 'Le bot n’est pas encore prêt, réessaie dans quelques secondes.';
  if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    return 'Il manque au bot la permission « Gérer les pseudos ».';
  }
  if (member.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
    return `Le rôle le plus haut de ${member.user.username} (« ${member.roles.highest.name} ») est au-dessus ou au même niveau que celui du bot. Place le rôle du bot plus haut dans la liste des rôles.`;
  }
  return null;
}

export async function safeSetNickname(member: GuildMember, nick: string, reason: string): Promise<OpError> {
  if (member.nickname === nick) return null;
  const blocked = whyNotManageable(member);
  if (blocked) return blocked;
  try {
    await member.setNickname(nick, reason);
    return null;
  } catch (err) {
    return describeApiError(err, 'renommer le membre');
  }
}

export async function safeAddRole(member: GuildMember, key: string, reason: string): Promise<OpError> {
  return changeRole(member, key, 'add', reason);
}

export async function safeRemoveRole(member: GuildMember, key: string, reason: string): Promise<OpError> {
  return changeRole(member, key, 'remove', reason);
}

async function changeRole(member: GuildMember, key: string, op: 'add' | 'remove', reason: string): Promise<OpError> {
  const id = roleId(key);
  if (!id) return `Le rôle « ${key} » n’est pas configuré (/config role).`;
  const has = member.roles.cache.has(id);
  if ((op === 'add' && has) || (op === 'remove' && !has)) return null;

  const role = member.guild.roles.cache.get(id);
  if (!role) return `Le rôle configuré pour « ${key} » n’existe plus sur le serveur.`;
  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'Il manque au bot la permission « Gérer les rôles ».';
  if (role.comparePositionTo(me.roles.highest) >= 0) {
    return `Le rôle « ${role.name} » est au-dessus du rôle du bot : place le rôle du bot plus haut dans la liste des rôles.`;
  }
  try {
    if (op === 'add') await member.roles.add(role, reason);
    else await member.roles.remove(role, reason);
    return null;
  } catch (err) {
    return describeApiError(err, op === 'add' ? `ajouter le rôle ${role.name}` : `retirer le rôle ${role.name}`);
  }
}

export function describeApiError(err: unknown, action: string): string {
  if (err instanceof DiscordAPIError) {
    if (err.code === RESTJSONErrorCodes.MissingPermissions) {
      return `Impossible de ${action} : permissions insuffisantes (hiérarchie des rôles ou permission manquante).`;
    }
    if (err.code === RESTJSONErrorCodes.UnknownMember) return `Impossible de ${action} : le membre a quitté le serveur.`;
    return `Impossible de ${action} : erreur Discord ${err.code} (${err.message}).`;
  }
  return `Impossible de ${action} : erreur inattendue.`;
}
