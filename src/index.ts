/**
 * Point d'entrée du bot de l'Ocean Medical Center.
 */
import { Client, Events, GatewayIntentBits, OAuth2Scopes, PermissionFlagsBits } from 'discord.js';
import type { Cron } from 'croner';
import { startAbsenceScheduler } from './absences/scheduler.js';
import { loadSettings } from './config/settings.js';
import { commands, handleInteraction } from './core/interactions.js';
import { closeDatabase, initDatabase } from './db/index.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { onMemberJoin, onMemberUpdate } from './verification/events.js';

/** Permissions minimales demandées à l'invitation (phase 1). */
export const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageRoles,
];

const client = new Client({
  // GuildMembers est un intent privilégié : à activer dans le Developer Portal.
  // Pas de MessageContent : tout passe par boutons, modals et commandes slash.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

let jobs: Cron[] = [];

client.once(Events.ClientReady, async (c) => {
  logger.info(`Connecté en tant que ${c.user.tag}.`);
  const guild = c.guilds.cache.get(env.GUILD_ID);
  if (!guild) {
    const invite = c.generateInvite({ scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: BOT_PERMISSIONS });
    logger.error(`Le bot n’est pas sur le serveur ${env.GUILD_ID}. Lien d’invitation : ${invite}`);
    return;
  }
  // Commandes enregistrées sur le serveur uniquement (disponibles immédiatement).
  await guild.commands.set(commands.map((cmd) => cmd.data.toJSON()));
  logger.info(`${commands.length} commandes slash enregistrées sur « ${guild.name} ».`);
  // Met tous les membres en cache pour suivre de façon fiable les changements de rôles.
  await guild.members.fetch();
  jobs = startAbsenceScheduler(c);
});

client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction));
client.on(Events.GuildMemberAdd, (member) => void onMemberJoin(member).catch((err) => logger.error('guildMemberAdd', err)));
client.on(Events.GuildMemberUpdate, (oldM, newM) => void onMemberUpdate(oldM, newM).catch((err) => logger.error('guildMemberUpdate', err)));
client.on(Events.Error, (err) => logger.error('Erreur du client Discord', err));
client.on(Events.Warn, (msg) => logger.warn(msg));

process.on('unhandledRejection', (err) => logger.error('Promesse rejetée non gérée', err));

async function shutdown(signal: string) {
  logger.info(`${signal} reçu, arrêt du bot…`);
  for (const job of jobs) job.stop();
  await client.destroy();
  await closeDatabase();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await initDatabase();
await loadSettings();
try {
  await client.login(env.DISCORD_TOKEN);
} catch (err) {
  const code = (err as { code?: string }).code;
  if (code === 'TokenInvalid') logger.error('Token Discord invalide : vérifie DISCORD_TOKEN dans le fichier .env.');
  else if (code === 'DisallowedIntents') {
    logger.error('Intent « Server Members » non activé : Developer Portal > Bot > Privileged Gateway Intents > SERVER MEMBERS INTENT.');
  } else logger.error('Connexion à Discord impossible', err);
  await closeDatabase();
  process.exit(1);
}
