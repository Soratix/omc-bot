/**
 * Routage des interactions : commandes slash, boutons et modals.
 * Toute erreur est rattrapée : l'utilisateur reçoit un message clair, l'erreur part dans la console.
 */
import { MessageFlags, type Interaction } from 'discord.js';
import { absencesCommand } from '../absences/command.js';
import { absencesHandler } from '../absences/handlers.js';
import { configCommand } from '../config/command.js';
import { logger } from '../logger.js';
import { ficheCommand } from '../verification/command.js';
import { verificationHandler } from '../verification/handlers.js';
import type { Command, ComponentHandler } from './types.js';

export const commands: Command[] = [configCommand, ficheCommand, absencesCommand];
const commandMap = new Map(commands.map((c) => [c.data.name, c]));
const handlers = new Map<string, ComponentHandler>([verificationHandler, absencesHandler].map((h) => [h.prefix, h]));

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await commandMap.get(interaction.commandName)?.execute(interaction);
      return;
    }
    if (interaction.isButton() || interaction.isModalSubmit()) {
      const [prefix, action = '', arg] = interaction.customId.split(':');
      const handler = handlers.get(prefix ?? '');
      if (!handler) return;
      if (interaction.isButton()) await handler.button?.(interaction, action, arg);
      else await handler.modal?.(interaction, action, arg);
    }
  } catch (err) {
    const label = interaction.isChatInputCommand() ? `/${interaction.commandName}` : 'customId' in interaction ? interaction.customId : interaction.type;
    logger.error(`Erreur lors du traitement de l’interaction ${label} (${interaction.user.tag})`, err);
    if (!interaction.isRepliable()) return;
    const content = '❌ Une erreur inattendue est survenue. La direction peut consulter les logs du bot.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch {
      /* interaction expirée : rien à faire */
    }
  }
}
