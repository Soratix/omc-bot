import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

/** Message fixe du salon #absences. */
export function absencesPanel() {
  const embed = new EmbedBuilder()
    .setTitle('📅 Déclarer une absence')
    .setColor(0xeab308)
    .setDescription(
      [
        'Tu vas être absent ? Préviens l’équipe en cliquant sur **Déclarer une absence**.',
        '',
        '• Dates au format **JJ/MM/AAAA**.',
        '• Le rôle **Absent** t’est attribué pendant ton absence.',
        '• Le jour de ta date de fin, je t’envoie un message pour confirmer ton retour.',
        '',
        '_Réservé au personnel de l’hôpital._',
      ].join('\n'),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('abs:declarer').setLabel('Déclarer une absence').setEmoji('📅').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}
