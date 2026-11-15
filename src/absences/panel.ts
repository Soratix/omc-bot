/**
 * Message fixe du salon #absences : bouton « Déclarer une absence »
 * + liste des membres actuellement absents et des absences à venir, tenue à jour automatiquement.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild } from 'discord.js';
import { panelSettingKey } from '../config/keys.js';
import { getSetting } from '../config/settings.js';
import { formatFr, formatFrDateTime, todayParis } from '../lib/dates.js';
import { logger } from '../logger.js';
import { displayRpName } from '../verification/fiches.js';
import { listActive } from './repo.js';

/** Construit une liste qui tient dans un champ d'embed (1024 caractères). */
function fitLines(lines: string[], empty: string): string {
  if (!lines.length) return empty;
  const out: string[] = [];
  let length = 0;
  for (const [i, line] of lines.entries()) {
    const rest = lines.length - i;
    if (length + line.length + 1 > 990) {
      out.push(`… et ${rest} autre(s) (\`/absences liste\`)`);
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join('\n');
}

export async function absencesPanel(guild: Guild) {
  const today = todayParis();
  const active = await listActive();
  const current: string[] = [];
  const upcoming: string[] = [];
  for (const a of active) {
    const name = await displayRpName(guild.members.cache.get(a.userId) ?? null, a.userId);
    if (a.startDate > today) {
      upcoming.push(`**${name}** → du ${formatFr(a.startDate)} au ${formatFr(a.endDate)}`);
    } else {
      const flag = a.status === 'non_confirmee' ? ' 🔴 _retour non confirmé_' : '';
      current.push(`**${name}** → jusqu’au ${formatFr(a.endDate)}${flag}`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📅 Absences du personnel')
    .setColor(0xeab308)
    .setDescription(
      [
        'Tu vas être absent ? Préviens l’équipe en cliquant sur **Déclarer une absence**.',
        '• Dates au format **JJ/MM/AAAA** · rôle **Absent** pendant l’absence.',
        '• Le jour de ta date de fin, je t’envoie un message pour confirmer ton retour.',
        '_Réservé au personnel de l’hôpital._',
      ].join('\n'),
    )
    .addFields(
      { name: `🟡 Actuellement absent (${current.length})`, value: fitLines(current, '_Personne_') },
      { name: `🔵 À venir (${upcoming.length})`, value: fitLines(upcoming, '_Aucune absence prévue_') },
    )
    .setFooter({ text: `Mis à jour le ${formatFrDateTime(new Date())}` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('abs:declarer').setLabel('Déclarer une absence').setEmoji('📅').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

/** Met à jour le message fixe de #absences s'il a été publié (/config publier). */
export async function refreshAbsencesPanel(guild: Guild): Promise<void> {
  const stored = getSetting(panelSettingKey('absences'));
  if (!stored) return;
  const [channelId, messageId] = stored.split(':');
  if (!channelId || !messageId) return;
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) await message.edit({ ...(await absencesPanel(guild)), allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error('Impossible de mettre à jour le message fixe des absences', err);
  }
}
