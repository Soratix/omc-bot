# Guide d’utilisation — bot de l’Ocean Medical Center

Ce guide sert à utiliser et administrer le bot **sans avoir besoin de son créateur**.
Le README contient la partie technique (installation sur le serveur, sauvegardes).

> Dans Discord, `/aide` affiche à chacun les commandes qu’il a le droit d’utiliser,
> et `/setup` (administrateurs) vérifie que tout est bien configuré.

---

## 1. Qui peut faire quoi

Les niveaux d’accès sont calculés automatiquement à partir des rôles Discord :

| Niveau | Qui | Comment l’obtenir |
|---|---|---|
| **Membre** | Tout le monde | — |
| **Personnel** | Membres ayant au moins un **grade** (Interne, Médecin…) | `/grade attribuer` |
| **Équipe d’un type de ticket** | Rôles d’accès du type (ex. @Direction) | `/tickets type-acces` |
| **Direction** | Membres ayant un grade marqué « direction » (Directeur, Co-Directeur, DRH, RH) **ou** administrateurs | `/config grade ajouter … direction:True` |
| **Administrateur** | Rôles avec la permission Discord **Administrateur** (ex. Fondateur, Gestion Discord) | Paramètres du serveur → Rôles |

| Action | Membre | Personnel | Direction | Admin |
|---|:-:|:-:|:-:|:-:|
| Créer sa fiche (nom RP), ouvrir un ticket, `/aide` | ✅ | ✅ | ✅ | ✅ |
| Déclarer une absence, `/absences liste` | | ✅ | ✅ | ✅ |
| Gérer **sa propre** absence (revenu, prolonger, annuler) | | ✅ | ✅ | ✅ |
| Gérer l’absence **de quelqu’un d’autre**, `/absences nettoyer` | | | ✅ | ✅ |
| Prendre en charge / fermer un ticket, `/tickets ajouter·retirer` | équipe du type | équipe du type | ✅ | ✅ |
| Fermer **son propre** ticket | ✅ | ✅ | ✅ | ✅ |
| `/grade` (grades **inférieurs au sien** uniquement) | | | ✅ | ✅ (tous) |
| `/fiche`, `/dossier`, avertissements et sanctions, `/embed` | | | ✅ | ✅ |
| `/tickets type-…`, `/tickets types`, `/tickets stats` | | | ✅ | ✅ |
| `/config`, `/setup` (masquées pour les autres) | | | | ✅ |

### Règles de sécurité intégrées

- **`/config` et `/setup`** : réservées aux administrateurs, et invisibles pour les autres membres.
- **`/grade`** : on ne peut attribuer qu’un grade **inférieur à son propre rang**, ni modifier quelqu’un de rang égal ou
  supérieur, ni changer son propre grade (sauf administrateurs). Un RH ne peut donc pas nommer un Directeur.
- **Absences** : seuls l’auteur et la direction peuvent agir sur une fiche d’absence.
- **Tickets** : un ticket n’est visible que par son auteur et par les rôles d’accès de son type.
  Une Réclamation / Plainte n’est visible que par la Direction.
- **Hiérarchie Discord** : le bot ne peut pas modifier un membre ou un rôle placé **au-dessus** de son propre rôle
  (**Natacha**), ni le propriétaire du serveur. Garde les rôles d’administration (Fondateur, Gestion Discord, Staff)
  au-dessus de Natacha.
- **Traçabilité** : toutes les actions importantes sont écrites dans le salon de logs (qui, quoi, quand).
  Les problèmes qui demandent une action sont aussi envoyés dans le salon staff (« 🚨 Action de la direction requise »).

> ⚠️ Donner la permission **Administrateur** à un rôle donne accès à `/config`, donc à toute la configuration du bot.
> Ne la donne qu’à des personnes de confiance.

---

## 2. Pour les membres

- **Arrivée sur le serveur** : tu ne vois que `#vérification`. Clique sur **Créer ma fiche**, indique le prénom et le
  nom de ton personnage RP. Ton pseudo devient « Prénom Nom » et tu accèdes au serveur.
  (Lettres, espaces, tirets et apostrophes uniquement ; 25 caractères maximum au total.)
- **Contacter l’hôpital** : dans `#ouvrir-un-ticket`, choisis le type de demande dans le menu et remplis le formulaire.
  Un salon privé est créé avec l’équipe concernée. Quand le ticket est fermé, tu reçois en MP le motif et une copie
  de la conversation (fichier à ouvrir dans un navigateur).

---

## 3. Pour le personnel

