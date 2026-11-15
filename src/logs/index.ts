/**
 * Module logs : écrit les actions importantes dans le salon de logs configuré
 * (et toujours dans la console du conteneur).
 */
import { EmbedBuilder, type Guild, type User } from 'discord.js';
import { channelId } from '../config/settings.js';
import { logger } from '../logger.js';

export const LogColor = {
  info: 0x3b82f6,
  success: 0x22c55e,
  warning: 0xf59e0b,
  error: 0xef4444,
  neutral: 0x6b7280,
} as const;

export interface LogEntry {
  title: string;
  description?: string;
  color?: number;
  /** Membre concerné par l'action. */
  target?: User;
  /** Auteur de l'action (si différent de la cible). */
  actor?: User;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export async function sendLog(guild: Guild, entry: LogEntry): Promise<void> {
  const who = [entry.target && `cible : ${entry.target.tag} (${entry.target.id})`, entry.actor && `par : ${entry.actor.tag}`]
    .filter(Boolean)
    .join(', ');
  logger.info(`[log] ${entry.title}${who ? ` — ${who}` : ''}${entry.description ? ` — ${entry.description.replace(/\n/g, ' ')}` : ''}`);

  const id = channelId('logs');
  if (!id) return;
  try {
    const channel = await guild.channels.fetch(id);
    if (!channel?.isSendable()) {
      logger.warn('Le salon de logs configuré est introuvable ou le bot ne peut pas y écrire.');
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(entry.title)
      .setColor(entry.color ?? LogColor.info)
      .setTimestamp(new Date());
    if (entry.description) embed.setDescription(entry.description);
    const fields = [...(entry.fields ?? [])];
    if (entry.target) fields.unshift({ name: 'Membre', value: `${entry.target} (${entry.target.id})`, inline: true });
    if (entry.actor) fields.push({ name: 'Par', value: `${entry.actor}`, inline: true });
    if (fields.length) embed.addFields(fields.slice(0, 25));
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error('Échec de l’envoi d’un log dans le salon de logs', err);
  }
}
