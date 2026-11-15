/**
 * Routage des interactions : commandes slash, boutons et modals.
 * Toute erreur est rattrapée : l'utilisateur reçoit un message clair, l'erreur part dans la console.
 */
import { MessageFlags, type Interaction } from 'discord.js';
import { absencesCommand } from '../absences/command.js';
import { absencesHandler } from '../absences/handlers.js';
import { embedCommand, embedHandler } from '../annonces/embed.js';
import { configCommand } from '../config/command.js';
import { dossierCommand } from '../dossiers/command.js';
import { gradeCommand } from '../grades/command.js';
import { ticketsAdminHandler, ticketsCommand } from '../tickets/command.js';
import { ticketsHandler } from '../tickets/handlers.js';
import { gestionHandler } from '../dossiers/gestion.js';
import { logger } from '../logger.js';
import { LogColor, sendLog } from '../logs/index.js';
import { ficheCommand } from '../verification/command.js';
import { verificationHandler } from '../verification/handlers.js';
import type { Command, ComponentHandler } from './types.js';

export const commands: Command[] = [configCommand, ficheCommand, absencesCommand, embedCommand, dossierCommand, gradeCommand, ticketsCommand];
const commandMap = new Map(commands.map((c) => [c.data.name, c]));
const handlers = new Map<string, ComponentHandler>([verificationHandler, absencesHandler, embedHandler, gestionHandler, ticketsHandler, ticketsAdminHandler].map((h) => [h.prefix, h]));

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await commandMap.get(interaction.commandName)?.autocomplete?.(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await commandMap.get(interaction.commandName)?.execute(interaction);
      return;
    }
    if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
      const [prefix, action = '', arg] = interaction.customId.split(':');
      const handler = handlers.get(prefix ?? '');
      if (!handler) return;
      if (interaction.isButton()) await handler.button?.(interaction, action, arg);
      else if (interaction.isStringSelectMenu()) await handler.select?.(interaction, action, arg);
      else await handler.modal?.(interaction, action, arg);
    }
  } catch (err) {
    const label = interaction.isChatInputCommand() ? `/${interaction.commandName}` : 'customId' in interaction ? interaction.customId : interaction.type;
    logger.error(`Erreur lors du traitement de l’interaction ${label} (${interaction.user.tag})`, err);
    if (interaction.guild) {
      await sendLog(interaction.guild, {
        title: '❌ Erreur inattendue',
        description: [
          `Action : \`${String(label)}\``,
          err instanceof Error ? err.message.slice(0, 500) : 'erreur inconnue',
          'Détails dans les logs du conteneur (`docker compose logs bot`).',
        ].join('\n'),
        color: LogColor.error,
        actor: interaction.user,
        alert: true,
      }).catch(() => {});
    }
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
