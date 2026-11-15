/**
 * Accès aux paramètres stockés en base, avec cache mémoire
 * (chargé au démarrage, mis à jour à chaque écriture).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { channelSettingKey, roleSettingKey } from './keys.js';

const cache = new Map<string, string>();

export async function loadSettings(): Promise<void> {
  cache.clear();
  for (const row of await db.select().from(settings)) cache.set(row.key, row.value);
}

export function getSetting(key: string): string | undefined {
  return cache.get(key);
}

export async function setSetting(key: string, value: string, by?: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedBy: by ?? null })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by ?? null, updatedAt: new Date() } });
  cache.set(key, value);
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
  cache.delete(key);
}

export function allSettings(): ReadonlyMap<string, string> {
  return cache;
}

/** IDs des rôles automatiques pour un déclencheur (/config auto). */
export function autoRoleIds(trigger: string): string[] {
  const prefix = `auto_${trigger}_`;
  return [...cache.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

/** ID du rôle configuré pour cette clé (ex. 'citoyen'), ou undefined. */
export const roleId = (key: string) => getSetting(roleSettingKey(key));
/** ID du salon configuré pour cette clé (ex. 'logs'), ou undefined. */
export const channelId = (key: string) => getSetting(channelSettingKey(key));
