/**
 * Fiche visuelle d'une absence (embed + boutons) et mise à jour du message publié.
 * Une absence = un seul message, modifié à chaque changement (pas de doublons).
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild } from 'discord.js';
import { channelId } from '../config/settings.js';
import type { Absence } from '../db/schema.js';
import { formatFr, formatFrDateTime, todayParis } from '../lib/dates.js';
import { highestGrade } from '../lib/members.js';
import { logger } from '../logger.js';
import { displayRpName } from '../verification/fiches.js';
import { isActive, updateAbsence } from './repo.js';

export function statusLabel(a: Absence, today = todayParis()): { label: string; color: number } {
  switch (a.status) {
    case 'en_cours':
      return a.startDate > today ? { label: '🔵 À venir', color: 0x3b82f6 } : { label: '🟡 En cours', color: 0xeab308 };
    case 'non_confirmee':
      return { label: '🔴 Retour non confirmé', color: 0xef4444 };
    case 'terminee':
      return { label: '🟢 Terminée', color: 0x22c55e };
    case 'annulee':
      return { label: '⚫ Annulée', color: 0x6b7280 };
  }
}

/** Boutons d'action d'une absence (aussi utilisés dans le rappel en MP). */
export function absenceButtons(a: Absence, opts: { cancel: boolean } = { cancel: true }) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`abs:retour:${a.id}`).setLabel('Je suis revenu').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`abs:prolonger:${a.id}`).setLabel('Prolonger').setEmoji('📅').setStyle(ButtonStyle.Primary),
  );
  if (opts.cancel) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`abs:annuler:${a.id}`).setLabel('Annuler').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

export async function buildAbsenceMessage(guild: Guild, a: Absence) {
  const member = await guild.members.fetch(a.userId).catch(() => null);
  const name = await displayRpName(member, a.userId);
  const grade = member ? (highestGrade(member)?.label ?? '—') : 'A quitté le serveur';
  const { label, color } = statusLabel(a);

  const embed = new EmbedBuilder()
    .setTitle(`Absence — ${name}`)
    .setColor(color)
    .addFields(
      { name: 'Membre', value: `<@${a.userId}>`, inline: true },
      { name: 'Grade', value: grade, inline: true },
      { name: 'Statut', value: label, inline: true },
      { name: 'Du', value: formatFr(a.startDate), inline: true },
      { name: 'Au', value: formatFr(a.endDate), inline: true },
      { name: 'Prolongations', value: String(a.extensions), inline: true },
      { name: 'Motif', value: a.reason?.trim() || '_Non précisé_' },
    )
    .setFooter({ text: `Absence n°${a.id} • déclarée le ${formatFrDateTime(a.createdAt)}` });
  if (a.closedAt) {
    embed.addFields({ name: 'Clôturée', value: `le ${formatFrDateTime(a.closedAt)}${a.closedBy ? ` par <@${a.closedBy}>` : ''}` });
  }
  return { embeds: [embed], components: isActive(a) ? [absenceButtons(a)] : [] };
}

/**
 * Met à jour le message de la fiche dans #absences.
 * S'il a été supprimé et que l'absence est encore active, il est republié.
 * Une absence terminée ou annulée est retirée du salon (elle reste en base et dans le dossier).
 */
export async function refreshAbsenceMessage(guild: Guild, a: Absence): Promise<Absence> {
  if (!isActive(a)) {
    if (a.channelId && a.messageId) {
      const channel = await guild.channels.fetch(a.channelId).catch(() => null);
      if (channel?.isTextBased()) await channel.messages.delete(a.messageId).catch(() => {});
      return updateAbsence(a.id, { messageId: null });
    }
    return a;
  }
  const payload = await buildAbsenceMessage(guild, a);
  try {
    if (a.channelId && a.messageId) {
      const channel = await guild.channels.fetch(a.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(a.messageId).catch(() => null);
        if (message) {
          await message.edit({ ...payload, allowedMentions: { parse: [] } });
          return a;
        }
      }
    }
    if (!isActive(a)) return a;

    const targetId = channelId('absences');
    const channel = targetId ? await guild.channels.fetch(targetId).catch(() => null) : null;
    if (!channel?.isSendable()) {
      logger.warn(`Absence n°${a.id} : salon #absences non configuré ou inaccessible, fiche non publiée.`);
      return a;
    }
    const message = await channel.send({ ...payload, allowedMentions: { parse: [] } });
    return updateAbsence(a.id, { channelId: channel.id, messageId: message.id });
  } catch (err) {
    logger.error(`Impossible de mettre à jour la fiche d’absence n°${a.id}`, err);
    return a;
  }
}
