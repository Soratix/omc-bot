/**
 * Bouton « Créer ma fiche » et formulaire (modal) de vérification.
 */
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { roleId } from '../config/settings.js';
import type { ComponentHandler } from '../core/types.js';
import { safeAddRole, safeRemoveRole } from '../lib/members.js';
import { validateRpName } from '../lib/names.js';
import { LogColor, sendLog } from '../logs/index.js';
import { refreshDossier } from '../dossiers/service.js';
import { getFiche, saveFiche, syncNickname } from './fiches.js';

export const verificationHandler: ComponentHandler = {
  prefix: 'verif',
  async button(interaction, action) {
    if (action === 'creer') await openForm(interaction);
  },
  async modal(interaction, action) {
    if (action === 'fiche') await submitForm(interaction);
  },
};

async function openForm(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const member = interaction.member;
  const fiche = await getFiche(member.id);
  const nonVerifie = roleId('non_verifie');
  const stillUnverified = !!nonVerifie && member.roles.cache.has(nonVerifie);

  if (fiche && !stillUnverified) {
    await interaction.reply({
      content: `Tu as déjà une fiche : **${fiche.prenom} ${fiche.nom}**.\nPour la modifier, contacte la direction.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prenom = new TextInputBuilder()
    .setCustomId('prenom')
    .setLabel('Prénom RP')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex. : Jean-Marc')
    .setMinLength(2)
    .setMaxLength(22)
    .setRequired(true);
  const nom = new TextInputBuilder()
    .setCustomId('nom')
    .setLabel('Nom RP')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex. : Dupont')
    .setMinLength(2)
    .setMaxLength(22)
    .setRequired(true);
  // Membre revenu sur le serveur : on pré-remplit avec son ancienne fiche.
  if (fiche) {
    prenom.setValue(fiche.prenom);
    nom.setValue(fiche.nom);
  }

  const modal = new ModalBuilder()
    .setCustomId('verif:fiche')
    .setTitle('Ma fiche — Ocean Medical Center')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(prenom),
      new ActionRowBuilder<TextInputBuilder>().addComponents(nom),
    );
  await interaction.showModal(modal);
}

async function submitForm(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const member = interaction.member;
  const result = validateRpName(interaction.fields.getTextInputValue('prenom'), interaction.fields.getTextInputValue('nom'));
  if (!result.ok) {
    await interaction.reply({
      content: `❌ ${result.error}\nClique à nouveau sur **Créer ma fiche** pour corriger.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await saveFiche(member.id, result.prenom, result.nom, member.id);

  const reason = 'Vérification : création de la fiche RP';
  const errors = [
    await safeAddRole(member, 'citoyen', reason),
    await safeRemoveRole(member, 'non_verifie', reason),
  ].filter((e): e is string => !!e);
  // Les rôles en échec demandent toujours une action ; le pseudo aussi, sauf pour le propriétaire (impossible à renommer).
  const needsAction = errors.length > 0;
  const nick = await syncNickname(member, reason);
  if (nick.changed && nick.error) errors.push(nick.error);
  const alert = needsAction || (nick.changed && !!nick.error && member.id !== member.guild.ownerId);
  // Si le membre avait déjà un dossier (rôle EMS donné avant la fiche), on le renomme avec le nom RP.
  await refreshDossier(interaction.guild, member.id);

  if (errors.length) {
    await interaction.editReply(
      `⚠️ Ta fiche **${result.full}** est enregistrée, mais je n’ai pas pu tout faire :\n• ${errors.join('\n• ')}\nLa direction a été prévenue.`,
    );
  } else {
    await interaction.editReply(`✅ Bienvenue **${result.full}** ! Ta fiche est enregistrée et tu as maintenant accès au serveur.`);
  }

  await sendLog(interaction.guild, {
    title: errors.length ? '⚠️ Vérification incomplète' : '✅ Membre vérifié',
    alert,
    color: errors.length ? LogColor.warning : LogColor.success,
    target: member.user,
    fields: [
      { name: 'Nom RP', value: result.full, inline: true },
      ...(errors.length ? [{ name: 'Problèmes', value: errors.join('\n').slice(0, 1024) }] : []),
    ],
  });
}
