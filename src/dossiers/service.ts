/**
 * Dossiers du personnel.
 *
 * - Un membre reçoit le rôle « personnel » (EMS) → un post « Prénom Nom » est créé dans le forum des dossiers
 *   (ou rouvert s'il existait déjà).
 * - Il perd ce rôle → le post est archivé et verrouillé (rien n'est supprimé).
 * - Chaque événement (grade, absence, avertissement, sanction, note) est enregistré en base et publié dans le post.
 * - Le premier message du post est une fiche récapitulative, mise à jour à chaque événement.
 *
 * Si le forum a des tags nommés « Actif » et « Archivé », ils sont appliqués automatiquement.
 */
import { and, count, desc, eq, ne } from 'drizzle-orm';
import {
  ChannelType,
  EmbedBuilder,
  type ForumChannel,
  type Guild,
  type GuildMember,
  type ThreadChannel,
} from 'discord.js';
import { channelId, roleId } from '../config/settings.js';
import { db } from '../db/index.js';
import { absences, dossierEvents, dossiers, type Dossier, type DossierEventType } from '../db/schema.js';
import { formatFr, formatFrDateTime, todayParis } from '../lib/dates.js';
import { describeApiError, highestGrade } from '../lib/members.js';
import { LogColor, sendLog } from '../logs/index.js';
import { peekGradeContext, reasonSuffix } from '../grades/context.js';
import { logger } from '../logger.js';
import { displayRpName } from '../verification/fiches.js';

export const EVENT_STYLE: Record<DossierEventType, { emoji: string; label: string; color: number }> = {
  embauche: { emoji: '🩺', label: 'Embauche', color: 0x22c55e },
  reintegration: { emoji: '🔁', label: 'Réintégration', color: 0x22c55e },
  depart: { emoji: '🚪', label: 'Départ', color: 0x6b7280 },
  grade: { emoji: '🎖️', label: 'Changement de grade', color: 0x3b82f6 },
  promotion: { emoji: '⬆️', label: 'Promotion', color: 0x22c55e },
  retrogradation: { emoji: '⬇️', label: 'Rétrogradation', color: 0xf97316 },
  absence: { emoji: '📅', label: 'Absence', color: 0xeab308 },
  avertissement: { emoji: '⚠️', label: 'Avertissement', color: 0xf59e0b },
  sanction: { emoji: '⛔', label: 'Sanction', color: 0xef4444 },
  note: { emoji: '📝', label: 'Note', color: 0x8b5cf6 },
};

const ARCHIVED_PREFIX = '🗄️ ';

/**
 * Sérialise les opérations par membre : deux événements Discord rapprochés
 * (ex. grade + rôle EMS ajoutés ensemble) ne doivent pas créer deux posts.
 */
const locks = new Map<string, Promise<unknown>>();
function serialize<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(userId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(userId, next);
  void next.finally(() => {
    if (locks.get(userId) === next) locks.delete(userId);
  }).catch(() => {});
  return next;
}

export async function getDossier(userId: string): Promise<Dossier | undefined> {
  const [row] = await db.select().from(dossiers).where(eq(dossiers.userId, userId)).limit(1);
  return row;
}

/** Forum des dossiers configuré, ou null. */
async function getForum(guild: Guild): Promise<ForumChannel | null> {
  const id = channelId('dossiers');
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  return channel?.type === ChannelType.GuildForum ? channel : null;
}

function tagIds(forum: ForumChannel, archived: boolean): string[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const wanted = archived ? 'archive' : 'actif';
  const tag = forum.availableTags.find((t) => norm(t.name) === wanted);
  return tag ? [tag.id] : [];
}

