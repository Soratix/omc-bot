# Bot Discord — Ocean Medical Center

Bot sur mesure du serveur Discord de l’hôpital **Ocean Medical Center** (serveur RP FiveM).
Un seul bot pour tout : vérification et nom RP, absences du personnel, puis tickets (phase 2).

- Node.js 26 LTS + TypeScript, discord.js 14
- PostgreSQL 18 (conteneur dédié, volume persistant, réseau interne uniquement)
- Drizzle ORM, migrations SQL versionnées dans `drizzle/`, appliquées automatiquement au démarrage
- Fuseau horaire Europe/Paris, dates au format JJ/MM/AAAA

---

## Sommaire

1. [Créer le bot sur le Developer Portal](#1-créer-le-bot-sur-le-developer-portal)
2. [Préparer le serveur Discord](#2-préparer-le-serveur-discord)
3. [Installation sur le VPS](#3-installation-sur-le-vps)
4. [Configuration du bot sur Discord (`/config`)](#4-configuration-du-bot-sur-discord-config)
5. [Fonctionnement des modules](#5-fonctionnement-des-modules)
6. [Commandes](#6-commandes)
7. [Mise à jour](#7-mise-à-jour)
8. [Logs](#8-logs)
9. [Sauvegarde et restauration](#9-sauvegarde-et-restauration)
10. [Développement](#10-développement)

---

## 1. Créer le bot sur le Developer Portal

1. Va sur <https://discord.com/developers/applications> → **New Application** → nom : `Ocean Medical Center` (ou autre).
2. Onglet **Bot** :
   - **Reset Token** → copie le token (il ne sera plus affiché). Il ira dans le fichier `.env`, **jamais ailleurs**.
   - **Public Bot** : désactive-le (personne d’autre ne pourra inviter le bot).
   - **Privileged Gateway Intents** :
     - ✅ **SERVER MEMBERS INTENT** — **obligatoire** (arrivées des membres, changements de rôles).
     - ❌ Presence Intent — inutile.
     - ❌ Message Content Intent — inutile : tout passe par boutons, formulaires et commandes slash.
3. Onglet **General Information** → copie l’**Application ID**.
4. Invite le bot avec ce lien (remplace `APPLICATION_ID`) :

   ```
   https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot+applications.commands&permissions=402738176
   ```

### Permissions demandées (phase 1)

| Permission | Pourquoi |
|---|---|
| Voir les salons | Lire les salons où il publie |
| Envoyer des messages | Messages fixes, fiches d’absence, logs, alertes |
| Intégrer des liens | Embeds |
| Voir les anciens messages | Retrouver et modifier ses messages (fiches, messages fixes) |
| Gérer les pseudos | Renommer les membres « [Grade] Prénom Nom » |
| Gérer les rôles | Non vérifié → Citoyen, rôle Absent |

La phase 2 (tickets) ajoutera **Gérer les salons** et **Joindre des fichiers** (transcripts).

---

## 2. Préparer le serveur Discord

### Rôles

Crée (ou garde) les rôles suivants. **Le rôle du bot doit être placé au-dessus de tous ces rôles** dans
*Paramètres du serveur → Rôles*, sinon il ne pourra ni les attribuer, ni renommer les membres qui les portent.

| Rôle | Préfixe du pseudo |
|---|---|
| Direction | `[Dir.]` |
| Chef de service | `[CdS]` |
| Médecin | `[Méd.]` |
| Infirmier | `[Inf.]` |
| Ambulancier | `[Amb.]` |
| Interne / Stagiaire | `[Int.]` |
| Citoyen | — |
| Non vérifié | — |
| Absent | — |

> Le bot ne peut **jamais** renommer le propriétaire du serveur (limite Discord) ni un membre dont le rôle
> le plus haut est au-dessus du sien. Dans ces cas, il affiche un message clair et l’écrit dans les logs.

### Salons et permissions

| Salon | Réglage conseillé |
|---|---|
| `#vérification` | Visible **uniquement** par *Non vérifié* (et la direction). Personne ne peut y écrire. |
| `#absences` | Visible par le personnel. Personne ne peut y écrire (seul le bot publie). |
| `#logs-bot` | Visible par la direction uniquement. |
| `#staff` (alertes) | Visible par le personnel (rappels si MP fermés, alertes « retour non confirmé »). |

Pour que *Non vérifié* ne voie que `#vérification` : retire **Voir les salons** à `@everyone` sur les catégories,
donne-le à *Citoyen* (et aux grades), et sur `#vérification` donne-le à *Non vérifié*.

Conseillé : retire la permission **Changer de pseudo** à `@everyone`, pour que les membres gardent leur nom RP.

---

## 3. Installation sur le VPS

Prérequis : Docker Engine et le plugin Compose (déjà installés depuis le dépôt officiel Docker).
Le bot **n’ouvre aucun port** : il se connecte seulement à Discord. La base n’est joignable que sur un réseau Docker interne.

```bash
# 1. Dossier du projet (une seule fois, demande le mot de passe sudo)
sudo mkdir /opt/omc-bot && sudo chown "$USER":"$USER" /opt/omc-bot

# 2. Récupérer le code (dépôt GitHub privé, via une clé de déploiement en lecture seule)
git clone git@github.com:Soratix/omc-bot.git /opt/omc-bot
cd /opt/omc-bot

# 3. Configuration
cp .env.example .env
chmod 600 .env
nano .env        # DISCORD_TOKEN, GUILD_ID, POSTGRES_PASSWORD (openssl rand -hex 24)

# 4. Lancement
docker compose up -d --build
docker compose logs -f bot
```

### Variables du fichier `.env`

| Variable | Rôle |
|---|---|
| `DISCORD_TOKEN` | Token du bot (Developer Portal → Bot) |
| `GUILD_ID` | ID du serveur Discord (mode développeur → clic droit sur le serveur → Copier l’identifiant) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Identifiants de la base (mot de passe long et aléatoire) |
| `ABSENCE_CHECK_HOUR` | Heure de la tâche quotidienne des absences (défaut : 9) |
| `ABSENCE_CONFIRM_DAYS` | Jours sans réponse avant « Retour non confirmé » (défaut : 2) |
| `BACKUP_HOUR` / `BACKUP_KEEP_DAYS` | Heure de la sauvegarde (défaut : 4 h) et durée de conservation (défaut : 7 jours) |

---

## 4. Configuration du bot sur Discord (`/config`)

Réservé à la direction (ou aux administrateurs du serveur tant que le rôle Direction n’est pas configuré).

1. Associer chaque rôle : `/config role cle:Direction role:@Direction`, puis Chef de service, Médecin, Infirmier,
   Ambulancier, Interne / Stagiaire, Citoyen, Non vérifié, Absent.
2. Associer les salons : `/config salon cle:#vérification salon:#vérification`, puis #absences, logs, staff.
3. Vérifier : `/config voir` affiche la configuration et **les problèmes détectés** (rôle du bot trop bas, permission manquante…).
4. Publier les messages fixes :
   - `/config publier panneau:Vérification`
   - `/config publier panneau:Absences`

   Republier met à jour le message existant (pas de doublon).
5. Si des membres ont déjà un grade : `/fiche resynchroniser` applique les préfixes à tous ceux qui ont une fiche.

---

## 5. Fonctionnement des modules

### Vérification et nom RP

- Arrivée d’un membre → rôle **Non vérifié** (il ne voit que `#vérification`).
- Bouton **Créer ma fiche** → formulaire Prénom RP / Nom RP.
- Règles : lettres (accents compris), espaces, tirets et apostrophes ; majuscule automatique en début de mot ;
  « Prénom Nom » ≤ 25 caractères (pour que « [Méd.] Prénom Nom » tienne dans les 32 caractères de Discord).
- Le bot renomme le membre, retire *Non vérifié*, ajoute *Citoyen*, enregistre la fiche et écrit dans les logs.
- Quand la direction ajoute ou retire un rôle de grade, le préfixe est mis à jour automatiquement
  (c’est le grade le plus haut qui compte).
- Un membre qui revient sur le serveur retrouve son ancienne fiche pré-remplie.

### Absences

- Bouton **Déclarer une absence** (personnel uniquement : Interne → Direction) → début, fin (JJ/MM/AAAA), motif facultatif.
- Une fiche (embed) est publiée dans `#absences` avec les boutons **Je suis revenu**, **Prolonger**, **Annuler**
  (auteur ou direction). La fiche est modifiée à chaque changement, jamais dupliquée.
- Statuts : 🔵 À venir · 🟡 En cours · 🔴 Retour non confirmé · 🟢 Terminée · ⚫ Annulée.
- Rôle **Absent** pendant l’absence (attribué le jour du début, retiré au retour ou à l’annulation).
- Tâche quotidienne à 9 h (heure de Paris) :
  - le jour de la date de fin : message privé « Ton absence se termine, es-tu de retour ? » avec **Je suis revenu** / **Prolonger** ;
    si les MP sont fermés, le membre est mentionné dans le salon staff ;
  - sans réponse après 2 jours : statut 🔴 et alerte à la direction dans le salon staff.
- Une absence qui commence un jour donné reçoit le rôle Absent à 00 h 05.
- Si le bot était arrêté à l’heure de la tâche, il rattrape au redémarrage (sans envoyer de doublons).

---

## 6. Commandes

| Commande | Qui | Effet |
|---|---|---|
| `/config role` · `salon` · `voir` · `publier` | Direction | Configuration (voir §4) |
| `/fiche voir membre:` | Direction | Fiche RP d’un membre |
| `/fiche modifier membre: prenom: nom:` | Direction | Corrige le nom RP et met à jour le pseudo |
| `/fiche resynchroniser` | Direction | Réapplique « [Grade] Prénom Nom » à tous les membres ayant une fiche |
| `/absences liste` | Personnel | Absences en cours et à venir |
| `/absences nettoyer` | Direction | Retire du salon les fiches terminées/annulées (elles restent en base) |

---

## 7. Mise à jour

```bash
cd /opt/omc-bot
git pull
docker compose up -d --build
docker compose logs -f bot
```

Les migrations de base de données éventuelles sont appliquées automatiquement au démarrage du bot.
Pour faire de la place après plusieurs mises à jour : `docker image prune -f`.

---

## 8. Logs

- **Console du bot** : `docker compose logs -f bot` (une ligne par événement, heure de Paris).
- **Salon de logs Discord** : vérifications, changements de pseudo/préfixe, fiches modifiées, absences
  (déclaration, retour, prolongation, annulation, rappels, alertes), changements de configuration.
- Rotation des logs Docker : 3 fichiers de 10 Mo maximum par conteneur (réglé dans `docker-compose.yml`).

---

## 9. Sauvegarde et restauration

Le service `backup` fait un `pg_dump` chaque jour à 4 h (heure de Paris) dans `/opt/omc-bot/backups/`
et supprime les sauvegardes de plus de 7 jours.

```bash
# Lister les sauvegardes
ls -lh /opt/omc-bot/backups/

# Sauvegarde immédiate (avant une mise à jour risquée, par exemple)
docker compose exec backup /bin/sh /backup.sh now

# Suivre les sauvegardes
docker compose logs backup
```

> Conseil : copie régulièrement le dossier `backups/` hors du VPS (ex. `scp` vers ton PC).

### Restauration

```bash
cd /opt/omc-bot

# 1. Arrêter le bot (la base reste démarrée)
docker compose stop bot

# 2. Sauvegarde de sécurité de l'état actuel
docker compose exec backup /bin/sh /backup.sh now

# 3. Restaurer (remplace le contenu actuel de la base)
docker compose exec backup sh -c 'pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" /backups/omc-AAAA-MM-JJ_HHMM.dump'

# 4. Redémarrer le bot
docker compose start bot
docker compose logs -f bot
```

Pour simplement consulter une ancienne sauvegarde sans toucher à la base :

```bash
docker compose exec backup sh -c 'createdb verif && pg_restore --no-owner -d verif /backups/omc-AAAA-MM-JJ_HHMM.dump'
docker compose exec backup psql -d verif     # … puis : dropdb verif
```

---

## 10. Développement

```bash
npm ci
npm run typecheck     # vérification TypeScript
npm test              # tests unitaires (noms RP, dates)
npm run dev           # lancement local (nécessite un .env avec DATABASE_URL)
```

Après une modification de `src/db/schema.ts` : `npm run db:generate` crée une nouvelle migration dans `drizzle/`
(à commiter).

Organisation du code :

```
src/
  index.ts            point d'entrée (client Discord, événements, arrêt propre)
  env.ts, logger.ts   variables d'environnement, journal console
  db/                 connexion, schéma Drizzle, migrations au démarrage
  config/             clés de configuration, paramètres en base, /config
  logs/               écriture dans le salon de logs
  lib/                dates, noms RP, droits et opérations Discord sûres
  core/               routage des interactions, messages fixes
  verification/       fiche RP, pseudo + préfixe de grade, /fiche
  absences/           déclaration, fiches, tâche quotidienne, /absences
```