- **Absence** : dans `#absences`, bouton **Déclarer une absence** → dates au format JJ/MM/AAAA, motif facultatif.
  - Tu reçois le rôle **Absent** pendant l’absence ; tu apparais dans la liste « Actuellement absent ».
  - Le jour de ta date de fin, à 9 h, le bot te demande en MP si tu es revenu (**Je suis revenu** / **Prolonger**).
    Si tes MP sont fermés, il te mentionne dans le salon staff.
  - Sans réponse pendant 2 jours, ton absence passe en 🔴 « Retour non confirmé » et la direction est prévenue.
  - Ta fiche disparaît du salon quand l’absence est terminée ou annulée (elle reste dans ton dossier).
- **Tickets** (si ton rôle a l’accès au type) : **Prendre en charge**, puis **Fermer** avec un motif.
  `/tickets ajouter membre:@X` donne accès au ticket à quelqu’un d’autre.

---

## 4. Pour la direction — tâches courantes

| Je veux… | Commande / action |
|---|---|
| **Embaucher** quelqu’un | Il doit avoir créé sa fiche, puis `/grade attribuer membre:@X grade:Interne motif:…` → rôle EMS, préfixe, dossier créés automatiquement |
| **Promouvoir / rétrograder** | `/grade attribuer membre:@X grade:Médecin motif:…` (remplace l’ancien grade) |
| **Départ** d’un employé | `/grade retirer membre:@X motif:…` → EMS retiré, dossier archivé |
| **Avertissement / sanction** | `#gestion-secrétaire` → bouton **Avertissement** ou **Sanction** → ID Discord du membre + raison |
| Ajouter une **note** au dossier | `/dossier note membre:@X texte:…` |
| Consulter un **dossier** | `/dossier voir membre:@X` ou le forum des dossiers |
| **Corriger un nom RP** | `/fiche modifier membre:@X prenom:… nom:…` |
| Gérer l’absence de quelqu’un | Boutons sur sa fiche dans `#absences` |
| Publier une **annonce** | `/embed envoyer salon:#… couleur:… image:… mention:@…` → formulaire (titre, contenu, pied de page) |
| Modifier une annonce du bot | `/embed modifier lien:<lien du message>` |
| Voir les **statistiques tickets** | `/tickets stats` |

> **Copier l’ID Discord d’un membre** : Paramètres utilisateur → Avancés → activer le **Mode développeur**,
> puis clic droit sur le membre → **Copier l’identifiant**.

Préfère toujours `/grade` à l’ajout de rôles à la main : le dossier enregistre alors **qui** a fait le changement et
**pourquoi**. Un rôle ajouté à la main fonctionne aussi (préfixe, EMS, dossier), mais sans auteur ni motif.

### Types de tickets

| Je veux… | Commande |
|---|---|
| Créer un type | `/tickets type-creer role:@Rôle ouverture:…` → formulaire (nom, emoji, description, questions) |
| Modifier nom / questions | `/tickets type-modifier type:…` (formulaire pré-rempli) |
| Ajouter / retirer un rôle d’accès | `/tickets type-acces type:… role:@Rôle` (ajoute s’il est absent, retire s’il est présent) |
| Retirer un type du menu | `/tickets type-retirer type:…` (l’historique est conservé) — `type-reactiver` pour le remettre |
| Voir les types | `/tickets types` |

**Format des questions** : une par ligne, 5 au maximum, 45 caractères maximum chacune.
`*` au début = réponse longue, `?` au début = facultative. Exemple :

```
Membre du personnel concerné
?Date et heure des faits
*Description des faits
```

---

## 5. Pour les administrateurs — configuration

Lance **`/setup`** : il liste les étapes, coche ce qui est prêt et donne la commande à taper pour le reste.
`/config voir` affiche le détail de la configuration et les problèmes.

| Je veux… | Commande |
|---|---|
| Ajouter un **grade** | Créer le rôle **sous Natacha**, puis `/config grade ajouter role:@X prefixe:[Xxx] direction:False` puis `/fiche resynchroniser` |
| Changer un préfixe / l’accès direction | `/config grade ajouter` sur le même rôle (remplace) |
| Supprimer un grade | `/config grade retirer role:@X` |
| Rôle donné automatiquement | `/config auto ajouter declencheur:Arrivée / Personnel (EMS) / Direction role:@X` |
| Changer un salon | `/config salon cle:… salon:#…` |
| Republier / mettre à jour un message fixe | `/config publier panneau:Vérification / Absences / Gestion / Tickets` |
| Recalculer pseudos et rôles EMS / Direction | `/fiche resynchroniser` |
| Créer les dossiers manquants | `/dossier synchroniser` |

