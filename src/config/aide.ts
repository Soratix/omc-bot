/**
 * /aide — liste les commandes et actions disponibles pour la personne qui la lance, selon ses droits.
 */
import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../core/types.js';
import { highestGrade, isAdmin, isDirection, isStaff } from '../lib/members.js';
import { channelId } from './settings.js';

const ch = (key: string, fallback: string) => {
  const id = channelId(key);
  return id ? `<#${id}>` : fallback;
};

export const aideCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('aide')
    .setDescription('Ce que tu peux faire avec le bot')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const m = interaction.member;
    const staff = isStaff(m);
    const direction = isDirection(m);
    const admin = isAdmin(m);
    const level = admin ? 'Administrateur' : direction ? 'Direction' : staff ? `Personnel (${highestGrade(m)?.label})` : 'Membre';

    const embed = new EmbedBuilder()
      .setTitle('📖 Aide — bot de l’Ocean Medical Center')
      .setColor(0x0ea5e9)
      .setDescription(`Ton niveau d’accès : **${level}**`)
      .addFields({
        name: '👤 Tout le monde',
        value: [
          `• **Créer ma fiche** dans ${ch('verification', '#vérification')} : ton nom RP devient ton pseudo.`,
          `• **Ouvrir un ticket** dans ${ch('tickets', '#ouvrir-un-ticket')} (un par type à la fois). Tu peux le fermer toi-même ; tu reçois une copie de la conversation en MP.`,
          '• `/aide` : cette page.',
        ].join('\n'),
      });

    if (staff || direction) {
      embed.addFields({
        name: '🩺 Personnel',
        value: [
          `• **Déclarer une absence** dans ${ch('absences', '#absences')}, puis **Je suis revenu** / **Prolonger** / **Annuler** sur ta fiche.`,
          '• Le jour de ta date de fin, le bot te demande en MP si tu es revenu.',
          '• `/absences liste` : absences en cours et à venir.',
          '• Tickets dont ton rôle a l’accès : **Prendre en charge**, **Fermer**, `/tickets ajouter` / `retirer` un membre.',
        ].join('\n'),
      });
    }

    if (direction) {
      embed.addFields({
        name: '👑 Direction',
        value: [
          '• `/grade attribuer` / `retirer` : embauche, promotion, rétrogradation, départ (grades inférieurs au tien uniquement).',
          '• `/fiche voir` / `modifier` / `resynchroniser` : noms RP et pseudos.',
          '• `/dossier voir` / `note` / `synchroniser` : dossiers du personnel.',
          `• **Avertissement** / **Sanction** dans ${ch('gestion', '#gestion-secrétaire')}.`,
          '• `/embed envoyer` / `modifier` : messages embed.',
          '• `/tickets type-creer` / `type-modifier` / `type-acces` / `type-retirer` / `types` / `stats`.',
          '• `/absences nettoyer`, et les boutons de toutes les fiches d’absence.',
        ].join('\n'),
      });
    }

    if (admin) {
      embed.addFields({
        name: '🛠️ Administrateurs',
        value: [
          '• `/setup` : liste de contrôle de la configuration.',
          '• `/config` : grades, rôles, rôles automatiques, salons, messages fixes, `/config voir`.',
        ].join('\n'),
      });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};
