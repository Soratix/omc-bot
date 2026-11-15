/**
 * Panneau du salon #gestion-secrétaire (direction) : boutons « Avertissement » et « Sanction ».
 * Chaque bouton ouvre un formulaire : ID (ou mention) du membre + raison.
 * L'avertissement / la sanction est inscrit dans le dossier du membre et dans les logs.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { ComponentHandler } from '../core/types.js';
import { isDirection } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { displayRpName } from '../verification/fiches.js';
import { EVENT_STYLE, addDossierEvent, countEvents } from './service.js';

type Kind = 'avertissement' | 'sanction';
const isKind = (s: string | undefined): s is Kind => s === 'avertissement' || s === 'sanction';

export function gestionPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🗂️ Gestion du personnel')
    .setColor(0x0ea5e9)
    .setDescription(
      [
        'Enregistrer un **avertissement** ou une **sanction** pour un membre du personnel.',
        '',
        '• Indique l’**ID Discord** du membre (clic droit sur le membre > Copier l’identifiant) ou sa mention.',
        '• La raison est inscrite dans son **dossier** et dans les logs.',
        '',
        '_Réservé à la direction._',
      ].join('\n'),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('gest:ouvrir:avertissement').setLabel('Avertissement').setEmoji('⚠️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('gest:ouvrir:sanction').setLabel('Sanction').setEmoji('⛔').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

export const gestionHandler: ComponentHandler = {
  prefix: 'gest',
  async button(interaction, action, arg) {
    if (action === 'ouvrir' && isKind(arg)) await openForm(interaction, arg);
  },
  async modal(interaction, action, arg) {
    if (action === 'saisie' && isKind(arg)) await submit(interaction, arg);
  },
};

async function openForm(interaction: ButtonInteraction, kind: Kind) {
  if (!interaction.inCachedGuild()) return;
  if (!isDirection(interaction.member)) {
    await interaction.reply({ content: '⛔ Réservé à la direction.', flags: MessageFlags.Ephemeral });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`gest:saisie:${kind}`)
    .setTitle(kind === 'sanction' ? 'Nouvelle sanction' : 'Nouvel avertissement')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('membre')
          .setLabel('ID Discord du membre (ou mention)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex. : 123456789012345678')
          .setMinLength(17)
          .setMaxLength(40)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('raison')
          .setLabel(kind === 'sanction' ? 'Raison et nature de la sanction' : 'Raison de l’avertissement')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1500)
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

async function submit(interaction: ModalSubmitInteraction, kind: Kind) {
  if (!interaction.inCachedGuild()) return;
  if (!isDirection(interaction.member)) {
    await interaction.reply({ content: '⛔ Réservé à la direction.', flags: MessageFlags.Ephemeral });
    return;
  }
  const userId = /(\d{17,20})/.exec(interaction.fields.getTextInputValue('membre'))?.[1];
  const reason = interaction.fields.getTextInputValue('raison').trim();
  if (!userId) {
    await interaction.reply({ content: '❌ ID invalide : clic droit sur le membre > **Copier l’identifiant** (mode développeur activé).', flags: MessageFlags.Ephemeral });
    return;
  }
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  if (!user) {
    await interaction.reply({ content: `❌ Aucun utilisateur Discord ne correspond à l’ID ${userId}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await addDossierEvent(interaction.guild, userId, kind, reason, interaction.user.id);
  if (!result) {
    await interaction.editReply(
      `❌ ${user} n’a pas de dossier : il n’a jamais eu le rôle du personnel (EMS). Rien n’a été enregistré.`,
    );
    return;
  }
  const total = await countEvents(userId, kind);
  const name = await displayRpName(null, userId);
  const style = EVENT_STYLE[kind];
  await interaction.editReply(
    `${style.emoji} ${style.label} enregistré(e) pour **${name}** (${total} au total).${result.url ? `\nDossier : ${result.url}` : '\n⚠️ Forum des dossiers non configuré : inscrit en base uniquement.'}`,
  );
  await sendLog(interaction.guild, {
    title: `${style.emoji} ${style.label}`,
    description: reason.slice(0, 4000),
    color: kind === 'sanction' ? LogColor.error : LogColor.warning,
    target: user,
    actor: interaction.user,
    fields: [{ name: 'Total', value: String(total), inline: true }],
  });
}
