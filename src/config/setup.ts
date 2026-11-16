/**
 * /setup — assistant de configuration (administrateurs).
 * Affiche, étape par étape, ce qui est prêt (✅) et ce qu'il reste à faire (⚠️/❌) avec la commande à taper.
 * Ne modifie rien : c'est une liste de contrôle.
 */
import { EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type Guild } from 'discord.js';
import type { Command } from '../core/types.js';
import { missingBotPerms } from '../lib/channels.js';
import { isAdmin } from '../lib/members.js';
import { listTypes } from '../tickets/repo.js';
import { allGrades } from './grades.js';
import { CHANNEL_KEYS, ROLE_KEYS, panelSettingKey } from './keys.js';
import { channelId, getSetting, roleId } from './settings.js';

const GLOBAL_PERMS: [bigint, string][] = [
  [PermissionFlagsBits.ManageNicknames, 'Gérer les pseudos'],
  [PermissionFlagsBits.ManageRoles, 'Gérer les rôles'],
  [PermissionFlagsBits.ManageChannels, 'Gérer les salons'],
  [PermissionFlagsBits.ManageThreads, 'Gérer les fils'],
  [PermissionFlagsBits.SendMessagesInThreads, 'Envoyer des messages dans les fils'],
  [PermissionFlagsBits.AttachFiles, 'Joindre des fichiers'],
  [PermissionFlagsBits.EmbedLinks, 'Intégrer des liens'],
];

const PANELS: [string, string][] = [
  ['verification', 'Vérification'],
  ['absences', 'Absences'],
  ['gestion', 'Gestion'],
  ['tickets', 'Tickets'],
];

interface Step {
  title: string;
  ok: boolean;
  lines: string[];
}

async function buildSteps(guild: Guild): Promise<Step[]> {
  const me = guild.members.me!;
  const steps: Step[] = [];

  // 1. Rôle et permissions du bot
  const missing = GLOBAL_PERMS.filter(([p]) => !me.permissions.has(p)).map(([, l]) => l);
  steps.push({
    title: '1. Rôle et permissions du bot',
    ok: missing.length === 0,
    lines: [
      missing.length ? `❌ Permissions manquantes au rôle **${me.roles.highest.name}** : ${missing.join(', ')}.` : `✅ Permissions du bot OK.`,
      `ℹ️ Le rôle **${me.roles.highest.name}** doit être **au-dessus** de tous les grades et rôles gérés (Paramètres du serveur → Rôles).`,
    ],
  });

  // 2. Grades
  const grades = allGrades();
  const above = grades.filter((g) => {
    const r = guild.roles.cache.get(g.roleId);
    return !r || r.comparePositionTo(me.roles.highest) >= 0;
  });
  steps.push({
    title: '2. Grades',
    ok: grades.length > 0 && grades.some((g) => g.direction) && !above.length,
    lines: [
      grades.length ? `✅ ${grades.length} grade(s) configuré(s), dont ${grades.filter((g) => g.direction).length} avec l’accès direction.` : '❌ Aucun grade.',
      ...(grades.some((g) => g.direction) ? [] : ['❌ Aucun grade avec l’accès direction.']),
      ...(above.length ? [`❌ ${above.length} grade(s) supprimé(s) ou au-dessus du rôle du bot.`] : []),
      '→ `/config grade ajouter role:@Rôle prefixe:[Xxx] direction:True|False`',
    ],
  });

  // 3. Rôles techniques
  const unsetRoles = Object.entries(ROLE_KEYS).filter(([k]) => !roleId(k) || !guild.roles.cache.has(roleId(k)!));
  steps.push({
    title: '3. Rôles techniques',
    ok: unsetRoles.length === 0,
    lines: [
      unsetRoles.length ? `❌ À configurer : ${unsetRoles.map(([, l]) => `**${l}**`).join(', ')}.` : '✅ Citoyen, Non vérifié, Absent, Personnel (EMS) et Direction configurés.',
      '→ `/config role cle:… role:@…` · rôles en plus : `/config auto ajouter`',
    ],
  });

  // 4. Salons
  const channelProblems: string[] = [];
  for (const [k, label] of Object.entries(CHANNEL_KEYS)) {
    const id = channelId(k);
    const channel = id ? guild.channels.cache.get(id) : undefined;
    if (!channel) channelProblems.push(`❌ ${label}`);
    else {
      const m = missingBotPerms(channel);
      if (m.length) channelProblems.push(`❌ ${channel} : il manque ${m.join(', ')}`);
    }
  }
  steps.push({
    title: '4. Salons',
    ok: channelProblems.length === 0,
    lines: [...(channelProblems.length ? channelProblems : ['✅ Tous les salons sont configurés et accessibles.']), '→ `/config salon cle:… salon:#…`'],
  });

  // 5. Types de tickets
  const types = await listTypes();
  steps.push({
    title: '5. Types de tickets',
    ok: types.length > 0,
    lines: [
      types.length ? `✅ ${types.length} type(s) actif(s) : ${types.map((t) => t.name).join(', ')}.` : '❌ Aucun type de ticket actif.',
      '→ `/tickets type-creer` · `/tickets types`',
    ],
  });

  // 6. Messages fixes
  const unpublished = PANELS.filter(([k]) => !getSetting(panelSettingKey(k)));
  steps.push({
    title: '6. Messages fixes',
    ok: unpublished.length === 0,
    lines: [
      unpublished.length ? `❌ Non publiés : ${unpublished.map(([, l]) => l).join(', ')}.` : '✅ Vérification, Absences, Gestion et Tickets publiés.',
      '→ `/config publier panneau:…` (republier met à jour le message existant)',
    ],
  });

  // 7. Membres existants
  steps.push({
    title: '7. Membres déjà présents (après une modification des grades)',
    ok: true,
    lines: ['→ `/fiche resynchroniser` : préfixes, rôles EMS / Direction', '→ `/dossier synchroniser` : dossiers du personnel'],
  });
  return steps;
}

export const setupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Assistant de configuration : ce qui est prêt et ce qu’il reste à faire (administrateurs)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!isAdmin(interaction.member)) {
      await interaction.reply({ content: '⛔ Réservé aux administrateurs du serveur.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const steps = await buildSteps(interaction.guild);
    const done = steps.filter((s) => s.ok).length;
    const embed = new EmbedBuilder()
      .setTitle('🛠️ Configuration du bot')
      .setColor(done === steps.length ? 0x22c55e : 0xf59e0b)
      .setDescription(
        done === steps.length
          ? '✅ **Tout est prêt.** Le guide complet est dans le fichier `GUIDE.md` du dépôt du bot.'
          : `**${done}/${steps.length} étapes prêtes.** Suis les étapes dans l’ordre, puis relance \`/setup\`.`,
      )
      .addFields(steps.map((s) => ({ name: `${s.ok ? '✅' : '⚠️'} ${s.title}`, value: s.lines.join('\n').slice(0, 1024) })))
      .setFooter({ text: 'Détails des problèmes : /config voir' });
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
