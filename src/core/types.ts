import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  StringSelectMenuInteraction,
} from 'discord.js';

/** Commande slash. */
export interface Command {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** Suggestions dynamiques pour les options en autocomplétion. */
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/**
 * Gestionnaire de composants (boutons, modals).
 * Les customId suivent le format « module:action[:argument] » ; `prefix` = « module ».
 */
export interface ComponentHandler {
  prefix: string;
  button?(interaction: ButtonInteraction, action: string, arg: string | undefined): Promise<void>;
  select?(interaction: StringSelectMenuInteraction, action: string, arg: string | undefined): Promise<void>;
  modal?(interaction: ModalSubmitInteraction, action: string, arg: string | undefined): Promise<void>;
}
