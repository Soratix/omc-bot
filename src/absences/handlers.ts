/**
 * Boutons et formulaires du module absences.
 * Les boutons « Je suis revenu » et « Prolonger » fonctionnent aussi depuis le rappel en message privé.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { ComponentHandler } from '../core/types.js';
import type { Absence } from '../db/schema.js';
import { env } from '../env.js';
import { formatFr, parseFrDate, todayParis } from '../lib/dates.js';
import { isDirection, isStaff } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { addDossierEvent } from '../dossiers/service.js';
import { displayRpName } from '../verification/fiches.js';
import { createAbsence, findOverlapping, getAbsence, isActive } from './repo.js';
import { afterCreate, cancelAbsence, extendAbsence, markReturned } from './service.js';

export const absencesHandler: ComponentHandler = {
  prefix: 'abs',
  async button(interaction, action, arg) {
    if (action === 'declarer') return openDeclareForm(interaction);
    const id = Number(arg);
    if (!Number.isInteger(id)) return;
    if (action === 'retour') return onReturn(interaction, id);
    if (action === 'prolonger') return openExtendForm(interaction, id);
    if (action === 'annuler') return askCancel(interaction, id);
    if (action === 'annuler_ok') return onCancel(interaction, id);
  },
  async modal(interaction, action, arg) {
    if (action === 'nouvelle') return submitDeclare(interaction);
    if (action === 'prolonger') return submitExtend(interaction, Number(arg));
  },
};

/** Serveur de l'OMC, y compris quand l'interaction vient d'un message privé. */
function omcGuild(interaction: ButtonInteraction | ModalSubmitInteraction): Guild | undefined {
  return interaction.guild ?? interaction.client.guilds.cache.get(env.GUILD_ID);
}

async function replyError(interaction: ButtonInteraction | ModalSubmitInteraction, content: string) {
  const payload = { content, flags: MessageFlags.Ephemeral } as const;
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

/**
 * Charge l'absence et vérifie que l'utilisateur peut agir dessus (auteur ou direction).
 * Répond lui-même en cas de refus.
 */
async function loadForAction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  id: number,
): Promise<{ guild: Guild; absence: Absence; actor: GuildMember | null } | null> {
  const guild = omcGuild(interaction);
  const absence = await getAbsence(id);
  if (!guild || !absence) {
    await replyError(interaction, '❌ Cette absence est introuvable.');
    return null;
  }
  const actor = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (absence.userId !== interaction.user.id && !(actor && isDirection(actor))) {
    await replyError(interaction, '⛔ Seul l’auteur de l’absence ou la direction peut faire ça.');
    return null;
  }
  if (!isActive(absence)) {
    await replyError(interaction, 'ℹ️ Cette absence est déjà clôturée.');
    return null;
  }
  return { guild, absence, actor };
}

/**
 * Accuse réception de l'interaction (Discord exige une réponse sous 3 s).
 * Depuis un rappel (MP ou salon staff), le message du rappel sera modifié et ses boutons retirés ;
 * sinon, réponse éphémère.
 */
async function ack(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<'update' | 'reply'> {
  const fromReminder = !interaction.inGuild() || !!interaction.message?.embeds[0]?.title?.startsWith('⏰');
  if (fromReminder && interaction.message && (interaction.isButton() || interaction.isFromMessage())) {
    await interaction.deferUpdate();
    return 'update';
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return 'reply';
}

async function finish(interaction: ButtonInteraction | ModalSubmitInteraction, mode: 'update' | 'reply', content: string) {
  if (mode === 'update') await interaction.editReply({ content, components: [] });
  else await interaction.editReply(content);
}

// ── Déclaration ─────────────────────────────────────────────────────────────

async function openDeclareForm(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: '⛔ La déclaration d’absence est réservée au personnel de l’hôpital.', flags: MessageFlags.Ephemeral });
    return;
  }
  const today = formatFr(todayParis());
  const modal = new ModalBuilder()
    .setCustomId('abs:nouvelle')
    .setTitle('Déclarer une absence')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('debut').setLabel('Date de début (JJ/MM/AAAA)').setStyle(TextInputStyle.Short).setPlaceholder(today).setValue(today).setMinLength(8).setMaxLength(10).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('fin').setLabel('Date de fin (JJ/MM/AAAA)').setStyle(TextInputStyle.Short).setPlaceholder(today).setMinLength(8).setMaxLength(10).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('motif').setLabel('Motif (facultatif)').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false),
      ),
    );
  await interaction.showModal(modal);
}

