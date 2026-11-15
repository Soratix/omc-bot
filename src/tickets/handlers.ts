/**
 * Cycle de vie d'un ticket :
 *   menu « Ouvrir un ticket » → formulaire du type → salon privé dans la catégorie des tickets
 *   → « Prendre en charge » → « Fermer » (formulaire avec motif = confirmation)
 *   → transcript HTML dans #logs-tickets → suppression du salon.
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type OverwriteResolvable,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { channelId } from '../config/settings.js';
import type { ComponentHandler } from '../core/types.js';
import type { Ticket, TicketType } from '../db/schema.js';
import { formatFrDateTime } from '../lib/dates.js';
import { describeApiError, isStaff } from '../lib/members.js';
import { logger } from '../logger.js';
import { LogColor, sendLog } from '../logs/index.js';
import { displayRpName, getFiche } from '../verification/fiches.js';
import { canHandle, sendTicketLog, ticketMessage, typeLabel } from './common.js';
import { slugify } from './questions.js';
import { createTicket, getTicket, getType, openTicketOf, updateTicket } from './repo.js';
import { buildTranscript } from './transcript.js';

export const ticketsHandler: ComponentHandler = {
  prefix: 'tick',
  async select(interaction, action) {
    if (action === 'ouvrir') await chooseType(interaction);
  },
  async button(interaction, action, arg) {
    const id = Number(arg);
    if (!Number.isInteger(id)) return;
    if (action === 'prendre') return claim(interaction, id);
    if (action === 'fermer') return askClose(interaction, id);
  },
  async modal(interaction, action, arg) {
    const id = Number(arg);
    if (!Number.isInteger(id)) return;
    if (action === 'formulaire') return openTicket(interaction, id);
    if (action === 'fermeture') return closeTicket(interaction, id);
  },
};

/** Le membre peut-il ouvrir ce type de ticket ? Retourne le motif du refus, ou null. */
async function whyCannotOpen(member: GuildMember, type: TicketType): Promise<string | null> {
  if (type.opener === 'personnel' && !isStaff(member)) return 'Ce type de ticket est réservé au personnel de l’hôpital.';
  if (type.opener === 'verifie' && !(await getFiche(member.id))) {
    return 'Tu dois d’abord créer ta fiche dans le salon de vérification.';
  }
  const open = await openTicketOf(member.id, type.id);
  if (open) return `Tu as déjà un ticket « ${type.name} » ouvert : <#${open.channelId}>.`;
  return null;
}

// ── Ouverture ───────────────────────────────────────────────────────────────

async function chooseType(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const type = await getType(Number(interaction.values[0]));
  if (!type?.enabled) {
    await interaction.reply({ content: '❌ Ce type de ticket n’est plus disponible.', flags: MessageFlags.Ephemeral });
    return;
  }
  const refusal = await whyCannotOpen(interaction.member, type);
  if (refusal) {
    await interaction.reply({ content: `❌ ${refusal}`, flags: MessageFlags.Ephemeral });
    return;
  }
  const questions = type.questions.length ? type.questions : [{ label: 'Décris ta demande', long: true, required: true }];
  const modal = new ModalBuilder()
    .setCustomId(`tick:formulaire:${type.id}`)
    .setTitle(typeLabel(type).slice(0, 45))
    .addComponents(
      questions.slice(0, 5).map((q, i) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(`q${i}`)
            .setLabel(q.label.slice(0, 45))
            .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setMaxLength(q.long ? 2000 : 200)
            .setRequired(q.required),
        ),
      ),
    );
  await interaction.showModal(modal);
  // Remet le menu à zéro (sinon re-choisir le même type ne déclenche rien).
  await interaction.message.edit({ components: interaction.message.components }).catch(() => {});
}

function overwritesFor(guild: Guild, type: TicketType, openerId: string): OverwriteResolvable[] {
  const member = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
  const out: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role },
    { id: openerId, allow: member, type: OverwriteType.Member },
    { id: guild.members.me!.id, allow: [...member, PermissionFlagsBits.ManageChannels], type: OverwriteType.Member },
  ];
  for (const roleId of type.staffRoleIds) {
    if (guild.roles.cache.has(roleId)) out.push({ id: roleId, allow: member, type: OverwriteType.Role });
  }
  return out;
}

