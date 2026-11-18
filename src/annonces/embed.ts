/**
 * /embed — publier ou modifier un message embed personnalisé (direction).
 *   /embed envoyer  salon? couleur? image? mention?  → formulaire : titre, contenu, pied de page
 *   /embed modifier lien                             → formulaire pré-rempli avec l'embed existant
 *
 * Le contenu est saisi dans un formulaire (modal) pour permettre les retours à la ligne
 * et la mise en forme Markdown de Discord (**gras**, *italique*, listes, liens…).
 */
import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Command, ComponentHandler } from '../core/types.js';
import { isDirection } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';

const COLORS: Record<string, number> = {
  'Bleu OMC': 0x0ea5e9,
  Rouge: 0xef4444,
  Vert: 0x22c55e,
  Orange: 0xf59e0b,
  Violet: 0x8b5cf6,
  Gris: 0x6b7280,
};

/** Paramètres de la commande en attente de la saisie du formulaire (15 min max). */
interface Pending {
  userId: string;
  channelId: string;
  color?: number;
  image?: string | null;
  mentionRoleId?: string | null;
  editMessageId?: string;
  expires: number;
}
const pending = new Map<string, Pending>();

function remember(p: Omit<Pending, 'expires'>): string {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  const key = randomUUID().slice(0, 8);
  pending.set(key, { ...p, expires: now + 15 * 60_000 });
  return key;
}

export const embedCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Publier ou modifier un message embed (direction)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('envoyer')
        .setDescription('Publier un message embed (le texte se saisit ensuite dans un formulaire)')
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription('Salon de publication (par défaut : ce salon)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addStringOption((o) =>
          o
            .setName('couleur')
            .setDescription('Couleur de la bande (défaut : Bleu OMC)')
            .addChoices(...Object.keys(COLORS).map((name) => ({ name, value: name }))),
        )
        .addStringOption((o) => o.setName('image').setDescription('Lien https vers une image (grande image en bas de l’embed)'))
        .addRoleOption((o) => o.setName('mention').setDescription('Rôle à mentionner au-dessus de l’embed')),
    )
    .addSubcommand((s) =>
      s
        .setName('modifier')
        .setDescription('Modifier un embed déjà publié par le bot')
        .addStringOption((o) =>
          o.setName('lien').setDescription('Lien du message (clic droit > Copier le lien du message)').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('couleur')
            .setDescription('Nouvelle couleur (sinon inchangée)')
            .addChoices(...Object.keys(COLORS).map((name) => ({ name, value: name }))),
        )
        .addStringOption((o) => o.setName('image').setDescription('Nouvelle image (lien https), ou « aucune » pour la retirer')),
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!isDirection(interaction.member)) {
      await interaction.reply({ content: '⛔ Cette commande est réservée à la direction.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.options.getSubcommand() === 'envoyer') return startSend(interaction);
    return startEdit(interaction);
  },
};

export const embedHandler: ComponentHandler = {
  prefix: 'embed',
  async modal(interaction, _action, key) {
    await submit(interaction, key ?? '');
  },
};

/** Valide l'option image : undefined = non fournie, null = à retirer, string = URL. */
function parseImage(raw: string | null): { ok: true; value: string | null | undefined } | { ok: false } {
  if (raw === null) return { ok: true, value: undefined };
  const v = raw.trim();
  if (/^aucune$/i.test(v)) return { ok: true, value: null };
  try {
    const url = new URL(v);
    return url.protocol === 'https:' ? { ok: true, value: url.toString() } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Vérifie que le bot peut publier un embed dans ce salon. */
function botCanPost(channel: GuildTextBasedChannel): boolean {
  const me = channel.guild.members.me;
  return !!me && channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
}

function buildModal(key: string, title: string, values?: { titre?: string; contenu?: string; pied?: string }) {
  const titre = new TextInputBuilder().setCustomId('titre').setLabel('Titre (facultatif)').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(false);
  const contenu = new TextInputBuilder()
    .setCustomId('contenu')
    .setLabel('Contenu (Markdown Discord accepté)')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000)
    .setRequired(true);
  const pied = new TextInputBuilder().setCustomId('pied').setLabel('Pied de page (facultatif)').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(false);
  if (values?.titre) titre.setValue(values.titre);
  if (values?.contenu) contenu.setValue(values.contenu.slice(0, 4000));
  if (values?.pied) pied.setValue(values.pied.slice(0, 200));
  return new ModalBuilder()
    .setCustomId(`embed:saisie:${key}`)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titre),
      new ActionRowBuilder<TextInputBuilder>().addComponents(contenu),
      new ActionRowBuilder<TextInputBuilder>().addComponents(pied),
    );
}

