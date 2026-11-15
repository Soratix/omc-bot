/**
 * Salon de ticket supprimé à la main : le ticket est fermé en base et logué (sans transcript).
 */
import type { Channel } from 'discord.js';
import { finalizeClose } from './handlers.js';
import { getTicketByChannel, getType } from './repo.js';

export async function onChannelDelete(channel: Channel): Promise<void> {
  if (channel.isDMBased()) return;
  const ticket = await getTicketByChannel(channel.id);
  if (!ticket || ticket.status !== 'ouvert') return;
  const type = await getType(ticket.typeId);
  if (!type) return;
  await finalizeClose(channel.guild, ticket, type, null, 'Salon supprimé manuellement (pas de transcript).', false);
}