async function openTicket(interaction: ModalSubmitInteraction, typeId: number) {
  if (!interaction.inCachedGuild()) return;
  const guild = interaction.guild;
  const type = await getType(typeId);
  if (!type?.enabled) {
    await interaction.reply({ content: '❌ Ce type de ticket n’est plus disponible.', flags: MessageFlags.Ephemeral });
    return;
  }
  const refusal = await whyCannotOpen(interaction.member, type);
  if (refusal) {
    await interaction.reply({ content: `❌ ${refusal}`, flags: MessageFlags.Ephemeral });
    return;
  }
  const categoryId = channelId('tickets_categorie');
  const category = categoryId ? guild.channels.cache.get(categoryId) : undefined;
  if (category?.type !== ChannelType.GuildCategory) {
    await interaction.reply({ content: '❌ Les tickets ne sont pas encore configurés (catégorie manquante). Préviens la direction.', flags: MessageFlags.Ephemeral });
    await sendLog(guild, { title: '⚠️ Ticket impossible à ouvrir', description: 'La catégorie des tickets n’est pas configurée : `/config salon cle:Catégorie des tickets ouverts`.', color: LogColor.warning, target: interaction.user, alert: true });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const questions = type.questions.length ? type.questions : [{ label: 'Décris ta demande', long: true, required: true }];
  const answers = questions.slice(0, 5).map((q, i) => ({ question: q.label, answer: interaction.fields.getTextInputValue(`q${i}`).trim() }));
  const ticket = await createTicket({ typeId: type.id, userId: interaction.user.id, answers });

  const name = await displayRpName(interaction.member, interaction.user.id);
  let channel;
  try {
    channel = await guild.channels.create({
      name: `${type.slug}-${ticket.id}-${slugify(name, 40)}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Ticket n°${ticket.id} — ${type.name} — ouvert par ${name}`,
      permissionOverwrites: overwritesFor(guild, type, interaction.user.id),
      reason: `Ticket n°${ticket.id} (${type.name})`,
    });
  } catch (err) {
    // On n'enregistre pas un ticket sans salon : il bloquerait la limite d'un ticket par type.
    await updateTicket(ticket.id, { status: 'ferme', closedAt: new Date(), closeReason: 'Échec de création du salon' });
    const error = describeApiError(err, 'créer le salon du ticket');
    await interaction.editReply(`❌ ${error} La direction a été prévenue.`);
    await sendLog(guild, { title: '⚠️ Ticket impossible à ouvrir', description: error, color: LogColor.warning, target: interaction.user, alert: true });
    return;
  }
  const saved = await updateTicket(ticket.id, { channelId: channel.id });

  const pings = [`<@${interaction.user.id}>`, ...type.staffRoleIds.filter((id) => guild.roles.cache.has(id)).map((id) => `<@&${id}>`)];
  await channel.send({
    content: pings.join(' '),
    ...ticketMessage(saved, type),
    allowedMentions: { users: [interaction.user.id], roles: type.staffRoleIds },
  });
  await interaction.editReply(`✅ Ton ticket est ouvert : ${channel}`);
  await sendTicketLog(
    guild,
    new EmbedBuilder()
      .setTitle(`📨 Ticket n°${ticket.id} ouvert — ${typeLabel(type)}`)
      .setColor(0x0ea5e9)
      .addFields({ name: 'Par', value: `<@${interaction.user.id}> (${name})`, inline: true }, { name: 'Salon', value: `${channel}`, inline: true }),
  );
}

// ── Prise en charge ─────────────────────────────────────────────────────────

async function loadTicket(interaction: ButtonInteraction | ModalSubmitInteraction, id: number) {
  if (!interaction.inCachedGuild()) return null;
  const ticket = await getTicket(id);
  const type = ticket ? await getType(ticket.typeId) : undefined;
  if (!ticket || !type || ticket.status !== 'ouvert') {
    await interaction.reply({ content: 'ℹ️ Ce ticket est déjà fermé.', flags: MessageFlags.Ephemeral });
    return null;
  }
  return { ticket, type, member: interaction.member, guild: interaction.guild };
}

async function claim(interaction: ButtonInteraction, id: number) {
  const ctx = await loadTicket(interaction, id);
  if (!ctx) return;
  if (!canHandle(ctx.member, ctx.type)) {
    await interaction.reply({ content: '⛔ Seule l’équipe en charge de ce type de ticket peut le prendre en charge.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (ctx.ticket.claimedBy) {
    await interaction.reply({ content: `ℹ️ Déjà pris en charge par <@${ctx.ticket.claimedBy}>.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const updated = await updateTicket(id, { claimedBy: interaction.user.id, claimedAt: new Date() });
  await interaction.update(ticketMessage(updated, ctx.type));
  await interaction.followUp({ content: `🙋 ${interaction.user} prend en charge ce ticket.`, allowedMentions: { parse: [] } });
  await sendTicketLog(
    ctx.guild,
    new EmbedBuilder().setTitle(`🙋 Ticket n°${id} pris en charge`).setColor(0x22c55e).setDescription(`Par ${interaction.user} — <#${ctx.ticket.channelId}>`),
  );
}

// ── Fermeture ───────────────────────────────────────────────────────────────

async function askClose(interaction: ButtonInteraction, id: number) {
  const ctx = await loadTicket(interaction, id);
  if (!ctx) return;
  if (!canHandle(ctx.member, ctx.type) && ctx.ticket.userId !== interaction.user.id) {
    await interaction.reply({ content: '⛔ Seuls l’auteur du ticket et l’équipe en charge peuvent le fermer.', flags: MessageFlags.Ephemeral });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`tick:fermeture:${id}`)
    .setTitle(`Fermer le ticket n°${id}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('motif')
          .setLabel('Motif de fermeture (confirme la fermeture)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

async function closeTicket(interaction: ModalSubmitInteraction, id: number) {
  const ctx = await loadTicket(interaction, id);
  if (!ctx) return;
  if (!canHandle(ctx.member, ctx.type) && ctx.ticket.userId !== interaction.user.id) {
    await interaction.reply({ content: '⛔ Seuls l’auteur du ticket et l’équipe en charge peuvent le fermer.', flags: MessageFlags.Ephemeral });
    return;
  }
  const reason = interaction.fields.getTextInputValue('motif').trim();
  await interaction.reply({ content: `🔒 Ticket fermé par ${interaction.user} : ${reason}\nGénération du transcript, le salon sera supprimé dans quelques secondes…`, allowedMentions: { parse: [] } });
  await finalizeClose(ctx.guild, ctx.ticket, ctx.type, interaction.user.id, reason, true);
}

/**
 * Ferme le ticket : transcript dans #logs-tickets, message privé à l'auteur, suppression du salon.
 * `deleteChannel` = false quand le salon a déjà été supprimé à la main.
 */
export async function finalizeClose(guild: Guild, ticket: Ticket, type: TicketType, closedBy: string | null, reason: string, deleteChannel: boolean) {
  const closed = await updateTicket(ticket.id, { status: 'ferme', closedAt: new Date(), closedBy, closeReason: reason });
  const channel = ticket.channelId ? guild.channels.cache.get(ticket.channelId) : undefined;

  let files: Awaited<ReturnType<typeof buildTranscript>>['file'][] = [];
  let count = 0;
  let html: Buffer | null = null;
  if (channel?.type === ChannelType.GuildText) {
    try {
      const t = await buildTranscript(channel, closed, type);
      files = [t.file];
      count = t.count;
      html = t.html;
    } catch (err) {
      logger.error(`Ticket n°${ticket.id} : transcript impossible`, err);
    }
  }
  const name = await displayRpName(null, ticket.userId);
  const embed = new EmbedBuilder()
    .setTitle(`🔒 Ticket n°${ticket.id} fermé — ${typeLabel(type)}`)
    .setColor(0x6b7280)
    .addFields(
      { name: 'Ouvert par', value: `<@${ticket.userId}> (${name})`, inline: true },
      { name: 'Pris en charge par', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
      { name: 'Fermé par', value: closedBy ? `<@${closedBy}>` : '—', inline: true },
      { name: 'Ouvert le', value: formatFrDateTime(ticket.openedAt), inline: true },
      { name: 'Fermé le', value: formatFrDateTime(closed.closedAt ?? new Date()), inline: true },
      { name: 'Messages', value: files.length ? String(count) : 'transcript indisponible', inline: true },
      { name: 'Motif', value: reason.slice(0, 1024) },
    );
  const logged = await sendTicketLog(guild, embed, files);

  // Prévient l'auteur avec une copie du transcript (silencieux si ses MP sont fermés).
  const user = await guild.client.users.fetch(ticket.userId).catch(() => null);
  const dmSent = await user
    ?.send({
      content:
        `🔒 Ton ticket **${type.name}** (n°${ticket.id}) à l’Ocean Medical Center a été fermé.\nMotif : ${reason}` +
        (html ? '\nCi-joint la copie de la conversation (fichier à ouvrir dans un navigateur).' : ''),
      files: html ? [new AttachmentBuilder(html, { name: `ticket-${ticket.id}.html` })] : [],
    })
    .then(() => true)
    .catch(() => false);
  if (!dmSent) logger.info(`Ticket n°${ticket.id} : message privé à l’auteur impossible (MP fermés).`);

  if (deleteChannel && channel) {
    // Si le transcript n'a pas pu être archivé, on garde le salon pour ne rien perdre.
    if (!logged) {
      await sendLog(guild, {
        title: '⚠️ Transcript non archivé',
        description: `Le ticket n°${ticket.id} est fermé mais le transcript n’a pas pu être envoyé : le salon ${channel} est conservé. Vérifie le salon #logs-tickets puis supprime le salon à la main.`,
        color: LogColor.warning,
        alert: true,
      });
      return;
    }
    setTimeout(() => {
      channel.delete(`Ticket n°${ticket.id} fermé`).catch((err) => logger.error(`Suppression du salon du ticket n°${ticket.id}`, err));
    }, 5000);
  }
}