/** Fiche récapitulative (premier message du post). */
async function buildSummary(guild: Guild, d: Dossier) {
  const member = await guild.members.fetch(d.userId).catch(() => null);
  const name = await displayRpName(member, d.userId);
  const rows = await db
    .select({ type: dossierEvents.type, n: count() })
    .from(dossierEvents)
    .where(eq(dossierEvents.userId, d.userId))
    .groupBy(dossierEvents.type);
  const n = (t: DossierEventType) => rows.find((r) => r.type === t)?.n ?? 0;

  return new EmbedBuilder()
    .setTitle(`📁 Dossier — ${name}`)
    .setColor(d.archived ? 0x6b7280 : 0x0ea5e9)
    .setThumbnail(member?.displayAvatarURL() ?? null)
    .addFields(
      { name: 'Membre', value: `<@${d.userId}>`, inline: true },
      { name: 'Grade', value: member ? (highestGrade(member)?.label ?? 'Aucun') : 'A quitté le serveur', inline: true },
      { name: 'Statut', value: d.archived ? '🗄️ Archivé' : '🟢 Actif', inline: true },
      { name: 'Embauché le', value: formatFr(d.hiredOn), inline: true },
      { name: 'Absences', value: String(await countAbsences(d.userId)), inline: true },
      { name: 'Avertissements', value: String(n('avertissement')), inline: true },
      { name: 'Sanctions', value: String(n('sanction')), inline: true },
      { name: 'Promotions', value: String(n('promotion')), inline: true },
      { name: 'Rétrogradations', value: String(n('retrogradation')), inline: true },
      { name: 'Notes', value: String(n('note')), inline: true },
    )
    .setFooter({ text: `Mis à jour le ${formatFrDateTime(new Date())}` });
}

async function threadName(guild: Guild, d: Dossier): Promise<string> {
  const member = await guild.members.fetch(d.userId).catch(() => null);
  const name = await displayRpName(member, d.userId);
  return `${d.archived ? ARCHIVED_PREFIX : ''}${name}`.slice(0, 100);
}

/** Récupère le post du dossier ; le recrée s'il a été supprimé. */
async function ensureThread(guild: Guild, d: Dossier): Promise<{ thread: ThreadChannel; dossier: Dossier } | null> {
  const forum = await getForum(guild);
  if (!forum) return null;
  if (d.threadId) {
    const existing = await guild.channels.fetch(d.threadId).catch(() => null);
    if (existing?.isThread()) return { thread: existing, dossier: d };
  }
  const thread = await forum.threads.create({
    name: await threadName(guild, d),
    message: { embeds: [await buildSummary(guild, d)], allowedMentions: { parse: [] } },
    appliedTags: tagIds(forum, d.archived),
  });
  const [updated] = await db.update(dossiers).set({ threadId: thread.id }).where(eq(dossiers.userId, d.userId)).returning();
  return { thread, dossier: updated! };
}

/**
 * Exécute `fn` sur le post du dossier, en le désarchivant temporairement si besoin,
 * puis remet le post dans l'état voulu (nom, tags, archivé/verrouillé).
 */
async function withThread(guild: Guild, d: Dossier, fn?: (thread: ThreadChannel) => Promise<void>): Promise<string | null> {
  try {
    const res = await ensureThread(guild, d);
    if (!res) return null;
    const { thread, dossier } = res;
    if (thread.archived) await thread.setArchived(false);
    if (fn) await fn(thread);

    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) await starter.edit({ embeds: [await buildSummary(guild, dossier)], allowedMentions: { parse: [] } });
    const name = await threadName(guild, dossier);
    if (thread.name !== name) await thread.setName(name);
    const forum = thread.parent;
    if (forum?.type === ChannelType.GuildForum) {
      const tags = tagIds(forum, dossier.archived);
      if (tags.length && tags.join() !== thread.appliedTags.join()) await thread.setAppliedTags(tags);
    }
    if (dossier.archived) {
      if (!thread.locked) await thread.setLocked(true);
      await thread.setArchived(true);
    } else if (thread.locked) {
      await thread.setLocked(false);
    }
    return thread.url;
  } catch (err) {
    logger.error(`Dossier de ${d.userId} : impossible de mettre à jour le post du forum`, err);
    await sendLog(guild, {
      title: '⚠️ Dossier non mis à jour',
      description: `Impossible d’écrire dans le forum des dossiers (${describeApiError(err, 'modifier le post')}). Vérifie les permissions du bot dans le forum : voir, envoyer des messages, écrire dans les fils, gérer les fils.`,
      color: LogColor.warning,
      target: await guild.client.users.fetch(d.userId).catch(() => undefined),
      alert: true,
    });
    return null;
  }
}

/**
 * Enregistre un événement dans le dossier (s'il existe) et le publie dans le post.
 * Retourne null si le membre n'a pas de dossier, sinon le lien du post (null si le forum n'est pas configuré).
 */
export function addDossierEvent(
  guild: Guild,
  userId: string,
  type: DossierEventType,
  details: string,
  byUserId?: string | null,
): Promise<{ url: string | null } | null> {
  return serialize(userId, () => addEventUnlocked(guild, userId, type, details, byUserId));
}

