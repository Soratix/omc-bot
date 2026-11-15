import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { MAX_RP_NAME_LENGTH } from '../lib/names.js';

/** Message fixe du salon #vérification. */
export function verificationPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🏥 Bienvenue à l’Ocean Medical Center')
    .setColor(0x0ea5e9)
    .setDescription(
      [
        'Pour accéder au serveur, crée ta fiche avec **le nom de ton personnage RP** (FiveM).',
        '',
        '• Clique sur **Créer ma fiche** ci-dessous.',
        '• Indique ton **prénom** et ton **nom RP**.',
        `• Lettres, espaces, tirets et apostrophes uniquement, ${MAX_RP_NAME_LENGTH} caractères maximum au total.`,
        '',
        'Ton pseudo sera automatiquement mis à jour avec ton nom RP.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('verif:creer').setLabel('Créer ma fiche').setEmoji('📝').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}
