/**
 * Message fixe de #ouvrir-un-ticket : menu déroulant avec les types de tickets actifs.
 * Mis à jour automatiquement quand un type est ajouté, modifié ou retiré.
 */
import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, type Guild } from 'discord.js';
import { panelSettingKey } from '../config/keys.js';
import { getSetting } from '../config/settings.js';
import { logger } from '../logger.js';
import { listTypes } from './repo.js';

export async function ticketsPanel(_guild?: Guild) {
  const types = (await listTypes()).slice(0, 25);
  const embed = new EmbedBuilder()
    .setTitle('🎫 Ouvrir un ticket')
    .setColor(0x0ea5e9)
    .setDescription(
      [
        'Besoin de contacter l’Ocean Medical Center ? Choisis le type de demande dans le menu ci-dessous.',
        'Un salon privé sera créé avec l’équipe concernée.',
        '',
        ...types.map((t) => `${t.emoji ? `${t.emoji} ` : '• '}**${t.name}**${t.description ? ` — ${t.description}` : ''}`),
        '',
        '_Un seul ticket ouvert par type et par personne._',
      ].join('\n'),
    );
  if (!types.length) {
    embed.setDescription('Aucun type de ticket n’est disponible pour le moment.');
    return { embeds: [embed], components: [] };
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId('tick:ouvrir')
    .setPlaceholder('Choisis le type de ticket…')
    .addOptions(
      types.map((t) => ({
        label: t.name,
        value: String(t.id),
        description: t.description ?? undefined,
        emoji: t.emoji ?? undefined,
      })),
    );
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

/** Met à jour le message fixe des tickets s'il a été publié. */
export async function refreshTicketsPanel(guild: Guild): Promise<void> {
  const stored = getSetting(panelSettingKey('tickets'));
  if (!stored) return;
  const [channelId, messageId] = stored.split(':');
  if (!channelId || !messageId) return;
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) await message.edit(await ticketsPanel(guild));
  } catch (err) {
    logger.error('Impossible de mettre à jour le message fixe des tickets', err);
  }
}
