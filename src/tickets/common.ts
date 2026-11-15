/**
 * Éléments partagés du module tickets : droits, message d'accueil du ticket, logs des tickets.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type AttachmentBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { channelId } from '../config/settings.js';
import type { Ticket, TicketType } from '../db/schema.js';
import { formatFrDateTime } from '../lib/dates.js';
import { isDirection } from '../lib/members.js';
import { logger } from '../logger.js';

export const typeLabel = (t: TicketType) => `${t.emoji ? `${t.emoji} ` : ''}${t.name}`;

/** Le membre traite-t-il ce type de ticket ? (rôle d'accès du type, ou direction) */
export function canHandle(member: GuildMember, type: TicketType): boolean {
  return isDirection(member) || type.staffRoleIds.some((id) => member.roles.cache.has(id));
}

/** Message d'accueil du ticket : réponses au formulaire, statut, boutons. */
export function ticketMessage(ticket: Ticket, type: TicketType) {
  const embed = new EmbedBuilder()
    .setTitle(`${typeLabel(type)} — ticket n°${ticket.id}`)
    .setColor(ticket.claimedBy ? 0x22c55e : 0x0ea5e9)
    .setDescription(`Ouvert par <@${ticket.userId}> le ${formatFrDateTime(ticket.openedAt)}.`)
    .addFields(
      ...ticket.answers.map((a) => ({ name: a.question.slice(0, 256), value: (a.answer || '_Non renseigné_').slice(0, 1024) })),
      { name: 'Prise en charge', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '_En attente_' },
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tick:prendre:${ticket.id}`)
      .setLabel(ticket.claimedBy ? 'Pris en charge' : 'Prendre en charge')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!ticket.claimedBy),
    new ButtonBuilder().setCustomId(`tick:fermer:${ticket.id}`).setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

/** Écrit dans #logs-tickets (ou, à défaut, dans le salon de logs du bot). */
export async function sendTicketLog(guild: Guild, embed: EmbedBuilder, files: AttachmentBuilder[] = []): Promise<boolean> {
  const id = channelId('tickets_logs') ?? channelId('logs');
  logger.info(`[tickets] ${embed.data.title ?? ''}`);
  if (!id) return false;
  try {
    const channel = await guild.channels.fetch(id);
    if (!channel?.isSendable()) return false;
    await channel.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    logger.error('Impossible d’écrire dans le salon des logs de tickets', err);
    return false;
  }
}