async function startSend(interaction: ChatInputCommandInteraction<'cached'>) {
  const channel = (interaction.options.getChannel('salon', false, [ChannelType.GuildText, ChannelType.GuildAnnouncement]) ??
    interaction.channel) as GuildTextBasedChannel | null;
  if (!channel || !botCanPost(channel)) {
    await interaction.reply({ content: '❌ Je ne peux pas publier dans ce salon (voir, écrire, intégrer des liens).', flags: MessageFlags.Ephemeral });
    return;
  }
  const image = parseImage(interaction.options.getString('image'));
  if (!image.ok) {
    await interaction.reply({ content: '❌ L’image doit être un lien commençant par https://', flags: MessageFlags.Ephemeral });
    return;
  }
  const colorName = interaction.options.getString('couleur');
  const mention = interaction.options.getRole('mention');
  const key = remember({
    userId: interaction.user.id,
    channelId: channel.id,
    color: COLORS[colorName ?? 'Bleu OMC'],
    image: image.value,
    mentionRoleId: mention?.id ?? null,
  });
  await interaction.showModal(buildModal(key, 'Nouveau message embed'));
}

/** Retrouve un message à partir de son lien (ou de son ID dans le salon courant). */
async function startEdit(interaction: ChatInputCommandInteraction<'cached'>) {
  const raw = interaction.options.getString('lien', true).trim();
  const m = /channels\/(\d+)\/(\d+)\/(\d+)/.exec(raw);
  const channelId = m ? m[2]! : interaction.channelId;
  const messageId = m ? m[3]! : raw;
  if ((m && m[1] !== interaction.guildId) || !/^\d{17,20}$/.test(messageId)) {
    await interaction.reply({ content: '❌ Lien de message invalide (clic droit sur le message > Copier le lien du message).', flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  // force: true → on relit le message depuis Discord : la version en cache peut être
  // celle d'origine (message.edit() ne met pas le cache à jour), ce qui pré-remplirait
  // le formulaire avec un ancien contenu.
  const message = channel?.isTextBased()
    ? await channel.messages.fetch({ message: messageId, force: true }).catch(() => null)
    : null;
  if (!message) {
    await interaction.reply({ content: '❌ Message introuvable.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (message.author.id !== interaction.client.user.id || !message.embeds[0]) {
    await interaction.reply({ content: '❌ Je ne peux modifier que les embeds que j’ai moi-même publiés.', flags: MessageFlags.Ephemeral });
    return;
  }
  const image = parseImage(interaction.options.getString('image'));
  if (!image.ok) {
    await interaction.reply({ content: '❌ L’image doit être un lien commençant par https:// (ou « aucune »).', flags: MessageFlags.Ephemeral });
    return;
  }
  const colorName = interaction.options.getString('couleur');
  const current = message.embeds[0];
  const key = remember({
    userId: interaction.user.id,
    channelId,
    color: colorName ? COLORS[colorName] : (current.color ?? COLORS['Bleu OMC']),
    image: image.value === undefined ? (current.image?.url ?? null) : image.value,
    editMessageId: messageId,
  });
  await interaction.showModal(
    buildModal(key, 'Modifier le message embed', {
      titre: current.title ?? undefined,
      contenu: current.description ?? undefined,
      pied: current.footer?.text,
    }),
  );
}

async function submit(interaction: ModalSubmitInteraction, key: string) {
  if (!interaction.inCachedGuild()) return;
  const p = pending.get(key);
  if (!p || p.userId !== interaction.user.id || p.expires < Date.now()) {
    await interaction.reply({ content: '⌛ Ce formulaire a expiré : relance la commande /embed.', flags: MessageFlags.Ephemeral });
    return;
  }
  pending.delete(key);

  const titre = interaction.fields.getTextInputValue('titre').trim();
  const contenu = interaction.fields.getTextInputValue('contenu').trim();
  const pied = interaction.fields.getTextInputValue('pied').trim();
  const embed = new EmbedBuilder().setColor(p.color ?? COLORS['Bleu OMC']!).setDescription(contenu);
  if (titre) embed.setTitle(titre);
  if (pied) embed.setFooter({ text: pied });
  if (p.image) embed.setImage(p.image);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await interaction.guild.channels.fetch(p.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.editReply('❌ Le salon n’existe plus.');
    return;
  }

  let url: string;
  if (p.editMessageId) {
    const message = await channel.messages.fetch(p.editMessageId).catch(() => null);
    if (!message) {
      await interaction.editReply('❌ Le message a été supprimé entre-temps.');
      return;
    }
    await message.edit({ embeds: [embed] });
    url = message.url;
  } else {
    const message = await channel.send({
      content: p.mentionRoleId ? (p.mentionRoleId === interaction.guildId ? '@everyone' : `<@&${p.mentionRoleId}>`) : undefined,
      embeds: [embed],
      allowedMentions: p.mentionRoleId === interaction.guildId ? { parse: ['everyone'] } : { roles: p.mentionRoleId ? [p.mentionRoleId] : [] },
    });
    url = message.url;
  }

  await interaction.editReply(`✅ Message ${p.editMessageId ? 'modifié' : 'publié'} : ${url}`);
  await sendLog(interaction.guild, {
    title: p.editMessageId ? '✏️ Embed modifié' : '📢 Embed publié',
    description: `${url}${titre ? `\n**${titre}**` : ''}`,
    color: LogColor.neutral,
    actor: interaction.user,
  });
}
