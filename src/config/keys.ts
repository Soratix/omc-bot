/**
 * Clés de configuration : rôles et salons réglables via /config.
 * Les grades sont listés du plus haut au plus bas ; l'ordre détermine le préfixe affiché.
 */

export interface Grade {
  key: string;
  label: string;
  prefix: string;
}

export const GRADES: readonly Grade[] = [
  { key: 'direction', label: 'Direction', prefix: '[Dir.]' },
  { key: 'chef_service', label: 'Chef de service', prefix: '[CdS]' },
  { key: 'medecin', label: 'Médecin', prefix: '[Méd.]' },
  { key: 'infirmier', label: 'Infirmier', prefix: '[Inf.]' },
  { key: 'ambulancier', label: 'Ambulancier', prefix: '[Amb.]' },
  { key: 'interne', label: 'Interne / Stagiaire', prefix: '[Int.]' },
];

/** Rôles configurables : grades + rôles techniques. */
export const ROLE_KEYS: Record<string, string> = {
  ...Object.fromEntries(GRADES.map((g) => [g.key, g.label])),
  citoyen: 'Citoyen',
  non_verifie: 'Non vérifié',
  absent: 'Absent',
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
