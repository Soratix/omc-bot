/**
 * /grade — gestion des grades par la direction (méthode recommandée plutôt que les rôles à la main).
 *   /grade attribuer membre grade motif? : donne ce grade et retire les autres (promotion, rétrogradation, embauche)
 *   /grade retirer   membre motif?       : retire tous les grades (départ du personnel → EMS retiré, dossier archivé)
 *
 * Règles :
 *  - le membre doit avoir une fiche RP (vérifié) ;
 *  - hors administrateurs, on ne peut attribuer qu'un grade situé en dessous de son propre rôle le plus haut,
 *    et on ne peut pas modifier un membre de rang égal ou supérieur.
 * Le reste (préfixe, rôle EMS, dossier) suit automatiquement ; l'auteur et le motif sont inscrits au dossier.
 */
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { allGrades, gradeRoleIds, highestGrade } from '../config/grades.js';
import type { Command } from '../core/types.js';
import { describeApiError, isDirection } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { getFiche } from '../verification/fiches.js';
import { setGradeContext } from './context.js';

export const gradeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('grade')
    .setDescription('Attribuer ou retirer un grade (direction)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('attribuer')
        .setDescription('Donner un grade à un membre (remplace son grade actuel)')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))
        .addStringOption((o) => o.setName('grade').setDescription('Grade à attribuer').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('motif').setDescription('Motif (inscrit au dossier)').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer tous les grades d’un membre (départ du personnel)')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))
        .addStringOption((o) => o.setName('motif').setDescription('Motif (inscrit au dossier)').setMaxLength(500)),
    ),

  async autocomplete(interaction) {
    await suggestGrades(interaction);
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!isDirection(interaction.member)) {
      await interaction.reply({ content: '⛔ Cette commande est réservée à la direction.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.options.getSubcommand() === 'attribuer') return assign(interaction);
    return remove(interaction);
  },
};

const isAdmin = (m: GuildMember) => m.permissions.has(PermissionFlagsBits.Administrator) || m.id === m.guild.ownerId;

/** L'auteur peut-il attribuer ce rôle ? (strictement sous son rôle le plus haut, sauf administrateur) */
function canAssignRole(actor: GuildMember, roleId: string): boolean {
  if (isAdmin(actor)) return true;
  const role = actor.guild.roles.cache.get(roleId);
  return !!role && role.comparePositionTo(actor.roles.highest) < 0;
}

/** Suggestions du champ « grade » : grades configurés, du plus haut au plus bas, que l'auteur peut attribuer. */
async function suggestGrades(interaction: AutocompleteInteraction) {
  if (!interaction.inCachedGuild()) return interaction.respond([]);
  const query = interaction.options.getFocused().toLowerCase();
  const choices = allGrades()
    .map((g) => ({ g, role: interaction.guild.roles.cache.get(g.roleId) }))
    .filter((x): x is { g: (typeof x)['g']; role: NonNullable<(typeof x)['role']> } => !!x.role)
    .filter(({ g }) => canAssignRole(interaction.member, g.roleId))
    .sort((a, b) => b.role.position - a.role.position)
    .filter(({ role }) => role.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map(({ g, role }) => ({ name: `${role.name} ${g.prefix}`, value: g.roleId }));
  await interaction.respond(choices);
}

/** Contrôles communs : membre présent, vérifié, modifiable par l'auteur. Répond lui-même en cas de refus. */
async function checkTarget(interaction: ChatInputCommandInteraction<'cached'>): Promise<GuildMember | null> {
  const target = interaction.options.getMember('membre');
  const fail = async (content: string) => {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return null;
  };
  if (!target) return fail('❌ Ce membre n’est pas sur le serveur.');
  if (target.user.bot) return fail('❌ On ne donne pas de grade à un bot.');
  const actor = interaction.member;
  if (target.id === actor.id && !isAdmin(actor)) return fail('❌ Tu ne peux pas modifier ton propre grade.');
  if (!isAdmin(actor) && target.roles.highest.comparePositionTo(actor.roles.highest) >= 0) {
    return fail(`❌ ${target} a un rang égal ou supérieur au tien.`);
  }
  if (!(await getFiche(target.id))) {
    return fail(`❌ ${target} n’a pas encore de fiche RP : il doit d’abord passer par **Créer ma fiche** (ou \`/fiche modifier\`).`);
  }
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return fail('❌ Il manque au bot la permission « Gérer les rôles ».');
  return target;
}

async function assign(interaction: ChatInputCommandInteraction<'cached'>) {
  const roleId = interaction.options.getString('grade', true);
  const reason = interaction.options.getString('motif')?.trim() || null;
  const grade = allGrades().find((g) => g.roleId === roleId);
  const role = interaction.guild.roles.cache.get(roleId);
  if (!grade || !role) {
    await interaction.reply({ content: '❌ Grade inconnu : choisis-le dans la liste proposée.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canAssignRole(interaction.member, roleId)) {
    await interaction.reply({ content: `❌ Tu ne peux attribuer que des grades situés en dessous de ton propre rang.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const target = await checkTarget(interaction);
  if (!target) return;

  const me = interaction.guild.members.me!;
  const blocking = [role, ...gradeRoleIds().map((id) => target.roles.cache.get(id)).filter((r) => !!r)].find(
    (r) => r!.comparePositionTo(me.roles.highest) >= 0,
  );
  if (blocking) {
    await interaction.reply({ content: `❌ Le rôle ${blocking} est au-dessus du rôle du bot : monte le rôle du bot dans la liste des rôles.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  const before = highestGrade(target)?.label ?? 'aucun';
  if (target.roles.cache.has(roleId) && gradeRoleIds().filter((id) => target.roles.cache.has(id)).length === 1) {
    await interaction.reply({ content: `ℹ️ ${target} est déjà **${role.name}**.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const grades = new Set(gradeRoleIds());
  const newRoles = [...target.roles.cache.keys()].filter((id) => id !== interaction.guildId && !grades.has(id));
  newRoles.push(roleId);
  setGradeContext(target.id, interaction.user.id, reason);
  try {
    // Une seule modification : retrait des anciens grades + ajout du nouveau.
    await target.roles.set(newRoles, `Grade ${role.name} attribué par ${interaction.user.tag}${reason ? ` — ${reason}` : ''}`);
  } catch (err) {
    await interaction.editReply(`❌ ${describeApiError(err, 'changer le grade')}`);
    return;
  }
  await interaction.editReply(
    `✅ ${target} : **${before}** → **${role.name}**.\nLe préfixe, le rôle EMS et le dossier se mettent à jour automatiquement.`,
  );
  await sendLog(interaction.guild, {
    title: '🎖️ Grade attribué',
    color: LogColor.info,
    target: target.user,
    actor: interaction.user,
    fields: [
      { name: 'Avant', value: before, inline: true },
      { name: 'Après', value: role.name, inline: true },
      ...(reason ? [{ name: 'Motif', value: reason }] : []),
    ],
  });
}

async function remove(interaction: ChatInputCommandInteraction<'cached'>) {
  const reason = interaction.options.getString('motif')?.trim() || null;
  const target = await checkTarget(interaction);
  if (!target) return;
  const current = gradeRoleIds().filter((id) => target.roles.cache.has(id));
  if (!current.length) {
    await interaction.reply({ content: `ℹ️ ${target} n’a aucun grade.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const me = interaction.guild.members.me!;
  const blocking = current.map((id) => interaction.guild.roles.cache.get(id)).find((r) => r && r.comparePositionTo(me.roles.highest) >= 0);
  if (blocking) {
    await interaction.reply({ content: `❌ Le rôle ${blocking} est au-dessus du rôle du bot.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const before = highestGrade(target)?.label ?? 'aucun';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  setGradeContext(target.id, interaction.user.id, reason);
  try {
    await target.roles.remove(current, `Grades retirés par ${interaction.user.tag}${reason ? ` — ${reason}` : ''}`);
  } catch (err) {
    await interaction.editReply(`❌ ${describeApiError(err, 'retirer les grades')}`);
    return;
  }
  await interaction.editReply(`✅ ${target} n’a plus de grade (était **${before}**). Le rôle EMS est retiré et son dossier archivé automatiquement.`);
  await sendLog(interaction.guild, {
    title: '🎖️ Grades retirés',
    color: LogColor.warning,
    target: target.user,
    actor: interaction.user,
    fields: [{ name: 'Ancien grade', value: before, inline: true }, ...(reason ? [{ name: 'Motif', value: reason }] : [])],
  });
}
