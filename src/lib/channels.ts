/**
 * Vérification des permissions du bot dans un salon (en tenant compte des permissions propres au salon).
 */
import { ChannelType, PermissionFlagsBits, type GuildBasedChannel } from 'discord.js';

const LABELS: [bigint, string][] = [
  [PermissionFlagsBits.ViewChannel, 'Voir le salon'],
  [PermissionFlagsBits.SendMessages, 'Envoyer des messages'],
  [PermissionFlagsBits.EmbedLinks, 'Intégrer des liens'],
  [PermissionFlagsBits.ReadMessageHistory, 'Voir les anciens messages'],
];
const FORUM_LABELS: [bigint, string][] = [
  [PermissionFlagsBits.SendMessagesInThreads, 'Envoyer des messages dans les fils'],
  [PermissionFlagsBits.ManageThreads, 'Gérer les fils'],
];

/** Permissions qui manquent au bot dans ce salon (liste vide = tout va bien). */
export function missingBotPerms(channel: GuildBasedChannel): string[] {
  const me = channel.guild.members.me;
  if (!me) return ['bot non prêt'];
  const perms = channel.permissionsFor(me);
  const needed = channel.type === ChannelType.GuildForum ? [...LABELS, ...FORUM_LABELS] : LABELS;
  return needed.filter(([flag]) => !perms.has(flag)).map(([, label]) => label);
}