### Avant l’ouverture : effacer les données de test (une seule fois)

Le script `scripts/reset-donnees.sh` efface les **fiches RP, dossiers (et leurs posts du forum), absences et tickets**
(les numéros de tickets repartent à 1), en **conservant toute la configuration**. Il fait une sauvegarde avant
et demande de taper `RESET` pour confirmer.

1. Sur Discord : retirer les grades et rôles du ou des comptes de test (ou les exclure du serveur).
2. Sur le VPS (accès SSH) :
   ```bash
   cd /opt/omc-bot && sh scripts/reset-donnees.sh
   ```
3. Vider les salons de logs (`logs-bot`, `retour-secrétaire`, `logs-tickets`) : clic droit sur le salon →
   **Dupliquer le salon**, supprimer l’ancien, puis `/config salon` sur le nouveau.
4. `/setup` pour vérifier, puis `/dossier synchroniser` si des membres ont déjà le rôle EMS.
5. Les membres déjà présents recréent leur fiche via **Créer ma fiche** (ou `/fiche modifier` par la direction).

⚠️ Ne pas relancer ce script une fois le serveur ouvert : il effacerait les vraies données
(une restauration reste possible depuis la sauvegarde faite juste avant, voir le README).

**Ordre des grades** : c’est l’ordre des rôles dans *Paramètres du serveur → Rôles* qui compte (le plus haut donne le
préfixe, et monter de rôle = promotion). Pour réorganiser la hiérarchie, il suffit de déplacer les rôles.

---

## 6. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Le rôle X est au-dessus du rôle du bot » | Hiérarchie des rôles | Monter **Natacha** au-dessus du rôle concerné |
| « Il manque au bot ces permissions dans #salon » | Permissions du salon ou de la catégorie | Donner à Natacha les permissions listées dans ce salon |
| Pseudo du propriétaire jamais mis à jour | Limite Discord | Normal, à faire à la main |
| Un membre ne voit pas `#vérification` | Permissions du salon | `#vérification` doit être visible par *Non vérifié* |
| Le menu des tickets ne propose rien | Aucun type actif | `/tickets types`, `/tickets type-reactiver` |
| « Les tickets ne sont pas encore configurés » | Catégorie manquante | `/config salon cle:Catégorie des tickets ouverts` |
| Transcript non archivé, salon conservé | `#logs-tickets` inaccessible | Corriger les permissions, puis supprimer le salon à la main |
| Le bot ne répond plus du tout | Bot arrêté | Voir la section 7 |

En cas d’erreur inattendue, le bot écrit « ❌ Erreur inattendue » dans le salon de logs et le salon staff,
avec le nom de l’action concernée : transmets ce message à la personne qui gère le serveur (VPS).

---

## 7. Si le bot est hors ligne

Le bot tourne sur un serveur (VPS) dans Docker et redémarre tout seul en cas de plantage ou de redémarrage du VPS.
S’il reste hors ligne, une personne ayant l’accès SSH au VPS doit lancer :

```bash
cd /opt/omc-bot
docker compose ps              # état des conteneurs (bot, db, backup)
docker compose logs --tail 50 bot   # dernières lignes du journal
docker compose up -d           # (re)démarrer
```

Messages fréquents dans le journal :

- « Token Discord invalide » → le token a été réinitialisé : en générer un nouveau dans le Developer Portal
  (Bot → Reset Token) et le mettre dans `/opt/omc-bot/.env` (`DISCORD_TOKEN=`), puis `docker compose up -d`.
- « Intent privilégié non activé » → Developer Portal → Bot → activer **SERVER MEMBERS INTENT** et **MESSAGE CONTENT INTENT**.

Les sauvegardes de la base sont faites chaque nuit dans `/opt/omc-bot/backups/` (7 jours conservés) ;
la restauration est décrite dans le README.

---

## 8. Sécurité — à savoir

- Le **token** du bot donne le contrôle total du bot : il n’est stocké que dans `/opt/omc-bot/.env` sur le VPS
  (lisible uniquement par son propriétaire) et ne doit **jamais** être partagé ni publié.
  En cas de doute (fuite, départ d’une personne qui y avait accès) : Developer Portal → Bot → **Reset Token**,
  puis mettre le nouveau dans `.env` et `docker compose up -d`.
- Le bot n’ouvre **aucun port** sur le VPS et sa base de données n’est pas accessible depuis Internet.
- Accès à garder sous contrôle : le compte propriétaire de l’application sur le Developer Portal, l’accès SSH au VPS,
  le dépôt GitHub privé, et la permission **Administrateur** sur Discord.