async function submitDeclare(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const member = interaction.member;
  if (!isStaff(member)) {
    await replyError(interaction, '⛔ La déclaration d’absence est réservée au personnel de l’hôpital.');
    return;
  }
  const start = parseFrDate(interaction.fields.getTextInputValue('debut'));
  const end = parseFrDate(interaction.fields.getTextInputValue('fin'));
  const reason = interaction.fields.getTextInputValue('motif').trim() || null;
  const today = todayParis();
  const retry = '\nClique à nouveau sur **Déclarer une absence** pour corriger.';

  if (!start || !end) return replyError(interaction, `❌ Date invalide : utilise le format JJ/MM/AAAA (ex. ${formatFr(today)}).${retry}`);
  if (end < start) return replyError(interaction, `❌ La date de fin doit être après (ou égale à) la date de début.${retry}`);
  if (end < today) return replyError(interaction, `❌ La date de fin est déjà passée.${retry}`);

  const overlap = await findOverlapping(member.id, start, end);
  if (overlap.length) {
    const o = overlap[0]!;
    return replyError(
      interaction,
      `❌ Tu as déjà une absence du ${formatFr(o.startDate)} au ${formatFr(o.endDate)} sur cette période. Utilise plutôt le bouton **Prolonger** sur sa fiche.`,
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const created = await createAbsence({ userId: member.id, startDate: start, endDate: end, reason });
  const { absence, roleError } = await afterCreate(interaction.guild, created);

  const link = absence.channelId && absence.messageId ? `https://discord.com/channels/${interaction.guild.id}/${absence.channelId}/${absence.messageId}` : null;
  await interaction.editReply(
    `✅ Absence enregistrée du **${formatFr(start)}** au **${formatFr(end)}**.${link ? `\nFiche : ${link}` : ''}${roleError ? `\n⚠️ ${roleError}` : ''}`,
  );
  await sendLog(interaction.guild, {
    title: '📅 Absence déclarée',
    color: LogColor.info,
    target: member.user,
    fields: [
      { name: 'Période', value: `${formatFr(start)} → ${formatFr(end)}`, inline: true },
      { name: 'N°', value: String(absence.id), inline: true },
      ...(reason ? [{ name: 'Motif', value: reason.slice(0, 1024) }] : []),
      ...(roleError ? [{ name: '⚠️ Rôle Absent', value: roleError }] : []),
    ],
  });
  await addDossierEvent(
    interaction.guild,
    member.id,
    'absence',
    `Absence déclarée du **${formatFr(start)}** au **${formatFr(end)}** (n°${absence.id}).${reason ? `
Motif : ${reason}` : ''}`,
  );
}

// ── Retour ──────────────────────────────────────────────────────────────────

async function onReturn(interaction: ButtonInteraction, id: number) {
  const ctx = await loadForAction(interaction, id);
  if (!ctx) return;
  const mode = await ack(interaction);
  const { absence, roleError } = await markReturned(ctx.guild, ctx.absence, interaction.user);
  const msg = `🟢 Retour enregistré, bon retour parmi nous !${roleError ? `\n⚠️ ${roleError}` : ''}`;
  await finish(interaction, mode, msg);
  await sendLog(ctx.guild, {
    title: '🟢 Retour d’absence',
    color: LogColor.success,
    target: await interaction.client.users.fetch(absence.userId),
    actor: absence.userId === interaction.user.id ? undefined : interaction.user,
    fields: [{ name: 'Absence', value: `n°${absence.id} — ${formatFr(absence.startDate)} → ${formatFr(absence.endDate)}` }],
  });
  await addDossierEvent(ctx.guild, absence.userId, 'absence', `🟢 Retour confirmé (absence n°${absence.id}, ${formatFr(absence.startDate)} → ${formatFr(absence.endDate)}).`, absence.userId === interaction.user.id ? null : interaction.user.id);
}

// ── Prolongation ────────────────────────────────────────────────────────────

async function openExtendForm(interaction: ButtonInteraction, id: number) {
  const ctx = await loadForAction(interaction, id);
  if (!ctx) return;
  const modal = new ModalBuilder()
    .setCustomId(`abs:prolonger:${id}`)
    .setTitle('Prolonger l’absence')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('fin')
          .setLabel('Nouvelle date de fin (JJ/MM/AAAA)')
          .setStyle(TextInputStyle.Short)
          .setValue(formatFr(ctx.absence.endDate))
          .setMinLength(8)
          .setMaxLength(10)
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

async function submitExtend(interaction: ModalSubmitInteraction, id: number) {
  if (!Number.isInteger(id)) return;
  const ctx = await loadForAction(interaction, id);
  if (!ctx) return;
  const newEnd = parseFrDate(interaction.fields.getTextInputValue('fin'));
  const today = todayParis();
  if (!newEnd) return replyError(interaction, '❌ Date invalide : utilise le format JJ/MM/AAAA.');
  if (newEnd < ctx.absence.startDate) return replyError(interaction, `❌ La date de fin ne peut pas être avant le début de l’absence (${formatFr(ctx.absence.startDate)}).`);
  if (newEnd < today) return replyError(interaction, '❌ La nouvelle date de fin est déjà passée. Si tu es revenu, utilise **Je suis revenu**.');
  const overlap = await findOverlapping(ctx.absence.userId, ctx.absence.startDate, newEnd, ctx.absence.id);
  if (overlap.length) return replyError(interaction, `❌ Cette prolongation chevauche une autre absence (du ${formatFr(overlap[0]!.startDate)} au ${formatFr(overlap[0]!.endDate)}).`);

  const oldEnd = ctx.absence.endDate;
  const mode = await ack(interaction);
  const { absence, roleError } = await extendAbsence(ctx.guild, ctx.absence, newEnd);
  const msg = `📅 Absence prolongée jusqu’au **${formatFr(newEnd)}**.${roleError ? `\n⚠️ ${roleError}` : ''}`;
  await finish(interaction, mode, msg);
  await sendLog(ctx.guild, {
    title: '📅 Absence prolongée',
    color: LogColor.info,
    target: await interaction.client.users.fetch(absence.userId),
    actor: absence.userId === interaction.user.id ? undefined : interaction.user,
    fields: [
      { name: 'Ancienne fin', value: formatFr(oldEnd), inline: true },
      { name: 'Nouvelle fin', value: formatFr(newEnd), inline: true },
      { name: 'N°', value: String(absence.id), inline: true },
    ],
  });
  await addDossierEvent(ctx.guild, absence.userId, 'absence', `Absence n°${absence.id} prolongée : fin le **${formatFr(oldEnd)}** → **${formatFr(newEnd)}**.`, absence.userId === interaction.user.id ? null : interaction.user.id);
}

// ── Annulation (avec confirmation) ──────────────────────────────────────────

async function askCancel(interaction: ButtonInteraction, id: number) {
  const ctx = await loadForAction(interaction, id);
  if (!ctx) return;
  const name = await displayRpName(null, ctx.absence.userId);
  await interaction.reply({
    content: `Annuler l’absence de **${name}** du ${formatFr(ctx.absence.startDate)} au ${formatFr(ctx.absence.endDate)} ?`,
    flags: MessageFlags.Ephemeral,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`abs:annuler_ok:${id}`).setLabel('Oui, annuler l’absence').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function onCancel(interaction: ButtonInteraction, id: number) {
  const ctx = await loadForAction(interaction, id);
  if (!ctx) return;
  await interaction.deferUpdate();
  const { absence, roleError } = await cancelAbsence(ctx.guild, ctx.absence, interaction.user);
  await interaction.editReply({ content: `⚫ Absence annulée.${roleError ? `\n⚠️ ${roleError}` : ''}`, components: [] });
  await sendLog(ctx.guild, {
    title: '⚫ Absence annulée',
    color: LogColor.neutral,
    target: await interaction.client.users.fetch(absence.userId),
    actor: absence.userId === interaction.user.id ? undefined : interaction.user,
    fields: [{ name: 'Absence', value: `n°${absence.id} — ${formatFr(absence.startDate)} → ${formatFr(absence.endDate)}` }],
  });
  await addDossierEvent(ctx.guild, absence.userId, 'absence', `⚫ Absence n°${absence.id} annulée (${formatFr(absence.startDate)} → ${formatFr(absence.endDate)}).`, absence.userId === interaction.user.id ? null : interaction.user.id);
}
