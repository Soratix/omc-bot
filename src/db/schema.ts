/**
 * Schéma de la base de données (Drizzle ORM).
 * Après toute modification : `npm run db:generate` pour créer la migration SQL versionnée.
 */
import { boolean, date, index, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/** Paramètres configurables (IDs de salons, de rôles, de messages fixes). Clé → valeur. */
export const settings = pgTable('settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: varchar('value', { length: 64 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: varchar('updated_by', { length: 32 }),
});

/**
 * Grades de l'hôpital : un rôle Discord + un préfixe de pseudo.
 * Le grade affiché est celui dont le rôle est le plus haut dans la hiérarchie Discord.
 * `direction` : les membres de ce grade ont accès aux commandes de direction.
 */
export const grades = pgTable('grades', {
  roleId: varchar('role_id', { length: 32 }).primaryKey(),
  prefix: varchar('prefix', { length: 16 }).notNull(),
  direction: boolean('direction').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Fiche RP d'un membre (créée à la vérification). */
export const fiches = pgTable('fiches', {
  userId: varchar('user_id', { length: 32 }).primaryKey(),
  prenom: varchar('prenom', { length: 32 }).notNull(),
  nom: varchar('nom', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: varchar('updated_by', { length: 32 }),
});

export const absenceStatus = pgEnum('absence_status', [
  'en_cours', // 🟡 (ou « à venir » si la date de début n'est pas atteinte)
  'non_confirmee', // 🔴 rappel envoyé, pas de réponse
  'terminee', // 🟢
  'annulee', // ⚫
]);

export const absences = pgTable(
  'absences',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id', { length: 32 }).notNull(),
    /** Dates au format AAAA-MM-JJ (jour calendaire, heure de Paris). */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    reason: text('reason'),
    status: absenceStatus('status').notNull().default('en_cours'),
    channelId: varchar('channel_id', { length: 32 }),
    messageId: varchar('message_id', { length: 32 }),
    /** Jour où le rappel de fin a été envoyé. */
    remindedOn: date('reminded_on', { mode: 'string' }),
    /** Nombre de prolongations. */
    extensions: integer('extensions').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: varchar('closed_by', { length: 32 }),
  },
  (t) => [index('absences_user_idx').on(t.userId), index('absences_status_idx').on(t.status)],
);

/** Dossier du personnel : un post dans le forum « Dossiers », créé quand un membre reçoit le rôle EMS. */
export const dossiers = pgTable('dossiers', {
  userId: varchar('user_id', { length: 32 }).primaryKey(),
  /** ID du post (fil) dans le forum. */
  threadId: varchar('thread_id', { length: 32 }),
  archived: boolean('archived').notNull().default(false),
  /** Date de la première embauche (AAAA-MM-JJ). */
  hiredOn: date('hired_on', { mode: 'string' }).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dossierEventType = pgEnum('dossier_event_type', [
  'embauche',
  'depart',
  'reintegration',
  'grade', // ancien type (avant la distinction promotion / rétrogradation)
  'promotion',
  'retrogradation',
  'absence',
  'avertissement',
  'sanction',
  'note',
]);

/** Historique d'un dossier (tout ce qui est écrit dans le post du forum). */
export const dossierEvents = pgTable(
  'dossier_events',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id', { length: 32 }).notNull(),
    type: dossierEventType('type').notNull(),
    details: text('details').notNull(),
    byUserId: varchar('by_user_id', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dossier_events_user_idx').on(t.userId)],
);

export type Dossier = typeof dossiers.$inferSelect;
export type DossierEventType = (typeof dossierEventType.enumValues)[number];
export type GradeRow =typeof grades.$inferSelect;
export type Fiche =typeof fiches.$inferSelect;
export type Absence = typeof absences.$inferSelect;
export type AbsenceStatus = (typeof absenceStatus.enumValues)[number];
