/**
 * /dossier — réservé à la direction.
 *   /dossier voir membre        : résumé et derniers événements du dossier
 *   /dossier note membre texte  : ajouter une note libre au dossier
 *   /dossier synchroniser       : créer/rouvrir/archiver les dossiers selon le rôle EMS de chaque membre
 */
import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { roleId } from '../config/settings.js';
import type { Command } from '../core/types.js';
import { formatFr, formatFrDateTime } from '../lib/dates.js';
import { isDirection } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { displayRpName } from '../verification/fiches.js';
import { EVENT_STYLE, addDossierEvent, countAbsences, countEvents, dossierUrl, getDossier, reconcileDossier, recentEvents } from './service.js';

export const dossierCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('dossier')
    .setDescription('Dossiers du personnel (direction)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('voir')
        .setDescription('Résumé du dossier d’un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('note')
        .setDescription('Ajouter une note au dossier d’un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))
        .addStringOption((o) => o.setName('texte').setDescription('Contenu de la note').setRequired(true).setMaxLength(1500)),
    )
    .addSubcommand((s) =>
      s.setName('synchroniser').setDescription('Créer, rouvrir ou archiver les dossiers selon le rôle EMS de chaque membre'),
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!isDirection(interaction.member)) {
      await interaction.reply({ content: '⛔ Cette commande est réservée à la direction.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'voir') return show(interaction);
    if (sub === 'note') return note(interaction);
    if (sub === 'synchroniser') return sync(interaction);
  },
};

async function show(interaction: ChatInputCommandInteraction<'cached'>) {
  const user = interaction.options.getUser('membre', true);
  const d = await getDossier(user.id);
  if (!d) {
    await interaction.reply({ content: `${user} n’a pas de dossier (il n’a jamais eu le rôle EMS).`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const name = await displayRpName(null, user.id);
  const events = await recentEvents(user.id, 10);
  const lines = events.map((e) => {
    const s = EVENT_STYLE[e.type];
    const text = e.details.replace(/\s+/g, ' ');
    return `${s.emoji} **${formatFrDateTime(e.createdAt)}** — ${text.length > 120 ? `${text.slice(0, 117)}…` : text}`;
  });
  const url = dossierUrl(interaction.guild, d);
  const embed = new EmbedBuilder()
    .setTitle(`📁 Dossier — ${name}`)
    .setColor(d.archived ? 0x6b7280 : 0x0ea5e9)
    .addFields(
      { name: 'Statut', value: d.archived ? '🗄️ Archivé' : '🟢 Actif', inline: true },
      { name: 'Embauché le', value: formatFr(d.hiredOn), inline: true },
      { name: 'Avertissements', value: String(await countEvents(user.id, 'avertissement')), inline: true },
      { name: 'Sanctions', value: String(await countEvents(user.id, 'sanction')), inline: true },
      { name: 'Absences', value: String(await countAbsences(user.id)), inline: true },
      { name: 'Dossier', value: url ?? '—', inline: true },
      { name: 'Derniers événements', value: (lines.join('\n') || '—').slice(0, 1024) },
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function note(interaction: ChatInputCommandInteraction<'cached'>) {
  const user = interaction.options.getUser('membre', true);
  const text = interaction.options.getString('texte', true).trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await addDossierEvent(interaction.guild, user.id, 'note', text, interaction.user.id);
  if (!result) {
    await interaction.editReply(`❌ ${user} n’a pas de dossier (il n’a jamais eu le rôle EMS).`);
    return;
  }
  await interaction.editReply(`📝 Note ajoutée.${result.url ? ` ${result.url}` : ''}`);
  await sendLog(interaction.guild, { title: '📝 Note ajoutée au dossier', description: text, color: LogColor.neutral, target: user, actor: interaction.user });
}

async function sync(interaction: ChatInputCommandInteraction<'cached'>) {
  if (!roleId('personnel')) {
    await interaction.reply({ content: '❌ Le rôle du personnel (EMS) n’est pas configuré : `/config role cle:Personnel`.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const counts = { cree: 0, rouvert: 0, archive: 0 };
  const members = await interaction.guild.members.fetch();
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const r = await reconcileDossier(member);
    if (r) counts[r]++;
  }
  const summary = `✅ Dossiers créés : ${counts.cree} · rouverts : ${counts.rouvert} · archivés : ${counts.archive}.`;
  await interaction.editReply(summary);
  await sendLog(interaction.guild, { title: '🔄 Dossiers synchronisés', description: summary, color: LogColor.info, actor: interaction.user });
}
