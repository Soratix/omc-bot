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
};

/** Salons configurables. */
export const CHANNEL_KEYS: Record<string, string> = {
  verification: '#vérification (message « Créer ma fiche »)',
  absences: '#absences (déclaration et fiches d’absence)',
  logs: 'Salon de logs du bot',
  staff: 'Salon staff (alertes absences, MP fermés)',
};

export const roleSettingKey = (key: string) => `role_${key}`;
export const channelSettingKey = (key: string) => `channel_${key}`;
export const panelSettingKey = (panel: string) => `panel_${panel}`;