async function addEventUnlocked(
  guild: Guild,
  userId: string,
  type: DossierEventType,
  details: string,
  byUserId?: string | null,
): Promise<{ url: string | null } | null> {
  const d = await getDossier(userId);
  if (!d) return null;
  const [event] = await db.insert(dossierEvents).values({ userId, type, details, byUserId: byUserId ?? null }).returning();
  const style = EVENT_STYLE[type];
  const embed = new EmbedBuilder()
    .setTitle(`${style.emoji} ${style.label}`)
    .setColor(style.color)
    .setDescription(details.slice(0, 4000))
    .setFooter({ text: `N°${event!.id} • ${formatFrDateTime(event!.createdAt)}` });
  if (byUserId) embed.addFields({ name: 'Par', value: `<@${byUserId}>`, inline: true });
  const url = await withThread(guild, d, async (t) => {
    await t.send({ embeds: [embed], allowedMentions: { parse: [] } });
  });
  return { url };
}

/**
 * Met le dossier en accord avec le rôle « personnel » (EMS) :
 * rôle présent → dossier créé ou rouvert ; rôle absent → dossier archivé.
 */
export function reconcileDossier(member: GuildMember): Promise<'cree' | 'rouvert' | 'archive' | null> {
  return serialize(member.id, () => reconcileUnlocked(member));
}

async function reconcileUnlocked(member: GuildMember): Promise<'cree' | 'rouvert' | 'archive' | null> {
  const personnel = roleId('personnel');
  if (!personnel) return null;
  const hasRole = member.roles.cache.has(personnel);
  const d = await getDossier(member.id);
  const grade = highestGrade(member)?.label ?? 'aucun';
  // Changement fait via /grade : on inscrit l'auteur et le motif.
  const ctx = peekGradeContext(member.id);
  const by = ctx?.byUserId ?? null;

  if (hasRole && !d) {
    await db.insert(dossiers).values({ userId: member.id, hiredOn: todayParis() }).onConflictDoNothing();
    await addEventUnlocked(member.guild, member.id, 'embauche', `Arrivée dans le personnel — grade : **${grade}**.${reasonSuffix(ctx)}`, by);
    return 'cree';
  }
  if (hasRole && d?.archived) {
    await db.update(dossiers).set({ archived: false, archivedAt: null }).where(eq(dossiers.userId, member.id));
    await addEventUnlocked(member.guild, member.id, 'reintegration', `Retour dans le personnel — grade : **${grade}**.${reasonSuffix(ctx)}`, by);
    return 'rouvert';
  }
  if (!hasRole && d && !d.archived) {
    await db.update(dossiers).set({ archived: true, archivedAt: new Date() }).where(eq(dossiers.userId, member.id));
    await addEventUnlocked(member.guild, member.id, 'depart', `Rôle du personnel retiré : dossier archivé.${reasonSuffix(ctx)}`, by);
    return 'archive';
  }
  return null;
}

/** Le membre a quitté le serveur : son dossier actif est archivé. */
export function archiveOnLeave(guild: Guild, userId: string): Promise<boolean> {
  return serialize(userId, async () => {
    const d = await getDossier(userId);
    if (!d || d.archived) return false;
    await db.update(dossiers).set({ archived: true, archivedAt: new Date() }).where(eq(dossiers.userId, userId));
    await addEventUnlocked(guild, userId, 'depart', 'A quitté le serveur Discord : dossier archivé.');
    return true;
  });
}

/** Rafraîchit la fiche récapitulative et le nom du post (après un changement de nom RP, par exemple). */
export function refreshDossier(guild: Guild, userId: string): Promise<void> {
  return serialize(userId, async () => {
    const d = await getDossier(userId);
    if (d) await withThread(guild, d);
  });
}

/** Derniers événements d'un dossier (plus récents d'abord). */
export async function recentEvents(userId: string, limit = 10) {
  return db.select().from(dossierEvents).where(eq(dossierEvents.userId, userId)).orderBy(desc(dossierEvents.id)).limit(limit);
}

/** Nombre d'absences déclarées (hors annulées). */
export async function countAbsences(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(absences)
    .where(and(eq(absences.userId, userId), ne(absences.status, 'annulee')));
  return row?.n ?? 0;
}

export async function countEvents(userId: string, type: DossierEventType): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(dossierEvents)
    .where(and(eq(dossierEvents.userId, userId), eq(dossierEvents.type, type)));
  return row?.n ?? 0;
}

/** Lien du post du dossier (sans le modifier). */
export function dossierUrl(guild: Guild, d: Dossier): string | null {
  return d.threadId ? `https://discord.com/channels/${guild.id}/${d.threadId}` : null;
}
