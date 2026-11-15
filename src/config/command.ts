/**
 * /config — réservé à la direction (ou aux administrateurs du serveur).
 *   /config role     : associer un rôle Discord à une clé (grade, Citoyen, Non vérifié, Absent)
 *   /config salon    : associer un salon à une clé (#vérification, #absences, logs, staff)
 *   /config voir     : afficher la configuration et les problèmes détectés
 *   /config publier  : (re)publier un message fixe avec ses boutons
 */
import {
  InteractionContextType,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import { absencesPanel } from '../absences/panel.js';
import { publishPanel } from '../core/panels.js';
import type { Command } from '../core/types.js';
import { isDirection } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { verificationPanel } from '../verification/panel.js';
import { CHANNEL_KEYS, ROLE_KEYS, channelSettingKey, roleSettingKey } from './keys.js';
import { channelId, roleId, setSetting } from './settings.js';

const PANELS: Record<string, { label: string; channelKey: string; build: () => ReturnType<typeof verificationPanel> }> = {
  verification: { label: 'Vérification (Créer ma fiche)', channelKey: 'verification', build: verificationPanel },
  absences: { label: 'Absences (Déclarer une absence)', channelKey: 'absences', build: absencesPanel },
};

const choices = (rec: Record<string, string>) => Object.entries(rec).map(([value, name]) => ({ name, value }));

export const configCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configuration du bot (direction)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('role')
        .setDescription('Associer un rôle du serveur à un rôle du bot')
        .addStringOption((o) => o.setName('cle').setDescription('Rôle du bot').setRequired(true).addChoices(...choices(ROLE_KEYS)))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle Discord correspondant').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('salon')
        .setDescription('Associer un salon à une fonction du bot')
        .addStringOption((o) => o.setName('cle').setDescription('Fonction').setRequired(true).addChoices(...choices(CHANNEL_KEYS)))
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Salon textuel').setRequired(true).addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) => s.setName('voir').setDescription('Afficher la configuration actuelle et les problèmes détectés'))
    .addSubcommand((s) =>
      s
        .setName('publier')
        .setDescription('Publier (ou mettre à jour) un message fixe avec ses boutons')
        .addStringOption((o) =>
          o
            .setName('panneau')
            .setDescription('Message à publier')
            .setRequired(true)
            .addChoices(...Object.entries(PANELS).map(([value, p]) => ({ name: p.label, value }))),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!isDirection(interaction.member)) {
      await interaction.reply({ content: '⛔ Cette commande est réservée à la direction.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'role') return setRole(interaction);
    if (sub === 'salon') return setChannel(interaction);
    if (sub === 'voir') return show(interaction);
    if (sub === 'publier') return publish(interaction);
  },
};

async function setRole(interaction: ChatInputCommandInteraction<'cached'>) {
  const key = interaction.options.getString('cle', true);
  const role = interaction.options.getRole('role', true);
  if (role.managed || role.id === interaction.guild.id) {
    await interaction.reply({ content: '❌ Ce rôle ne peut pas être utilisé (rôle géré par une intégration ou @everyone).', flags: MessageFlags.Ephemeral });
    return;
  }
  await setSetting(roleSettingKey(key), role.id, interaction.user.id);
  const me = interaction.guild.members.me;
  const warning =
    me && role.comparePositionTo(me.roles.highest) >= 0
      ? `\n⚠️ Ce rôle est au-dessus du rôle du bot : le bot ne pourra pas l’attribuer. Monte le rôle du bot dans la liste.`
      : '';
  await interaction.reply({ content: `✅ ${ROLE_KEYS[key]} → ${role}${warning}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  await sendLog(interaction.guild, {
    title: '⚙️ Configuration modifiée',
    description: `Rôle **${ROLE_KEYS[key]}** → ${role}`,
    color: LogColor.neutral,
    actor: interaction.user,
  });
}

async function setChannel(interaction: ChatInputCommandInteraction<'cached'>) {
  const key = interaction.options.getString('cle', true);
  const channel = interaction.options.getChannel('salon', true, [ChannelType.GuildText]);
  await setSetting(channelSettingKey(key), channel.id, interaction.user.id);
  const me = interaction.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
  const warning = perms && !perms.has(needed) ? `\n⚠️ Le bot n’a pas toutes les permissions dans ce salon (voir, écrire, intégrer des liens, lire l’historique).` : '';
  await interaction.reply({ content: `✅ ${CHANNEL_KEYS[key]} → ${channel}${warning}`, flags: MessageFlags.Ephemeral });
  await sendLog(interaction.guild, {
    title: '⚙️ Configuration modifiée',
    description: `Salon **${CHANNEL_KEYS[key]}** → ${channel}`,
    color: LogColor.neutral,
    actor: interaction.user,
  });
}

async function show(interaction: ChatInputCommandInteraction<'cached'>) {
  const guild = interaction.guild;
  const problems = diagnose(guild);
  const roles = Object.entries(ROLE_KEYS)
    .map(([k, label]) => {
      const id = roleId(k);
      return `**${label}** : ${id ? (guild.roles.cache.has(id) ? `<@&${id}>` : '⚠️ rôle supprimé') : '— non configuré'}`;
    })
    .join('\n');
  const channels = Object.entries(CHANNEL_KEYS)
    .map(([k, label]) => {
      const id = channelId(k);
      return `**${label}** : ${id ? (guild.channels.cache.has(id) ? `<#${id}>` : '⚠️ salon supprimé') : '— non configuré'}`;
    })
    .join('\n');
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Configuration du bot')
    .setColor(problems.length ? LogColor.warning : LogColor.success)
    .addFields(
      { name: 'Rôles', value: roles },
      { name: 'Salons', value: channels },
      { name: problems.length ? 'Problèmes détectés' : 'Vérifications', value: problems.length ? problems.join('\n').slice(0, 1024) : '✅ Aucun problème détecté.' },
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

/** Liste les problèmes de configuration (rôles manquants, hiérarchie, permissions). */
function diagnose(guild: Guild): string[] {
  const out: string[] = [];
  const me = guild.members.me;
  if (!me) return ['Le bot n’est pas encore prêt.'];
  if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) out.push('❌ Permission « Gérer les pseudos » manquante.');
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) out.push('❌ Permission « Gérer les rôles » manquante.');
  for (const [k, label] of Object.entries(ROLE_KEYS)) {
    const id = roleId(k);
    const role = id ? guild.roles.cache.get(id) : undefined;
    if (!id) out.push(`⚠️ Rôle **${label}** non configuré.`);
    else if (!role) out.push(`❌ Le rôle configuré pour **${label}** n’existe plus.`);
    else if (role.comparePositionTo(me.roles.highest) >= 0) out.push(`❌ Le rôle ${role} est au-dessus du rôle du bot.`);
  }
  for (const [k, label] of Object.entries(CHANNEL_KEYS)) {
    if (!channelId(k)) out.push(`⚠️ Salon **${label}** non configuré.`);
  }
  return out;
}

async function publish(interaction: ChatInputCommandInteraction<'cached'>) {
  const key = interaction.options.getString('panneau', true);
  const panel = PANELS[key];
  if (!panel) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await publishPanel(interaction.guild, key, panel.channelKey, panel.build(), interaction.user.id);
  if (!result.ok) {
    await interaction.editReply(`❌ ${result.error}`);
    return;
  }
  await interaction.editReply(`✅ Message ${result.created ? 'publié' : 'mis à jour'} : ${result.url}`);
  await sendLog(interaction.guild, {
    title: '📌 Message fixe publié',
    description: `${panel.label} — ${result.url}`,
    color: LogColor.neutral,
    actor: interaction.user,
  });
}
