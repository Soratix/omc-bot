/**
 * /absences liste     : absences en cours et à venir (personnel)
 * /absences nettoyer  : supprime du salon les fiches terminées/annulées (direction) — elles restent en base
 */
import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../core/types.js';
import { formatFr, todayParis } from '../lib/dates.js';
import { isDirection, isStaff } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { displayRpName } from '../verification/fiches.js';
import { statusLabel } from './render.js';
import { closedWithMessage, listActive, updateAbsence } from './repo.js';

export const absencesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('absences')
    .setDescription('Gestion des absences du personnel')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('liste').setDescription('Absences en cours et à venir'))
    .addSubcommand((s) => s.setName('nettoyer').setDescription('Retirer du salon les fiches terminées ou annulées (direction)')),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'liste') return list(interaction);
    if (sub === 'nettoyer') return clean(interaction);
  },
};

async function list(interaction: ChatInputCommandInteraction<'cached'>) {
  if (!isStaff(interaction.member) && !isDirection(interaction.member)) {
    await interaction.reply({ content: '⛔ Réservé au personnel de l’hôpital.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const today = todayParis();
  const rows = await listActive();
  const lines: string[] = [];
  for (const a of rows) {
    const name = await displayRpName(null, a.userId);
    const link = a.channelId && a.messageId ? ` — [fiche](https://discord.com/channels/${interaction.guild.id}/${a.channelId}/${a.messageId})` : '';
    lines.push(`${statusLabel(a, today).label} **${name}** (<@${a.userId}>) : ${formatFr(a.startDate)} → ${formatFr(a.endDate)}${link}`);
  }
  let description = lines.length ? lines.join('\n') : 'Aucune absence en cours ou à venir. 🎉';
  if (description.length > 4000) description = `${description.slice(0, 3990)}\n…`;
  const embed = new EmbedBuilder()
    .setTitle(`📅 Absences en cours et à venir (${rows.length})`)
    .setColor(0xeab308)
    .setDescription(description)
    .setFooter({ text: `Au ${formatFr(today)}` });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function clean(interaction: ChatInputCommandInteraction<'cached'>) {
  if (!isDirection(interaction.member)) {
    await interaction.reply({ content: '⛔ Cette commande est réservée à la direction.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = await closedWithMessage();
  let deleted = 0;
  for (const a of rows) {
    const channel = a.channelId ? await interaction.guild.channels.fetch(a.channelId).catch(() => null) : null;
    if (channel?.isTextBased() && a.messageId) {
      const ok = await channel.messages.delete(a.messageId).then(
        () => true,
        () => false,
      );
      if (ok) deleted++;
    }
    // Le message est supprimé (ou n'existait plus) : on oublie son ID, la fiche reste en base.
    await updateAbsence(a.id, { messageId: null });
  }
  await interaction.editReply(`🧹 ${deleted} fiche(s) terminée(s) ou annulée(s) retirée(s) du salon. L’historique reste en base.`);
  await sendLog(interaction.guild, {
    title: '🧹 Fiches d’absence nettoyées',
    description: `${deleted} message(s) supprimé(s).`,
    color: LogColor.neutral,
    actor: interaction.user,
  });
}
