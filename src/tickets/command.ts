/**
 * /tickets — gestion des tickets (direction).
 *   /tickets type-creer role ouverture?      : nouveau type (nom, emoji, description, questions dans un formulaire)
 *   /tickets type-modifier type ouverture?   : modifier un type (formulaire pré-rempli)
 *   /tickets type-acces type role            : ajouter / retirer un rôle qui voit et traite ce type
 *   /tickets type-retirer type               : retirer un type du menu (l'historique est conservé)
 *   /tickets types                           : liste des types
 *   /tickets ajouter membre / retirer membre : donner / retirer l'accès au ticket courant à quelqu'un
 *   /tickets stats                           : statistiques
 */
import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Command, ComponentHandler } from '../core/types.js';
import type { TicketType } from '../db/schema.js';
import { isDirection } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { canHandle, typeLabel } from './common.js';
import { refreshTicketsPanel } from './panel.js';
import { formatQuestions, parseQuestions, slugify } from './questions.js';
import { allTickets, createType, getTicketByChannel, getType, listTypes, updateType } from './repo.js';

const OPENERS = { verifie: 'Tout membre vérifié', personnel: 'Personnel (EMS) uniquement', tous: 'Tout le monde' } as const;
type Opener = keyof typeof OPENERS;
const openerChoices = Object.entries(OPENERS).map(([value, name]) => ({ name, value }));

/** Paramètres de commande en attente du formulaire (15 min max). */
const pending = new Map<string, { userId: string; typeId?: number; roleId?: string; opener?: Opener; expires: number }>();
function remember(p: { userId: string; typeId?: number; roleId?: string; opener?: Opener }): string {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  const key = randomUUID().slice(0, 8);
  pending.set(key, { ...p, expires: now + 15 * 60_000 });
  return key;
}

const typeOption = (o: import('discord.js').SlashCommandStringOption) =>
  o.setName('type').setDescription('Type de ticket').setRequired(true).setAutocomplete(true);

