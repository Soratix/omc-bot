/**
 * Messages fixes (« panneaux ») publiés par le bot : #vérification, #absences…
 * Le bot mémorise l'ID du message : republier modifie le message existant au lieu d'en créer un nouveau.
 */
import type { Guild, MessageCreateOptions } from 'discord.js';
import { panelSettingKey } from '../config/keys.js';
import { channelId, getSetting, setSetting } from '../config/settings.js';

export type PanelResult = { ok: true; url: string; created: boolean } | { ok: false; error: string };

export async function publishPanel(
  guild: Guild,
  panel: string,
  channelKey: string,
  payload: Pick<MessageCreateOptions, 'embeds' | 'components'>,
  by: string,
): Promise<PanelResult> {
  const targetId = channelId(channelKey);
  if (!targetId) return { ok: false, error: `Le salon « ${channelKey} » n’est pas configuré (/config salon).` };

  const channel = await guild.channels.fetch(targetId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    return { ok: false, error: `Le salon configuré pour « ${channelKey} » est introuvable ou le bot ne peut pas y écrire.` };
  }

  // Tente de modifier le panneau existant s'il est toujours dans ce salon.
  const stored = getSetting(panelSettingKey(panel));
  if (stored) {
    const [storedChannel, storedMessage] = stored.split(':');
    if (storedChannel === channel.id && storedMessage) {
      const existing = await channel.messages.fetch(storedMessage).catch(() => null);
      if (existing) {
        await existing.edit(payload);
        return { ok: true, url: existing.url, created: false };
      }
    }
  }

  const message = await channel.send(payload);
  await setSetting(panelSettingKey(panel), `${channel.id}:${message.id}`, by);
  return { ok: true, url: message.url, created: true };
}
