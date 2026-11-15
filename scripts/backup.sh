#!/bin/sh
# Sauvegarde quotidienne de la base (format custom pg_dump, compressé).
# Tourne en boucle dans le conteneur « backup » : une sauvegarde par jour à BACKUP_HOUR h (heure de Paris),
# suppression des sauvegardes de plus de BACKUP_KEEP_DAYS jours.
# Sauvegarde immédiate : docker compose exec backup /bin/sh /backup.sh now
set -eu

log() { echo "$(date '+%d/%m/%Y %H:%M:%S') $*"; }

dump() {
  file="/backups/omc-$(date +%Y-%m-%d_%H%M).dump"
  if pg_dump --format=custom --file="$file.tmp"; then
    mv "$file.tmp" "$file"
    log "[INFO] Sauvegarde créée : $(basename "$file") ($(du -h "$file" | cut -f1))"
  else
    rm -f -- "$file.tmp"
    log "[ERREUR] Échec de la sauvegarde" >&2
    return 1
  fi
  # Rotation : supprime les sauvegardes plus anciennes que BACKUP_KEEP_DAYS jours.
  find /backups -maxdepth 1 -name 'omc-*.dump' -type f -mtime +"$((BACKUP_KEEP_DAYS - 1))" | while read -r old; do
    rm -f -- "$old"
    log "[INFO] Ancienne sauvegarde supprimée : $(basename "$old")"
  done
}

if [ "${1:-}" = "now" ]; then
  dump
  exit $?
fi

log "[INFO] Sauvegardes planifiées tous les jours à ${BACKUP_HOUR}h (heure de Paris), conservation ${BACKUP_KEEP_DAYS} jours."
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) ${BACKUP_HOUR}:00:00" +%s)
  if [ "$next" -le "$now" ]; then next=$((next + 86400)); fi
  sleep $((next - now))
  dump || true
done