export const ticketsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Gestion des tickets')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('type-creer')
        .setDescription('Créer un type de ticket (direction)')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle qui verra et traitera ces tickets').setRequired(true))
        .addStringOption((o) => o.setName('ouverture').setDescription('Qui peut ouvrir ce type (défaut : tout membre vérifié)').addChoices(...openerChoices)),
    )
    .addSubcommand((s) =>
      s
        .setName('type-modifier')
        .setDescription('Modifier un type de ticket (direction)')
        .addStringOption(typeOption)
        .addStringOption((o) => o.setName('ouverture').setDescription('Qui peut ouvrir ce type').addChoices(...openerChoices)),
    )
    .addSubcommand((s) =>
      s
        .setName('type-acces')
        .setDescription('Ajouter ou retirer un rôle qui voit et traite ce type (direction)')
        .addStringOption(typeOption)
        .addRoleOption((o) => o.setName('role').setDescription('Rôle à ajouter (ou à retirer s’il y est déjà)').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('type-retirer').setDescription('Retirer un type du menu (l’historique est conservé) (direction)').addStringOption(typeOption),
    )
    .addSubcommand((s) =>
      s.setName('type-reactiver').setDescription('Remettre un type retiré dans le menu (direction)').addStringOption(typeOption),
    )
    .addSubcommand((s) => s.setName('types').setDescription('Liste des types de tickets (direction)'))
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Donner accès à ce ticket à un membre (équipe du ticket)')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer l’accès à ce ticket à un membre (équipe du ticket)')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('stats').setDescription('Statistiques des tickets (direction)')),

  async autocomplete(interaction) {
    await suggestTypes(interaction);
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'ajouter' || sub === 'retirer') return memberAccess(interaction, sub);
    if (!isDirection(interaction.member)) {
      await interaction.reply({ content: '⛔ Cette commande est réservée à la direction.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (sub === 'type-creer') return startCreate(interaction);
    if (sub === 'type-modifier') return startEdit(interaction);
    if (sub === 'type-acces') return toggleAccess(interaction);
    if (sub === 'type-retirer' || sub === 'type-reactiver') return setEnabled(interaction, sub === 'type-reactiver');
    if (sub === 'types') return showTypes(interaction);
    if (sub === 'stats') return stats(interaction);
  },
};

export const ticketsAdminHandler: ComponentHandler = {
  prefix: 'tickadm',
  async modal(interaction, action, key) {
    if (action === 'type') await submitType(interaction, key ?? '');
  },
};

async function suggestTypes(interaction: AutocompleteInteraction) {
  const q = interaction.options.getFocused().toLowerCase();
  const types = await listTypes(true);
  await interaction.respond(
    types
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((t) => ({ name: `${t.enabled ? '' : '[retiré] '}${t.emoji ? `${t.emoji} ` : ''}${t.name}`.slice(0, 100), value: String(t.id) })),
  );
}

async function typeFromOption(interaction: ChatInputCommandInteraction<'cached'>): Promise<TicketType | null> {
  const type = await getType(Number(interaction.options.getString('type', true)));
  if (!type) {
    await interaction.reply({ content: '❌ Type inconnu : choisis-le dans la liste proposée.', flags: MessageFlags.Ephemeral });
    return null;
  }
  return type;
}

function typeModal(key: string, title: string, t?: TicketType) {
  const name = new TextInputBuilder().setCustomId('nom').setLabel('Nom du type').setStyle(TextInputStyle.Short).setMaxLength(45).setRequired(true);
  const emoji = new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (facultatif)').setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(false);
  const desc = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description courte (affichée dans le menu)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(false);
  const questions = new TextInputBuilder()
    .setCustomId('questions')
    .setLabel('Questions : 1 par ligne, max 5 (* long, ? option)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Membre du personnel concerné\n?Date et heure des faits\n*Description des faits')
    .setMaxLength(400)
    .setRequired(false);
  if (t) {
    name.setValue(t.name);
    if (t.emoji) emoji.setValue(t.emoji);
    if (t.description) desc.setValue(t.description);
    if (t.questions.length) questions.setValue(formatQuestions(t.questions));
  }
  return new ModalBuilder()
    .setCustomId(`tickadm:type:${key}`)
    .setTitle(title)
    .addComponents([name, emoji, desc, questions].map((c) => new ActionRowBuilder<TextInputBuilder>().addComponents(c)));
}

async function startCreate(interaction: ChatInputCommandInteraction<'cached'>) {
  const role = interaction.options.getRole('role', true);
  const opener = (interaction.options.getString('ouverture') as Opener | null) ?? 'verifie';
  const key = remember({ userId: interaction.user.id, roleId: role.id, opener });
  await interaction.showModal(typeModal(key, 'Nouveau type de ticket'));
}

async function startEdit(interaction: ChatInputCommandInteraction<'cached'>) {
  const type = await typeFromOption(interaction);
  if (!type) return;
  const opener = (interaction.options.getString('ouverture') as Opener | null) ?? undefined;
  const key = remember({ userId: interaction.user.id, typeId: type.id, opener });
  await interaction.showModal(typeModal(key, `Modifier « ${type.name} »`.slice(0, 45), type));
}

async function submitType(interaction: ModalSubmitInteraction, key: string) {
  if (!interaction.inCachedGuild()) return;
  const p = pending.get(key);
  if (!p || p.userId !== interaction.user.id || p.expires < Date.now()) {
    await interaction.reply({ content: '⌛ Ce formulaire a expiré : relance la commande.', flags: MessageFlags.Ephemeral });
    return;
  }
  const parsed = parseQuestions(interaction.fields.getTextInputValue('questions'));
  if (!parsed.ok) {
    await interaction.reply({ content: `❌ ${parsed.error}\nRelance la commande pour corriger.`, flags: MessageFlags.Ephemeral });
    return;
  }
  pending.delete(key);
  const name = interaction.fields.getTextInputValue('nom').trim();
  const values = {
    name,
    slug: slugify(name),
    emoji: interaction.fields.getTextInputValue('emoji').trim() || null,
    description: interaction.fields.getTextInputValue('description').trim() || null,
    questions: parsed.questions,
    ...(p.opener ? { opener: p.opener } : {}),
  };
  const type = p.typeId
    ? await updateType(p.typeId, values)
    : await createType({ ...values, staffRoleIds: p.roleId ? [p.roleId] : [] });
  await refreshTicketsPanel(interaction.guild);
  await interaction.reply({
    content: `✅ Type ${p.typeId ? 'modifié' : 'créé'} : **${typeLabel(type)}** — ${type.questions.length} question(s), ouverture : ${OPENERS[type.opener]}.\nLe menu de #ouvrir-un-ticket est à jour (s’il a été publié avec \`/config publier\`).`,
    flags: MessageFlags.Ephemeral,
  });
  await sendLog(interaction.guild, {
    title: p.typeId ? '⚙️ Type de ticket modifié' : '⚙️ Type de ticket créé',
    description: typeLabel(type),
    color: LogColor.neutral,
    actor: interaction.user,
  });
}

async function toggleAccess(interaction: ChatInputCommandInteraction<'cached'>) {
  const type = await typeFromOption(interaction);
  if (!type) return;
  const role = interaction.options.getRole('role', true);
  const has = type.staffRoleIds.includes(role.id);
  const updated = await updateType(type.id, {
    staffRoleIds: has ? type.staffRoleIds.filter((id) => id !== role.id) : [...type.staffRoleIds, role.id],
  });
  await interaction.reply({
    content: `✅ ${role} ${has ? 'ne voit plus' : 'voit et traite désormais'} les tickets **${typeLabel(type)}**.\nAccès actuel : ${updated.staffRoleIds.map((id) => `<@&${id}>`).join(', ') || '_direction uniquement_'}\n_Les tickets déjà ouverts ne changent pas._`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
  await sendLog(interaction.guild, {
    title: '⚙️ Accès à un type de ticket modifié',
    description: `${typeLabel(type)} : ${role} ${has ? 'retiré' : 'ajouté'}`,
    color: LogColor.neutral,
    actor: interaction.user,
  });
}

async function setEnabled(interaction: ChatInputCommandInteraction<'cached'>, enabled: boolean) {
  const type = await typeFromOption(interaction);
  if (!type) return;
  await updateType(type.id, { enabled });
  await refreshTicketsPanel(interaction.guild);
  await interaction.reply({
    content: enabled ? `✅ **${typeLabel(type)}** est de nouveau proposé dans le menu.` : `✅ **${typeLabel(type)}** est retiré du menu. Les tickets ouverts et l’historique sont conservés.`,
    flags: MessageFlags.Ephemeral,
  });
  await sendLog(interaction.guild, {
    title: enabled ? '⚙️ Type de ticket réactivé' : '⚙️ Type de ticket retiré',
    description: typeLabel(type),
    color: LogColor.neutral,
    actor: interaction.user,
  });
}

async function showTypes(interaction: ChatInputCommandInteraction<'cached'>) {
  const types = await listTypes(true);
  const embed = new EmbedBuilder()
    .setTitle('🎫 Types de tickets')
    .setColor(0x0ea5e9)
    .setDescription(types.length ? null : 'Aucun type. Crée-en un avec `/tickets type-creer`.');
  for (const t of types.slice(0, 25)) {
    embed.addFields({
      name: `${t.enabled ? '' : '[retiré] '}${typeLabel(t)}`.slice(0, 256),
      value: [
        `Accès : ${t.staffRoleIds.map((id) => `<@&${id}>`).join(', ') || '_direction uniquement_'}`,
        `Ouverture : ${OPENERS[t.opener]}`,
        `Questions : ${t.questions.map((q) => `${q.label}${q.required ? '' : ' _(facultative)_'}`).join(' · ') || '_« Décris ta demande »_'}`,
      ]
        .join('\n')
        .slice(0, 1024),
    });
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function memberAccess(interaction: ChatInputCommandInteraction<'cached'>, sub: 'ajouter' | 'retirer') {
  const ticket = await getTicketByChannel(interaction.channelId);
  const type = ticket ? await getType(ticket.typeId) : undefined;
  if (!ticket || !type || ticket.status !== 'ouvert') {
    await interaction.reply({ content: '❌ Utilise cette commande dans le salon d’un ticket ouvert.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canHandle(interaction.member, type)) {
    await interaction.reply({ content: '⛔ Réservé à l’équipe en charge de ce ticket.', flags: MessageFlags.Ephemeral });
    return;
  }
  const user = interaction.options.getUser('membre', true);
  if (sub === 'retirer' && user.id === ticket.userId) {
    await interaction.reply({ content: '❌ On ne peut pas retirer l’auteur du ticket.', flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = interaction.channel;
  if (!channel || !('permissionOverwrites' in channel)) return;
  if (sub === 'ajouter') {
    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    });
  } else {
    await channel.permissionOverwrites.delete(user.id);
  }
  await interaction.reply({ content: sub === 'ajouter' ? `➕ ${user} a été ajouté au ticket.` : `➖ ${user} a été retiré du ticket.`, allowedMentions: { users: sub === 'ajouter' ? [user.id] : [] } });
}

async function stats(interaction: ChatInputCommandInteraction<'cached'>) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const [rows, types] = await Promise.all([allTickets(), listTypes(true)]);
  const valid = rows.filter((t) => t.closeReason !== 'Échec de création du salon');
  const since30 = Date.now() - 30 * 86_400_000;
  const hours = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
  const avg = (list: number[]) => (list.length ? hours(list.reduce((a, b) => a + b, 0) / list.length) : '—');

  const closed = valid.filter((t) => t.status === 'ferme' && t.closedAt);
  const claimDelays = valid.filter((t) => t.claimedAt).map((t) => t.claimedAt!.getTime() - t.openedAt.getTime());
  const resolveDelays = closed.map((t) => t.closedAt!.getTime() - t.openedAt.getTime());

  const perType = types
    .map((ty) => {
      const list = valid.filter((t) => t.typeId === ty.id);
      if (!list.length) return null;
      const open = list.filter((t) => t.status === 'ouvert').length;
      const recent = list.filter((t) => t.openedAt.getTime() >= since30).length;
      return `${typeLabel(ty)} : **${list.length}** au total · ${open} ouvert(s) · ${recent} sur 30 jours`;
    })
    .filter(Boolean)
    .join('\n');

  const claimers = new Map<string, number>();
  for (const t of valid) if (t.claimedBy) claimers.set(t.claimedBy, (claimers.get(t.claimedBy) ?? 0) + 1);
  const top = [...claimers.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n], i) => `${i + 1}. <@${id}> — ${n}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📊 Statistiques des tickets')
    .setColor(0x0ea5e9)
    .addFields(
      { name: 'Total', value: String(valid.length), inline: true },
      { name: 'Ouverts', value: String(valid.filter((t) => t.status === 'ouvert').length), inline: true },
      { name: '30 derniers jours', value: String(valid.filter((t) => t.openedAt.getTime() >= since30).length), inline: true },
      { name: 'Délai moyen de prise en charge', value: avg(claimDelays), inline: true },
      { name: 'Délai moyen de résolution', value: avg(resolveDelays), inline: true },
      { name: 'Non pris en charge (ouverts)', value: String(valid.filter((t) => t.status === 'ouvert' && !t.claimedBy).length), inline: true },
      { name: 'Par type', value: perType || '—' },
      { name: 'Prises en charge', value: top || '—' },
    );
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
