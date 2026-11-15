/**
 * /fiche — réservé à la direction.
 *   /fiche voir       : afficher la fiche RP d'un membre
 *   /fiche modifier   : corriger le nom RP (le pseudo est mis à jour)
 *   /fiche resynchroniser : réappliquer « [Grade] Prénom Nom » à tous les membres ayant une fiche
 */
import {
  InteractionContextType, EmbedBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { db } from '../db/index.js';
import { fiches } from '../db/schema.js';
import type { Command } from '../core/types.js';
import { formatFrDateTime } from '../lib/dates.js';
import { highestGrade, isDirection } from '../lib/members.js';
import { validateRpName } from '../lib/names.js';
import { LogColor, sendLog } from '../logs/index.js';
import { syncStaffRole } from './events.js';
import { expectedNickname, getFiche, saveFiche, syncNickname } from './fiches.js';

export const ficheCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('fiche')
    .setDescription('Fiches RP des membres (direction)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('voir')
        .setDescription('Voir la fiche RP d’un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('modifier')
        .setDescription('Corriger le nom RP d’un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))
        .addStringOption((o) => o.setName('prenom').setDescription('Prénom RP').setRequired(true).setMaxLength(22))
        .addStringOption((o) => o.setName('nom').setDescription('Nom RP').setRequired(true).setMaxLength(22)),
    )
    .addSubcommand((s) =>
      s.setName('resynchroniser').setDescription('Réappliquer les pseudos « [Grade] Prénom Nom » et le rôle du personnel (EMS)'),
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!isDirection(interaction.member)) {
      await interaction.reply({ content: '⛔ Cette commande est réservée à la direction.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'voir') return show(interaction);
    if (sub === 'modifier') return edit(interaction);
    if (sub === 'resynchroniser') return resync(interaction);
  },
};

async function show(interaction: ChatInputCommandInteraction<'cached'>) {
  const user = interaction.options.getUser('membre', true);
  const member = interaction.options.getMember('membre');
  const fiche = await getFiche(user.id);
  if (!fiche) {
    await interaction.reply({ content: `${user} n’a pas encore de fiche RP.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle(`📋 Fiche RP — ${fiche.prenom} ${fiche.nom}`)
    .setColor(0x0ea5e9)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Membre', value: `${user} (${user.id})` },
      { name: 'Prénom', value: fiche.prenom, inline: true },
      { name: 'Nom', value: fiche.nom, inline: true },
      { name: 'Grade', value: member ? (highestGrade(member)?.label ?? 'Aucun') : 'A quitté le serveur', inline: true },
      { name: 'Pseudo attendu', value: member ? expectedNickname(member, fiche) : '—', inline: true },
      { name: 'Créée le', value: formatFrDateTime(fiche.createdAt), inline: true },
      { name: 'Modifiée le', value: `${formatFrDateTime(fiche.updatedAt)}${fiche.updatedBy ? ` par <@${fiche.updatedBy}>` : ''}`, inline: true },
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function edit(interaction: ChatInputCommandInteraction<'cached'>) {
  const user = interaction.options.getUser('membre', true);
  const member = interaction.options.getMember('membre');
  const result = validateRpName(interaction.options.getString('prenom', true), interaction.options.getString('nom', true));
  if (!result.ok) {
    await interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
    return;
  }
  const before = await getFiche(user.id);
  await saveFiche(user.id, result.prenom, result.nom, interaction.user.id);

  let status = 'Le membre n’est plus sur le serveur : seule la fiche a été modifiée.';
  if (member) {
    const nick = await syncNickname(member, `Fiche corrigée par ${interaction.user.tag}`);
    status = !nick.changed ? 'Pseudo déjà à jour.' : nick.error ? `⚠️ Pseudo non modifié : ${nick.error}` : `Pseudo mis à jour : **${nick.nick}**`;
  }
  await interaction.reply({ content: `✅ Fiche de ${user} : **${result.full}**\n${status}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  await sendLog(interaction.guild, {
    title: '✏️ Fiche RP modifiée',
    color: LogColor.info,
    target: user,
    actor: interaction.user,
    fields: [
      { name: 'Avant', value: before ? `${before.prenom} ${before.nom}` : '(aucune fiche)', inline: true },
      { name: 'Après', value: result.full, inline: true },
      { name: 'Pseudo', value: status.slice(0, 1024) },
    ],
  });
}

async function resync(interaction: ChatInputCommandInteraction<'cached'>) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = await db.select({ userId: fiches.userId }).from(fiches);
  let updated = 0;
  const errors: string[] = [];
  for (const { userId } of rows) {
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const r = await syncNickname(member, `Resynchronisation par ${interaction.user.tag}`);
    if (!r.changed) continue;
    if (r.error) errors.push(`${member.user.tag} : ${r.error}`);
    else updated++;
  }
  // Rôle commun du personnel (EMS) pour tous les membres du serveur.
  let staffChanged = 0;
  const members = await interaction.guild.members.fetch();
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const r = await syncStaffRole(member, `Resynchronisation par ${interaction.user.tag}`);
    if (!r.changed) continue;
    if (r.error) errors.push(`${member.user.tag} : ${r.error}`);
    else staffChanged++;
  }
  const summary = `✅ ${updated} pseudo(s) mis à jour sur ${rows.length} fiche(s), rôle du personnel corrigé pour ${staffChanged} membre(s).${errors.length ?`\n⚠️ ${errors.length} échec(s) :\n• ${errors.slice(0, 10).join('\n• ')}` : ''}`;
  await interaction.editReply(summary.slice(0, 2000));
  await sendLog(interaction.guild, { title: '🔄 Pseudos resynchronisés', description: summary.slice(0, 4000), color: LogColor.info, actor: interaction.user });
}
