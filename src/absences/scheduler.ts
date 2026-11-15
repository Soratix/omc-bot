/**
 * Tâche planifiée des absences (heure de Paris).
 *
 *  - Chaque jour à ABSENCE_CHECK_HOUR (9 h par défaut) :
 *      • rôle Absent ajouté aux absences qui commencent, fiches mises à jour ;
 *      • rappel en MP le jour de la date de fin (ou dans le salon staff si les MP sont fermés) ;
 *      • sans réponse après ABSENCE_CONFIRM_DAYS jours → 🔴 « Retour non confirmé » + alerte direction.
 *  - Chaque jour à 00:05 : uniquement le rôle Absent et les fiches (absences qui commencent ce jour-là).
 *  - Au démarrage : rattrapage (rappels inclus si l'heure de la tâche est déjà passée).
 *
 * Toutes les étapes sont idempotentes : relancer la tâche n'envoie pas de doublons.
 */
import { Cron } from 'croner';
import { EmbedBuilder, type Client, type Guild } from 'discord.js';
import { allGrades } from '../config/grades.js';
import { channelId } from '../config/settings.js';
import type { Absence } from '../db/schema.js';
import { env } from '../env.js';
import { TIMEZONE, daysBetween, formatFr, todayParis } from '../lib/dates.js';
import { logger } from '../logger.js';
import { LogColor, sendLog } from '../logs/index.js';
import { addDossierEvent } from '../dossiers/service.js';
import { displayRpName } from '../verification/fiches.js';
import { refreshAbsencesPanel } from './panel.js';
import { absenceButtons, refreshAbsenceMessage } from './render.js';
import { listActive, updateAbsence } from './repo.js';
import { syncAbsentRole } from './service.js';

let running = false;

export function startAbsenceScheduler(client: Client<true>): Cron[] {
  const jobs = [
    new Cron(`0 ${env.ABSENCE_CHECK_HOUR} * * *`, { timezone: TIMEZONE, protect: true }, () => runDailyCheck(client, true)),
    new Cron('5 0 * * *', { timezone: TIMEZONE, protect: true }, () => runDailyCheck(client, false)),
  ];
  const hour = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  void runDailyCheck(client, hour >= env.ABSENCE_CHECK_HOUR);
  logger.info(`Tâche des absences planifiée : tous les jours à ${env.ABSENCE_CHECK_HOUR} h (heure de Paris).`);
  return jobs;
}

export async function runDailyCheck(client: Client<true>, withReminders: boolean): Promise<void> {
  if (running) return;
  running = true;
  try {
    const guild = client.guilds.cache.get(env.GUILD_ID);
    if (!guild) {
      logger.warn('Tâche des absences : serveur introuvable.');
      return;
    }
    const today = todayParis();
    const active = await listActive();
    for (let absence of active) {
      try {
        const member = await guild.members.fetch(absence.userId).catch(() => null);
        if (member) await syncAbsentRole(member, 'Tâche quotidienne des absences');

        if (withReminders && member) {
          if (absence.status === 'en_cours' && absence.endDate <= today && !absence.remindedOn) {
            await sendReminder(guild, absence);
            absence = await updateAbsence(absence.id, { remindedOn: today });
          } else if (
            absence.status === 'en_cours' &&
            absence.remindedOn &&
            daysBetween(absence.remindedOn, today) >= env.ABSENCE_CONFIRM_DAYS
          ) {
            absence = await updateAbsence(absence.id, { status: 'non_confirmee' });
            await alertDirection(guild, absence);
          }
        }
        await refreshAbsenceMessage(guild, absence);
      } catch (err) {
        logger.error(`Tâche des absences : erreur sur l’absence n°${absence.id}`, err);
      }
    }
    await refreshAbsencesPanel(guild);
    logger.info(`Tâche des absences terminée (${active.length} absence(s) active(s), rappels : ${withReminders ? 'oui' : 'non'}).`);
  } catch (err) {
    logger.error('Tâche des absences : échec', err);
  } finally {
    running = false;
  }
}

/** Rappel de fin d'absence : MP, ou mention dans le salon staff si les MP sont fermés. */
async function sendReminder(guild: Guild, a: Absence): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('⏰ Ton absence se termine')
    .setColor(0xeab308)
    .setDescription(
      `Ton absence à l’Ocean Medical Center (du **${formatFr(a.startDate)}** au **${formatFr(a.endDate)}**) se termine aujourd’hui.\n\n**Es-tu de retour ?**`,
    )
    .setFooter({ text: `Absence n°${a.id}` });
  const payload = { embeds: [embed], components: [absenceButtons(a, { cancel: false })] };

  const user = await guild.client.users.fetch(a.userId);
  try {
    await user.send(payload);
    await sendLog(guild, { title: '⏰ Rappel de fin d’absence envoyé (MP)', color: LogColor.info, target: user });
    return;
  } catch {
    // MP fermés : on passe par le salon staff.
  }
  const staffId = channelId('staff');
  const staff = staffId ? await guild.channels.fetch(staffId).catch(() => null) : null;
  if (staff?.isSendable()) {
    await staff.send({
      content: `${user} — tes messages privés sont fermés, voici le rappel de fin d’absence :`,
      ...payload,
      allowedMentions: { users: [user.id] },
    });
    await sendLog(guild, { title: '⏰ Rappel de fin d’absence (MP fermés → salon staff)', color: LogColor.warning, target: user });
  } else {
    await sendLog(guild, {
      title: '⚠️ Rappel de fin d’absence impossible',
      alert: true,
      description: 'MP fermés et salon staff non configuré.',
      color: LogColor.error,
      target: user,
    });
  }
}

async function alertDirection(guild: Guild, a: Absence): Promise<void> {
  const name = await displayRpName(null, a.userId);
  // Mentionne tous les grades marqués « direction ».
  const directionRoles = allGrades()
    .filter((g) => g.direction && guild.roles.cache.has(g.roleId))
    .map((g) => g.roleId);
  const text = `🔴 **Retour non confirmé** : <@${a.userId}> (**${name}**) devait revenir le **${formatFr(a.endDate)}** et n’a pas répondu au rappel depuis ${env.ABSENCE_CONFIRM_DAYS} jour(s).`;
  const staffId = channelId('staff');
  const staff = staffId ? await guild.channels.fetch(staffId).catch(() => null) : null;
  if (staff?.isSendable()) {
    await staff.send({
      content: `${directionRoles.map((id) => `<@&${id}>`).join(' ')} ${text}`.trim(),
      allowedMentions: { roles: directionRoles },
    });
  }
  await addDossierEvent(guild, a.userId, 'absence', `🔴 Retour non confirmé : fin d’absence prévue le **${formatFr(a.endDate)}**, pas de réponse au rappel.`);
  await sendLog(guild, {
    title: '🔴 Retour d’absence non confirmé',
    description: text,
    color: LogColor.error,
    target: await guild.client.users.fetch(a.userId),
  });
}
