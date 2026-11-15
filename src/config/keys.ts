/**
 * Clés de configuration : rôles techniques et salons réglables via /config.
 * Les grades (rôle + préfixe) sont gérés à part : voir config/grades.ts et /config grade.
 */

/** Rôles techniques configurables. */
export const ROLE_KEYS: Record<string, string> = {
  citoyen: 'Citoyen',
  non_verifie: 'Non vérifié',
  absent: 'Absent',
  personnel: 'Personnel (ex. EMS, donné avec tout grade)',
  direction: 'Direction (donné avec les grades « direction »)',
};

/** Salons configurables. */
export const CHANNEL_KEYS: Record<string, string> = {
  verification: '#vérification (message « Créer ma fiche »)',
  absences: '#absences (déclaration et fiches d’absence)',
  logs: 'Salon de logs du bot',
  staff: 'Salon staff (alertes absences, MP fermés)',
  dossiers: 'Forum des dossiers du personnel (direction)',
  gestion: '#gestion-secrétaire (avertissements et sanctions)',
};

/** Salons qui doivent être des forums (les autres sont des salons textuels). */
export const FORUM_CHANNEL_KEYS = new Set(['dossiers']);

/**
 * Rôles automatiques supplémentaires (/config auto), par déclencheur :
 *  - arrivee   : donnés à l'arrivée sur le serveur ;
 *  - personnel : donnés avec le rôle EMS (au moins un grade), retirés sinon ;
 *  - direction : donnés avec un grade « direction », retirés sinon.
 */
export const AUTO_TRIGGERS: Record<string, string> = {
  arrivee: 'Arrivée sur le serveur',
  personnel: 'Personnel (EMS)',
  direction: 'Direction',
};
export type AutoTrigger = 'arrivee' | 'personnel' | 'direction';
export const autoRoleSettingKey = (trigger: string, roleId: string) => `auto_${trigger}_${roleId}`;

export const roleSettingKey = (key: string) => `role_${key}`;
export const channelSettingKey = (key: string) => `channel_${key}`;
export const panelSettingKey = (panel: string) => `panel_${panel}`;
