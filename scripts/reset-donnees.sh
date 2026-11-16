#!/bin/sh
# Remise à zéro des données avant le lancement du serveur (à utiliser UNE SEULE FOIS).
#
# Efface : fiches RP, dossiers du personnel (et leurs posts dans le forum), absences (et leurs fiches dans
#          #absences), tickets (et les salons de tickets encore ouverts). Les numéros de tickets repartent à 1.
# Conserve : toute la configuration (grades, rôles, rôles automatiques, salons, messages fixes, types de tickets).
# Ne touche pas : aux rôles et pseudos des membres sur Discord, ni aux salons de logs.
#
# Une sauvegarde complète est faite avant ; restauration possible (voir README, « Restauration »).
#
# Utilisation (sur le VPS) :  cd /opt/omc-bot && sh scripts/reset-donnees.sh
set -eu
cd "$(dirname "$0")/.."

psql_q() { docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' ; }

echo "=== Remise à zéro des données du bot OMC ==="
echo "Données actuelles :"
printf "select ' fiches RP : ' || count(*) from fiches;
select ' dossiers  : ' || count(*) from dossiers;
select ' absences  : ' || count(*) from absences;
select ' tickets   : ' || count(*) from tickets;\n" | psql_q
echo
echo "Seront EFFACÉS : fiches RP, dossiers (+ posts du forum), absences (+ fiches dans #absences), tickets (+ salons ouverts)."
echo "Seront CONSERVÉS : grades, rôles, salons, messages fixes, types de tickets."
printf "Tape RESET (en majuscules) pour confirmer : "
read -r answer
[ "$answer" = "RESET" ] || { echo "Annulé, rien n'a été modifié."; exit 1; }

echo "1/4 Sauvegarde de sécurité…"
docker compose exec -T backup /bin/sh /backup.sh now

echo "2/4 Suppression des posts, fiches et salons sur Discord…"
# Salons / messages créés par le bot, au format « salon » ou « salon:message ».
TARGETS=$(printf "select thread_id from dossiers where thread_id is not null;
select channel_id || ':' || message_id from absences where channel_id is not null and message_id is not null;
select channel_id from tickets where status = 'ouvert' and channel_id is not null;\n" | psql_q | tr '\n' ' ')
if [ -n "$(echo "$TARGETS" | tr -d ' ')" ]; then
  docker compose exec -T -e TARGETS="$TARGETS" bot node --input-type=module -e '
    import { REST, Routes } from "discord.js";
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    for (const t of process.env.TARGETS.trim().split(/\s+/)) {
      const [channel, message] = t.split(":");
      try {
        await rest.delete(message ? Routes.channelMessage(channel, message) : Routes.channel(channel));
        console.log("  supprimé :", t);
      } catch (e) {
        console.log("  déjà absent ou inaccessible :", t, "-", e.message);
      }
    }'
else
  echo "  rien à supprimer."
fi

echo "3/4 Effacement des données en base…"
echo "truncate table dossier_events, dossiers, absences, tickets, fiches restart identity;" | psql_q

echo "4/4 Redémarrage du bot…"
docker compose restart bot

echo
echo "✅ Terminé. Pense ensuite, sur Discord :"
echo "   - aux membres déjà présents : ils repasseront par « Créer ma fiche » (ou /fiche modifier) ;"
echo "   - /dossier synchroniser pour recréer les dossiers des membres qui ont déjà le rôle EMS ;"
echo "   - à vider les salons de logs (Dupliquer le salon, supprimer l'ancien, /config salon sur le nouveau)."
