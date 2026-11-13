# Spécifications fonctionnelles — Backend de la plateforme de commandes WhatsApp

> Source de référence : `DAT – Backend NestJS – Plateforme de commandes WhatsApp.md` (racine du dépôt), qui fait foi.
> Ce document reformule le DAT en exigences testables. Il n'ajoute aucune fonctionnalité hors du périmètre de la section 1 du DAT.
> En cas d'écart entre ce document et le DAT, le DAT prévaut. Les contradictions et manques relevés sont listés dans la section « Points ouverts / ambiguïtés » et ne sont pas tranchés ici.

## Contexte

Des vendeurs (5 au maximum) envoient leurs commandes sous forme de message structuré à un bot WhatsApp. Le bot vérifie le message, renvoie un récapitulatif avec des boutons Valider / Modifier / Annuler, puis enregistre la commande validée avec le statut « non traitée ». Un administrateur unique traite ensuite les commandes depuis un backoffice Vue.js via une API REST : changements de statut, correction des commandes, gestion des vendeurs, statistiques et impression des reçus PDF à coller sur les colis.
Volume visé : environ 20 commandes par jour. Pays : Côte d'Ivoire (numéros +225 à 10 chiffres). Langue de l'interface et des messages : français. Montants en francs CFA (XOF), entiers sans décimale.

## Périmètre

### Inclus (DAT section 1)
- Webhook WhatsApp Cloud API : vérification, signature, journalisation, idempotence.
- Identification du vendeur par son numéro WhatsApp (liste blanche).
- Parsing du modèle de commande, récapitulatif, boutons Valider / Modifier / Annuler.
- Création de la commande avec référence unique, articles, prix et total.
- API REST du backoffice : commandes, vendeurs, statuts, statistiques, authentification JWT.
- Génération de reçus PDF (unitaire et groupé).

### Exclus (DAT section 1)
- Gestion des livreurs, suivi de livraison, paiement en ligne.
- Frais de livraison et livraison elle-même (traités hors application).
- Catalogue produits : les articles sont saisis librement par le vendeur.
- Redis, files de messages, WebSocket (le backoffice interroge l'API toutes les 20 à 30 s).
- Messages modèles (templates) WhatsApp payants : le vendeur écrit toujours en premier, le bot répond dans la fenêtre de 24 h.
- Route d'inscription publique (l'admin est créé par le script de seed).
- Conversation libre avec le bot.

## Acteurs

| Acteur | Type | Objectifs |
| --- | --- | --- |
| Vendeur | Utilisateur WhatsApp, inscrit en liste blanche par l'admin | Transmettre des commandes structurées, les vérifier et les valider, consulter ses 5 dernières commandes |
| Administrateur | Unique utilisateur du backoffice (rôle `admin`) | Traiter les commandes (statuts, corrections), gérer les vendeurs, imprimer les reçus, consulter les statistiques |
| Meta (WhatsApp Cloud API) | Système externe | Vérifier le webhook, transmettre les messages entrants signés, acheminer les réponses du bot |

Remarque : le client final (destinataire du colis) n'interagit pas avec la plateforme ; ses informations (nom, téléphone, lieu) sont saisies par le vendeur.

## Glossaire

| Terme | Définition |
| --- | --- |
| Brouillon | Commande parsée en attente d'action du vendeur (table `order_drafts`), identifiée par un `public_id` de 12 caractères aléatoires, durée de vie 30 minutes (`DRAFT_TTL_MINUTES`) |
| `wamid` | Identifiant unique d'un message WhatsApp fourni par Meta |
| Référence | Identifiant lisible d'une commande au format `CMD-AAAAMMJJ-NNN` |
| Commande de secours | Mot-clé texte reconnu par le bot : `modele`, `aide`, `mes commandes`, `annuler` |
| Statuts de commande | `non_traitee`, `validee`, `prete`, `livree`, `echec`, `annulee` |
| Statuts de brouillon | `pending`, `confirmed`, `cancelled`, `expired` |

---

## User stories

Domaines : Bot / WhatsApp (BOT), Commandes (CMD), Vendeurs (VEN), Authentification (AUTH), Reçus (REC), Statistiques (STAT).

### Domaine Bot / WhatsApp

#### US-BOT-01 : Vérification du webhook par Meta
En tant que Meta, je veux vérifier l'URL du webhook avec un jeton partagé, afin d'activer l'envoi des événements vers le backend.

**Critères d'acceptation**
- Given `WEBHOOK_VERIFY_TOKEN` configuré, When Meta appelle `GET /api/v1/whatsapp/webhook` avec `hub.mode=subscribe` et `hub.verify_token` égal au jeton, Then la réponse est `200` et le corps est la valeur de `hub.challenge` en texte brut.
- Given un `hub.verify_token` différent ou un `hub.mode` différent de `subscribe`, When Meta appelle la route, Then la réponse est `403`.
- Given la route, When elle est appelée sans JWT, Then elle est accessible (route publique).

#### US-BOT-02 : Réception authentifiée des événements
En tant que Meta, je veux que mes événements signés soient acceptés immédiatement, afin que le vendeur reçoive une réponse sans que l'appel n'expire.

**Critères d'acceptation**
- Given un POST sur `/api/v1/whatsapp/webhook` dont l'en-tête `X-Hub-Signature-256` vaut `sha256=` + HMAC-SHA256 hexadécimal des octets bruts reçus avec `META_APP_SECRET`, When il est reçu, Then le payload brut est enregistré dans `webhook_logs` avec `signature_valid = 1` et la réponse `200` est envoyée avant tout traitement métier.
- Given un POST sans en-tête de signature, When il est reçu, Then le payload est enregistré avec `signature_valid = 0`, la réponse est `403` et aucun message n'est traité.
- Given un POST avec une signature falsifiée, When il est reçu, Then même comportement : journalisé avec `signature_valid = 0`, `403`, aucun traitement.
- Given un POST signé dont le corps a été modifié d'un seul octet après signature, When il est reçu, Then la signature est jugée invalide (`403`).
- Given la comparaison de signature, When elle est effectuée, Then elle est réalisée en temps constant.
- Given un événement ne contenant que des `statuses[]` (accusés de lecture ou de livraison), When il est traité, Then il est ignoré (aucune réponse au vendeur, aucune donnée métier créée).
- Given une exception levée pendant le traitement asynchrone d'un message, When elle survient, Then elle est capturée et journalisée, et n'affecte pas la réponse `200` déjà envoyée.

#### US-BOT-03 : Traitement unique de chaque message (idempotence)
En tant que vendeur, je veux qu'un même message ne soit traité qu'une fois même si Meta le renvoie, afin d'éviter les récapitulatifs ou commandes en double.

**Critères d'acceptation**
- Given un message de `wamid` W jamais reçu, When il est traité, Then W est inséré dans `processed_messages` puis le message est transmis au bot.
- Given un message de `wamid` W déjà présent dans `processed_messages`, When Meta le renvoie, Then il est ignoré : aucune réponse envoyée, aucun brouillon ni commande créé.
- Given un payload contenant plusieurs messages (`entry[].changes[].value.messages[]`), When il est traité, Then chaque message est contrôlé et traité individuellement.

#### US-BOT-04 : Refus des types de messages non pris en charge
En tant que vendeur, je veux être informé quand j'envoie un contenu non texte, afin de savoir comment passer commande.

**Critères d'acceptation**
- Given un message de type `text`, When il est normalisé, Then le corps `text.body` est transmis au bot.
- Given un message `interactive` de type `button_reply`, When il est normalisé, Then l'identifiant `interactive.button_reply.id` est transmis au bot.
- Given un message de type image, audio, document, sticker ou tout autre type, When il est reçu, Then le bot répond exactement « Seuls les messages texte sont acceptés. Tapez *modele* pour recevoir le modèle. »

#### US-BOT-05 : Contrôle de la liste blanche
En tant qu'administrateur, je veux que seuls les vendeurs actifs enregistrés puissent passer commande, afin d'empêcher les commandes de numéros inconnus.

**Critères d'acceptation**
- Given un numéro `from` absent de `vendors`, When il envoie un message, Then le bot répond « Ce numéro n'est pas autorisé à passer commande. », l'événement est journalisé, et aucune autre action n'est effectuée (pas de brouillon, aucune donnée renvoyée).
- Given un numéro `from` correspondant à un vendeur avec `is_active = 0`, When il envoie un message (texte ou clic de bouton), Then même comportement que pour un numéro inconnu.
- Given un numéro `from` correspondant à un vendeur actif, When il envoie un message, Then le traitement continue (bouton, commande de secours ou parsing).

#### US-BOT-06 : Obtenir le modèle de commande
En tant que vendeur, je veux recevoir le modèle à remplir en tapant `modele`, afin de saisir ma commande au bon format.

**Critères d'acceptation**
- Given un vendeur actif, When il envoie `modele`, `Modèle`, `MODELE` ou `modèle` (insensible à la casse et aux accents), Then le bot répond avec le modèle :
  ```text
  Nom: Awa Koné
  Téléphone: 0707070707
  Lieu: Cocody Angré 8e tranche
  Articles: 2 robes bleues x 15000, 1 sac noir x 8000
  ```

#### US-BOT-07 : Obtenir de l'aide
En tant que vendeur, je veux taper `aide` pour comprendre le fonctionnement du bot, afin de l'utiliser sans assistance.

**Critères d'acceptation**
- Given un vendeur actif, When il envoie `aide` (insensible à la casse et aux accents), Then le bot répond par une explication courte du fonctionnement, en français.

#### US-BOT-08 : Consulter mes dernières commandes
En tant que vendeur, je veux taper `mes commandes`, afin de connaître la référence, le statut et le total de mes 5 dernières commandes.

**Critères d'acceptation**
- Given un vendeur actif ayant 7 commandes, When il envoie `mes commandes`, Then le bot répond avec ses 5 commandes les plus récentes, chacune avec sa référence, son statut et son total.
- Given deux vendeurs A et B, When A envoie `mes commandes`, Then aucune commande de B n'apparaît.
- Given la commande de secours, When elle est saisie avec des variations de casse ou d'accents, Then elle est reconnue.

#### US-BOT-09 : Envoyer une commande et recevoir un récapitulatif
En tant que vendeur, je veux envoyer ma commande au format du modèle et recevoir un récapitulatif avec des boutons, afin de vérifier les informations avant de valider.

**Critères d'acceptation**
- Given un vendeur actif et un message conforme au modèle, When il l'envoie, Then un brouillon est créé avec le statut `pending`, un `public_id` aléatoire de 12 caractères, `expires_at` = maintenant + 30 minutes, et un payload contenant nom, téléphone, lieu, articles parsés et total.
- Given le brouillon créé, When le bot répond, Then il envoie un message interactif contenant le récapitulatif et trois boutons : titres « Valider », « Modifier », « Annuler » ; identifiants `valider:<public_id>`, `modifier:<public_id>`, `annuler:<public_id>`.
- Given l'exemple du modèle, When le récapitulatif est généré, Then il respecte le format :
  ```text
  Récapitulatif de la commande
  Client : Awa Koné
  Tél : 0707070707
  Lieu : Cocody Angré 8e tranche
  Articles :
  • 2 × robes bleues — 15 000 F = 30 000 F
  • 1 × sac noir — 8 000 F
  Total : 38 000 F CFA
  ```
- Given des articles parsés, When le total est calculé, Then il vaut la somme de quantité × prix unitaire, calculée par le serveur (2 × 15 000 + 1 × 8 000 = 38 000).
- Given un récapitulatif de plus de 1 024 caractères, When le bot doit l'envoyer, Then il demande au vendeur de scinder la commande en deux (voir point ouvert PO-06).
- Given un vendeur ayant déjà un brouillon `pending`, When il envoie une nouvelle commande valide, Then un second brouillon est créé et les deux coexistent, chacun avec ses propres boutons.

#### US-BOT-10 : Être informé de toutes les erreurs de saisie en une fois
En tant que vendeur, je veux recevoir la liste complète des erreurs de mon message, afin de tout corriger en un seul renvoi.

**Critères d'acceptation**
- Given un message comportant plusieurs erreurs (par exemple téléphone à 9 chiffres et article sans prix), When il est parsé, Then toutes les erreurs sont renvoyées dans une seule réponse, en français, suivies du modèle, et aucun brouillon n'est créé.
- Given un téléphone qui ne contient pas exactement 10 chiffres après normalisation, When il est parsé, Then l'erreur « Téléphone invalide : 10 chiffres attendus » est renvoyée.
- Given un article sans prix (ex. « 1 sac noir »), When il est parsé, Then l'erreur « Prix manquant pour : sac noir » est renvoyée.
- Given un champ obligatoire manquant (nom, téléphone, lieu ou articles), When le message est parsé, Then une erreur est renvoyée pour ce champ.
- Given plus de 30 articles, ou une quantité hors de 1 à 999, ou un prix hors de 1 à 10 000 000, ou un message de plus de 2 000 caractères, When il est parsé, Then une erreur correspondante est renvoyée.
- Règles de parsing à couvrir (cf. section « Règles métier » R-P1 à R-P8) : libellés insensibles à la casse et aux accents, variantes de libellés, séparateurs `:` `=` `-`, normalisation du téléphone, formats de prix, quantité absente = 1.

#### US-BOT-11 : Valider le récapitulatif
En tant que vendeur, je veux cliquer sur « Valider », afin que ma commande soit enregistrée et que je reçoive sa référence.

**Critères d'acceptation**
- Given un brouillon `pending`, non expiré, appartenant au vendeur, When il clique sur `valider:<public_id>`, Then, dans une seule transaction : le brouillon est verrouillé, une commande est créée au statut `non_traitee` avec ses articles, la première ligne de `order_status_history` est écrite (`from_status` NULL, `to_status` `non_traitee`, `changed_by_user_id` NULL), une référence unique est générée, et le brouillon passe à `confirmed`.
- Given la création réussie, When le bot répond, Then le message est « Commande CMD-AAAAMMJJ-NNN enregistrée. » avec la référence réelle.
- Given un brouillon déjà `confirmed`, When le vendeur clique à nouveau sur Valider (double clic), Then aucune nouvelle commande n'est créée et le bot renvoie la référence de la commande existante.
- Given un brouillon `expired` ou `cancelled`, ou `pending` dont `expires_at` est dépassé, When le vendeur clique sur Valider, Then le bot répond « Ce récapitulatif n'est plus valide, renvoyez la commande. » et rien n'est créé.
- Given un brouillon appartenant au vendeur A, When le vendeur B clique sur un bouton portant son `public_id`, Then aucune action n'est effectuée sur ce brouillon (voir PO-10 pour le message).
- Given une erreur pendant la transaction, When elle survient, Then aucune donnée partielle n'est conservée (ni commande, ni article, ni historique, ni changement de statut du brouillon).

#### US-BOT-12 : Modifier une commande avant validation
En tant que vendeur, je veux cliquer sur « Modifier », afin de corriger ma commande en renvoyant un message.

**Critères d'acceptation**
- Given un brouillon `pending` du vendeur, When il clique sur `modifier:<public_id>`, Then le brouillon passe à `cancelled` et le bot demande de renvoyer le message corrigé en rappelant le modèle.
- Given un brouillon expiré ou annulé, When le vendeur clique sur Modifier, Then voir PO-11 (comportement non spécifié).

#### US-BOT-13 : Annuler un récapitulatif par bouton
En tant que vendeur, je veux cliquer sur « Annuler », afin d'abandonner une commande non validée.

**Critères d'acceptation**
- Given un brouillon `pending` du vendeur, When il clique sur `annuler:<public_id>`, Then le brouillon passe à `cancelled` et le bot répond « Commande annulée. »
- Given un brouillon annulé, When le vendeur clique ensuite sur Valider pour ce `public_id`, Then le bot répond « Ce récapitulatif n'est plus valide, renvoyez la commande. »

#### US-BOT-14 : Annuler le dernier brouillon par texte
En tant que vendeur, je veux taper `annuler`, afin d'annuler mon brouillon en attente le plus récent sans retrouver le bouton.

**Critères d'acceptation**
- Given un vendeur avec deux brouillons `pending`, When il envoie `annuler` (insensible à la casse et aux accents), Then seul le plus récent passe à `cancelled` ; l'autre reste `pending`.
- Given un vendeur sans brouillon `pending`, When il envoie `annuler`, Then voir PO-09 (réponse non spécifiée).
- Given la commande `annuler`, When elle est traitée, Then elle n'affecte jamais une commande déjà enregistrée (seuls les brouillons sont concernés).

#### US-BOT-15 : Expiration et nettoyage des brouillons
En tant qu'administrateur, je veux que les brouillons abandonnés expirent et soient purgés, afin que la base ne conserve pas de données inutiles.

**Critères d'acceptation**
- Given un brouillon `pending` dont `expires_at` est dépassé, When la tâche planifiée horaire s'exécute, Then il passe à `expired`.
- Given un brouillon `expired`, `cancelled` ou `confirmed` depuis plus de 7 jours, When la tâche s'exécute, Then il est supprimé.
- Given un brouillon `pending` non expiré, When la tâche s'exécute, Then il n'est pas modifié.
- Given un brouillon `confirmed` supprimé par la purge, When on consulte la commande associée, Then elle reste intacte.

#### US-BOT-16 : Fiabilité des réponses envoyées au vendeur
En tant que vendeur, je veux que les réponses du bot me parviennent malgré une erreur réseau ponctuelle, afin de ne pas rester sans réponse.

**Critères d'acceptation**
- Given un envoi vers Meta en échec réseau ou en erreur 5xx, When il échoue, Then une seule nouvelle tentative est effectuée après 2 secondes.
- Given un envoi vers Meta en erreur 4xx, When il échoue, Then aucune nouvelle tentative n'est faite et l'erreur est journalisée avec le corps de la réponse de Meta.
- Given une réponse au vendeur, When elle est envoyée, Then le destinataire `to` est le numéro tel que reçu dans `from` (format international sans `+`).
- Given un message à boutons, When il est envoyé, Then il comporte au plus 3 boutons, chaque titre fait au plus 20 caractères et le corps au plus 1 024 caractères.

### Domaine Commandes

#### US-CMD-01 : Référence unique de commande
En tant qu'administrateur, je veux que chaque commande ait une référence lisible et unique par jour, afin de relier sans ambiguïté un colis à sa commande.

**Critères d'acceptation**
- Given la 3e commande créée le 10/11/2026, When elle est enregistrée, Then sa référence est `CMD-20261110-003`.
- Given la première commande d'un nouveau jour, When elle est enregistrée, Then la séquence repart à `001`.
- Given deux validations simultanées le même jour, When elles s'exécutent, Then elles obtiennent deux références distinctes et consécutives.
- Given la génération de référence, When elle a lieu, Then elle se fait dans la transaction de création de la commande.

#### US-CMD-02 : Lister et rechercher les commandes
En tant qu'administrateur, je veux une liste paginée et filtrable des commandes, afin de retrouver rapidement celles à traiter.

**Critères d'acceptation**
- Given des commandes en base, When j'appelle `GET /api/v1/orders`, Then elles sont triées par date de création décroissante et la réponse a la forme `{ data: [...], meta: { page, limit, total } }`.
- Given `search=CMD-20261110`, ou un nom de client, ou un téléphone client, When j'appelle la liste, Then seules les commandes correspondant sur la référence, le nom ou le téléphone du client sont renvoyées.
- Given `status`, `vendorId`, `from`, `to` (dates `AAAA-MM-JJ`), When j'appelle la liste, Then les filtres sont appliqués et cumulables.
- Given `limit=101`, When j'appelle la liste, Then la requête est refusée (limite maximale 100) — voir PO-21 sur le mode de refus.
- Given aucun paramètre de pagination, When j'appelle la liste, Then `page=1` et `limit=20` sont appliqués.

#### US-CMD-03 : Compteurs par statut
En tant qu'administrateur, je veux voir le nombre de commandes par statut, afin de repérer immédiatement les commandes non traitées.

**Critères d'acceptation**
- Given des commandes dans différents statuts, When j'appelle `GET /api/v1/orders/counts`, Then je reçois le nombre de commandes pour chacun des 6 statuts, dont `non_traitee`.
- Given un statut sans commande, When j'appelle la route, Then son compteur vaut 0.

#### US-CMD-04 : Consulter le détail d'une commande
En tant qu'administrateur, je veux voir le détail complet d'une commande, afin de la préparer et de comprendre son historique.

**Critères d'acceptation**
- Given une commande existante, When j'appelle `GET /api/v1/orders/:id`, Then je reçois ses informations (référence, client, téléphone, lieu, notes, statut, total, dates), ses articles, son vendeur et l'historique de ses statuts.
- Given un identifiant inexistant, When j'appelle la route, Then la réponse est `404`.

#### US-CMD-05 : Corriger une commande
En tant qu'administrateur, je veux corriger les informations d'une commande pas encore préparée, afin de rectifier une erreur du vendeur sans la faire ressaisir.

**Critères d'acceptation**
- Given une commande `non_traitee` ou `validee`, When j'envoie `PATCH /api/v1/orders/:id` avec `customerName`, `customerPhone`, `deliveryLocation` et/ou `notes`, Then les champs fournis sont mis à jour.
- Given une commande `non_traitee` ou `validee`, When j'envoie `items`, Then la liste d'articles est entièrement remplacée et le total est recalculé par le serveur (somme quantité × prix unitaire).
- Given une commande en statut `prete`, `livree`, `echec` ou `annulee`, When j'envoie une correction, Then elle est refusée et la commande n'est pas modifiée (code d'erreur : voir PO-14).
- Given un corps contenant un champ non autorisé (par exemple `status`, `totalAmount`, `reference`), When je l'envoie, Then la requête est refusée par la validation (`forbidNonWhitelisted`).

#### US-CMD-06 : Changer le statut d'une commande
En tant qu'administrateur, je veux faire avancer une commande dans son cycle de vie, afin de suivre son traitement jusqu'à la livraison ou l'échec.

**Critères d'acceptation**
- Given une commande, When j'envoie `PATCH /api/v1/orders/:id/status` avec `{ status, comment? }` et que la transition est autorisée, Then le statut est mis à jour et une ligne est ajoutée dans `order_status_history` avec l'ancien statut, le nouveau, mon identifiant utilisateur, le commentaire éventuel et la date.
- Transitions autorisées (chacune doit être testée) :
  - `non_traitee` → `validee` | `annulee`
  - `validee` → `prete` | `annulee`
  - `prete` → `livree` | `echec` | `annulee`
  - `echec` → `prete` (nouvelle tentative)
- Given une transition non listée (exemples : `non_traitee` → `livree`, `livree` → `annulee`, `annulee` → `validee`, `echec` → `livree`, `echec` → `annulee`, même statut vers même statut), When je l'envoie, Then la réponse est `409` et ni le statut ni l'historique ne changent.
- Given un statut hors de la liste des 6 valeurs, When je l'envoie, Then la requête est refusée par la validation.
- Given `livree` et `annulee`, When ils sont atteints, Then aucune transition sortante n'est possible (états finaux).

### Domaine Vendeurs

#### US-VEN-01 : Lister les vendeurs
En tant qu'administrateur, je veux voir la liste des vendeurs, afin de gérer la liste blanche.

**Critères d'acceptation**
- Given des vendeurs actifs et inactifs, When j'appelle `GET /api/v1/vendors`, Then je reçois tous les vendeurs avec leur nom, leur numéro WhatsApp et leur état actif/inactif.

#### US-VEN-02 : Ajouter un vendeur
En tant qu'administrateur, je veux enregistrer un vendeur avec son numéro WhatsApp, afin de l'autoriser à passer commande via le bot.

**Critères d'acceptation**
- Given un corps `{ name, whatsappNumber }` valide, When j'appelle `POST /api/v1/vendors`, Then le vendeur est créé actif, avec un numéro normalisé en E.164 sans `+` (ex. `2250707070707`).
- Given un numéro saisi avec `+`, espaces ou séparateurs, When il est enregistré, Then il est stocké normalisé (voir PO-15 pour la saisie à 10 chiffres sans indicatif).
- Given un numéro déjà attribué à un autre vendeur (après normalisation), When je crée le vendeur, Then la création est refusée (code : voir PO-16).
- Given le vendeur créé, When il écrit au bot depuis ce numéro, Then il est reconnu (US-BOT-05).

#### US-VEN-03 : Modifier ou désactiver un vendeur
En tant qu'administrateur, je veux modifier le nom, le numéro ou l'état d'un vendeur, afin de tenir la liste blanche à jour sans perdre l'historique des commandes.

**Critères d'acceptation**
- Given un vendeur, When j'appelle `PATCH /api/v1/vendors/:id` avec `name`, `whatsappNumber` et/ou `isActive`, Then les champs fournis sont mis à jour (numéro normalisé et unique).
- Given un vendeur passé à `isActive = false`, When il écrit au bot, Then il reçoit « Ce numéro n'est pas autorisé à passer commande. »
- Given un vendeur désactivé, When on consulte ses anciennes commandes, Then elles restent consultables et rattachées à lui.
- Given l'API, When on cherche à supprimer un vendeur, Then aucune route de suppression n'existe.

### Domaine Authentification

#### US-AUTH-01 : Se connecter au backoffice
En tant qu'administrateur, je veux me connecter avec mon e-mail et mon mot de passe, afin d'accéder au backoffice.

**Critères d'acceptation**
- Given des identifiants valides, When j'appelle `POST /api/v1/auth/login` avec `{ email, password }`, Then je reçois `{ accessToken, user }`, le jeton étant un JWT valable 8 heures.
- Given un mot de passe ou un e-mail incorrect, When j'appelle la route, Then la réponse est `401` sans indiquer lequel des deux est faux (voir PO-17 pour un compte `is_active = 0`).
- Given 5 tentatives de connexion dans la même minute, When j'en fais une 6e, Then elle est refusée par la limitation de débit.
- Given le mot de passe, When il est stocké, Then il l'est sous forme de hachage argon2, jamais en clair.

#### US-AUTH-02 : Connaître l'utilisateur courant
En tant qu'administrateur, je veux récupérer mon profil à partir de mon jeton, afin que le backoffice affiche ma session.

**Critères d'acceptation**
- Given un JWT valide, When j'appelle `GET /api/v1/auth/me`, Then je reçois mes informations sans le hachage du mot de passe.
- Given un JWT expiré ou invalide, When j'appelle la route, Then la réponse est `401`.

#### US-AUTH-03 : Protéger les routes du backoffice
En tant qu'administrateur, je veux que toutes les routes métier exigent un jeton admin, afin que personne d'autre n'accède aux données.

**Critères d'acceptation**
- Given une route sous `/api/v1` autre que `POST /auth/login`, `GET|POST /whatsapp/webhook` et `GET /health`, When elle est appelée sans JWT, Then la réponse est `401`.
- Given une route publique de cette liste, When elle est appelée sans JWT, Then elle est accessible.
- Given une requête provenant d'une origine différente de `CORS_ORIGIN`, When le navigateur l'émet, Then elle est bloquée par la politique CORS.

#### US-AUTH-04 : Disposer d'un compte admin initial
En tant qu'administrateur, je veux que mon compte soit créé au déploiement, afin de me connecter sans route d'inscription publique.

**Critères d'acceptation**
- Given les variables `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, When le script de seed est exécuté sur une base vide, Then un utilisateur rôle `admin`, actif, est créé avec le mot de passe haché.
- Given l'API, When on cherche une route d'inscription, Then aucune n'existe.
- Given le seed exécuté une seconde fois, When il s'exécute, Then voir PO-18 (comportement non spécifié).

### Domaine Reçus

#### US-REC-01 : Imprimer le reçu d'une commande
En tant qu'administrateur, je veux générer le reçu PDF d'une commande, afin de le coller sur le colis.

**Critères d'acceptation**
- Given une commande existante, When j'appelle `GET /api/v1/receipts/:orderId`, Then je reçois un document `application/pdf`.
- Given le reçu, When il est ouvert, Then il contient : nom de l'entreprise (`RECEIPT_COMPANY_NAME`), référence en gros caractères lisible à distance, date et heure de création, nom du vendeur, nom, téléphone et lieu de livraison du client, tableau des articles (libellé, quantité, prix unitaire, sous-total), total, et notes si présentes.
- Given `RECEIPT_FORMAT` absent ou égal à `A5`, When le reçu est généré, Then il est au format A5 (148 × 210 mm).
- Given `RECEIPT_FORMAT=TICKET80`, When le reçu est généré, Then il est au format ticket de 80 mm de large.
- Given un `orderId` inexistant, When j'appelle la route, Then la réponse est `404`.

#### US-REC-02 : Imprimer les reçus en lot
En tant qu'administrateur, je veux générer en un seul PDF les reçus de plusieurs commandes, afin d'imprimer d'un coup les colis du jour.

**Critères d'acceptation**
- Given `{ orderIds: [...] }` contenant de 1 à 100 identifiants valides, When j'appelle `POST /api/v1/receipts/batch`, Then je reçois un seul PDF comportant un reçu par page.
- Given plus de 100 identifiants, When j'appelle la route, Then la requête est refusée par la validation.
- Given des identifiants inexistants, en double, ou une liste vide, When j'appelle la route, Then voir PO-19 (comportement non spécifié).

### Domaine Statistiques

#### US-STAT-01 : Vue d'ensemble de l'activité
En tant qu'administrateur, je veux des indicateurs globaux sur une période, afin de suivre l'activité et la qualité de livraison.

**Critères d'acceptation**
- Given une période `from`/`to`, When j'appelle `GET /api/v1/stats/overview`, Then je reçois : nombre total de commandes, montant total, répartition par statut, taux de livraison, taux d'échec et délai moyen de validation.
- Given 8 commandes `livree` et 2 `echec` sur la période, When je consulte, Then le taux de livraison vaut 8 ÷ 10 = 80 % et le taux d'échec 2 ÷ 10 = 20 %.
- Given des commandes passées au statut `validee`, When le délai moyen de validation est calculé, Then il vaut la moyenne, en heures, entre `orders.created_at` et la première entrée `validee` de leur historique.
- Given aucune commande `livree` ni `echec` sur la période, When je consulte, Then voir PO-20 (division par zéro).
- Given un jeu de données de test, When je consulte, Then les valeurs correspondent aux valeurs attendues calculées à la main.

#### US-STAT-02 : Activité par vendeur
En tant qu'administrateur, je veux le nombre de commandes et le montant par vendeur sur une période, afin de comparer l'activité des vendeurs.

**Critères d'acceptation**
- Given une période, When j'appelle `GET /api/v1/stats/by-vendor`, Then je reçois, pour chaque vendeur, le nombre de commandes et le montant cumulé sur la période.

#### US-STAT-03 : Activité par jour
En tant qu'administrateur, je veux le nombre de commandes par jour sur une période, afin de suivre l'évolution de l'activité.

**Critères d'acceptation**
- Given une période, When j'appelle `GET /api/v1/stats/by-day`, Then je reçois le nombre de commandes pour chaque jour de la période.

---

## Règles métier et cas limites consolidés

### Parsing du message de commande (`parseOrder`, fonction pure)
- **R-P1 Libellés** : reconnus sans tenir compte de la casse ni des accents, suivis de `:`, `=` ou `-`.
  - Nom : `nom`, `client`
  - Téléphone : `telephone`, `tel`, `numero`, `contact`
  - Lieu : `lieu`, `adresse`, `livraison`, `lieu de livraison`
  - Articles : `articles`, `article`, `commande`, `produits`
- **R-P2 Portée d'une valeur** : la valeur d'un libellé s'étend jusqu'au libellé suivant. Les lignes sous `Articles`, avec ou sans puce `-` ou `•`, font partie de la liste d'articles.
- **R-P3 Téléphone client** : retirer espaces, points et tirets, puis le préfixe `+225`, `00225` ou `225` ; le résultat doit contenir exactement 10 chiffres. Le préfixe opérateur n'est pas contrôlé. Stockage : 10 chiffres (ex. `0707070707`).
- **R-P4 Articles** : séparés par virgule, point-virgule ou retour à la ligne. Format `[quantité] libellé x prix`, prix **unitaire**, signe `x`, `X`, `×` ou `*`. Quantité absente = 1.
- **R-P5 Prix acceptés** : `15000`, `15 000`, `15.000`, `15000F`, `15000 FCFA`.
- **R-P6 Limites** : 1 à 30 articles ; quantité 1 à 999 ; prix unitaire 1 à 10 000 000 ; message de 2 000 caractères au plus.
- **R-P7 Total** : somme des quantités × prix unitaires, toujours calculée par le serveur.
- **R-P8 Erreurs** : toutes listées en une fois, en français, suivies du modèle.

### Déroulement d'un message entrant (ordre imposé)
1. Identifier le vendeur actif par `from`. Inconnu ou inactif : message de refus, journalisation, arrêt.
2. Clic de bouton : lire `action:public_id` et appliquer l'action.
3. Sinon, commande de secours (`modele`, `aide`, `mes commandes`, `annuler`) : l'exécuter.
4. Sinon, `parseOrder`. Erreur : liste des erreurs + modèle.
5. Succès : créer le brouillon (`pending`, TTL 30 min, `public_id` 12 caractères).
6. Envoyer le récapitulatif avec les trois boutons.

### Brouillons
- Le bot est sans état ; le seul état conservé est le brouillon en base.
- Plusieurs brouillons `pending` peuvent coexister pour un même vendeur ; chaque bouton est lié à son `public_id`.
- Un vendeur ne peut agir que sur ses propres brouillons.
- Valider exige : brouillon `pending`, appartenant au vendeur, non expiré. Double clic sur un brouillon `confirmed` : renvoi de la référence existante, pas de doublon.
- Brouillon expiré ou annulé : « Ce récapitulatif n'est plus valide, renvoyez la commande. »
- Tâche horaire : `pending` dépassés → `expired` ; suppression des brouillons `expired`, `cancelled`, `confirmed` de plus de 7 jours.

### Commandes et statuts
- Création uniquement par le bot (statut initial `non_traitee`, historique avec `changed_by_user_id` NULL).
- Transitions autorisées : `non_traitee` → `validee` | `annulee` ; `validee` → `prete` | `annulee` ; `prete` → `livree` | `echec` | `annulee` ; `echec` → `prete`. Toute autre transition : `409`.
- Chaque changement de statut écrit une ligne d'historique avec l'utilisateur.
- Correction (`PATCH /orders/:id`) autorisée uniquement en `non_traitee` ou `validee` ; remplacement des articles = recalcul du total.
- Référence `CMD-AAAAMMJJ-NNN`, séquence journalière, générée dans la transaction de création avec verrou de ligne sur le compteur du jour.
- Montants : entiers en XOF, sans décimale. Dates stockées en UTC (identique à l'heure d'Abidjan).

### Vendeurs
- Numéro WhatsApp stocké en E.164 sans `+`, unique.
- Pas de suppression ; un vendeur lié à des commandes se désactive.

### Messages du bot imposés par le DAT (texte exact)
| Situation | Message |
| --- | --- |
| Numéro inconnu ou désactivé | « Ce numéro n'est pas autorisé à passer commande. » |
| Type de message non texte | « Seuls les messages texte sont acceptés. Tapez *modele* pour recevoir le modèle. » |
| Validation réussie | « Commande CMD-... enregistrée. » |
| Annulation par bouton | « Commande annulée. » |
| Brouillon expiré ou annulé | « Ce récapitulatif n'est plus valide, renvoyez la commande. » |
| Exemples d'erreur de parsing | « Téléphone invalide : 10 chiffres attendus », « Prix manquant pour : sac noir » |

Les textes de `aide`, de la demande de correction (Modifier), de la demande de scission (récapitulatif > 1 024 caractères) et de la réponse `mes commandes` ne sont pas fixés mot pour mot par le DAT (voir PO-08).

---

## Exigences non fonctionnelles

### Sécurité
- NF-S1 Webhook : signature HMAC-SHA256 vérifiée en temps constant sur les octets bruts ; jeton de vérification secret ; journalisation de tout appel.
- NF-S2 Aucun secret dans le code ni dans Git : toute la configuration passe par `.env`, validée au démarrage ; l'application refuse de démarrer s'il manque une variable.
- NF-S3 Numéros inconnus : aucune action, aucune donnée renvoyée.
- NF-S4 Accès base exclusivement par requêtes paramétrées (jamais de concaténation SQL).
- NF-S5 Authentification JWT (8 h) pour toutes les routes non publiques ; rôle unique `admin` ; mots de passe hachés argon2.
- NF-S6 Limitation de débit : 5 tentatives par minute sur `/auth/login`.
- NF-S7 CORS limité à `CORS_ORIGIN`. Documentation Swagger sur `/api/docs`, désactivée en production.
- NF-S8 HTTPS obligatoire (exigence de Meta), assuré par le reverse proxy ; l'application n'écoute que sur `127.0.0.1`.
- NF-S9 Validation stricte des entrées : propriétés non déclarées refusées, conversion des types.
- NF-S10 Le backend est la seule source de vérité : le backoffice n'accède jamais directement à la base.

### Journalisation et conservation
- NF-L1 Logs applicatifs JSON structurés.
- NF-L2 Les logs ne contiennent jamais de token ni de mot de passe.
- NF-L3 Les téléphones des clients sont masqués dans les logs applicatifs (format `07****0707`) ; le payload complet reste dans `webhook_logs`.
- NF-L4 Tout payload POST du webhook est enregistré dans `webhook_logs` avec l'indicateur de validité de signature.
- NF-L5 `webhook_logs` est purgé au-delà de 90 jours (tâche quotidienne).
- NF-L6 Les erreurs 4xx de Meta sont journalisées avec le corps de la réponse.

### Volumétrie et performance
- NF-V1 Dimensionnement : environ 20 commandes par jour, 5 vendeurs au maximum, 1 administrateur.
- NF-V2 Le webhook répond `200` immédiatement après contrôle de signature et enregistrement ; le traitement est asynchrone dans le même processus (pas de file externe).
- NF-V3 Le backoffice rafraîchit par interrogation de l'API toutes les 20 à 30 s ; pas de push temps réel.
- NF-V4 Pagination limitée à 100 éléments par page ; lot de reçus limité à 100 commandes.

### Fiabilité et cohérence
- NF-F1 Idempotence des messages Meta sur `wamid`.
- NF-F2 Création de commande transactionnelle et atomique ; références uniques même en cas de créations simultanées.
- NF-F3 Une exception du traitement d'un message ne remonte jamais à la réponse du webhook.
- NF-F4 Envoi vers Meta : une seule nouvelle tentative après 2 s sur erreur réseau ou 5xx.
- NF-F5 `GET /health` (public) renvoie `200` si l'application et la base répondent.

### Conventions d'API
- JSON en `camelCase`, base en `snake_case`.
- Erreurs au format `{ statusCode, message, error }`.
- Toutes les routes sous `/api/v1`.

### Localisation
- Langue des messages du bot : français. Pays : Côte d'Ivoire. Monnaie : XOF (affichage du type « 15 000 F »). Fuseau `Africa/Abidjan`.

### Contexte d'exploitation (rappel, hors spécification fonctionnelle)
- Numéro de test Meta : le bot ne répond qu'aux destinataires déclarés dans la console Meta (5 au maximum) ; le passage en production ne change que `PHONE_NUMBER_ID` et `WHATSAPP_TOKEN`.
- Écarts d'outillage signalés par `CLAUDE.md` (le scaffold prime sur le DAT) : Vitest au lieu de Jest, pnpm au lieu de npm, oxlint au lieu d'ESLint, NestJS 12 en ESM. Les commandes `npm ci`, `npm run start` du DAT (section 9) sont à lire avec cet outillage.

## Contraintes exprimées par le client
- Marché : Côte d'Ivoire, numéros +225 à 10 chiffres ; langue française.
- Monnaie : francs CFA (XOF), entiers.
- Canal vendeur : WhatsApp Cloud API uniquement, messages texte et boutons de réponse ; pas de message modèle payant (le vendeur écrit toujours en premier, fenêtre de 24 h).
- Paiement en ligne, livraison, livreurs, frais de livraison : hors application.
- Un seul utilisateur backoffice (admin), pas d'inscription publique.
- Pas de Redis, de file de messages ni de WebSocket.
- Hébergement sur un VPS Debian, HTTPS via reverse proxy.
- Reçus PDF au format A5 ou ticket 80 mm.

---

## Points ouverts / ambiguïtés

Chaque point est relevé dans le DAT, non tranché ici, et accompagné d'une proposition à valider.

- [ ] **PO-01 — Débordement du total (contradiction chiffrée).** `orders.total_amount` est un `INT UNSIGNED` (max ≈ 4,29 milliards), alors que les limites de parsing autorisent 30 articles × 999 × 10 000 000 ≈ 299,7 milliards ; `order_items.unit_price` est aussi un INT et la ligne quantité × prix peut atteindre ≈ 10 milliards. *Proposition :* ajouter une limite métier sur le total (ex. ≤ 4 294 967 295 ou un plafond plus réaliste fixé par le client) avec message d'erreur dédié, ou élargir le type (décision de l'architecte).
- [ ] **PO-02 — Liste des routes publiques incomplète.** La section 7 dit « sauf `POST /auth/login` et le webhook, marqués `@Public()` », mais `GET /health` est aussi déclaré public plus bas. *Proposition :* considérer `/health` comme public (déjà retenu dans US-AUTH-03), à confirmer.
- [ ] **PO-03 — Préfixe `/api/v1` du webhook et de `/health`.** La section 5 cite `/whatsapp/webhook`, la section 9 donne `https://api.../api/v1/whatsapp/webhook`. Pour `/health`, rien n'est dit. *Proposition :* tout sous `/api/v1`, y compris `/health`, et indiquer l'URL exacte à la supervision.
- [ ] **PO-04 — Champ `notes` non alimenté par le bot.** La table `orders` et le reçu prévoient des notes, mais le modèle de commande n'a pas de libellé `Notes`. Seul l'admin peut donc en saisir. *Proposition :* confirmer que c'est voulu ; sinon, ajouter un libellé facultatif `Notes` au parsing (à valider par le client car cela modifie le modèle).
- [ ] **PO-05 — Format du récapitulatif pour la quantité 1.** L'exemple affiche « = 30 000 F » pour 2 articles mais pas de sous-total pour « 1 × sac noir — 8 000 F ». *Proposition :* afficher le sous-total uniquement si la quantité est supérieure à 1, comme l'exemple.
- [ ] **PO-06 — Récapitulatif de plus de 1 024 caractères.** Le déroulement crée le brouillon (étape 5) avant l'envoi (étape 6) ; on ignore si le brouillon doit être créé, et le texte exact de la demande de scission. Le message vendeur autorise 2 000 caractères et 30 articles, ce qui rend le cas fréquent. *Proposition :* contrôler la longueur avant de créer le brouillon ; ne rien créer et renvoyer un message fixe en français demandant de scinder.
- [ ] **PO-07 — Ambiguïtés de parsing des articles.** (a) Le séparateur `x` peut apparaître dans un libellé (« box », « taxi », « robe XL x 15000 ») ; (b) la virgule sépare les articles, donc un prix « 15,000 » serait coupé ; (c) un libellé commençant par un nombre (« 3 pièces wax x 5000 ») est ambigu avec la quantité ; (d) libellé `livraison` (lieu) vs mot « livraison » dans le texte. *Proposition :* prendre la dernière occurrence d'un signe de multiplication suivi d'un prix ; ne pas accepter la virgule comme séparateur de milliers (erreur explicite) ; exiger que le libellé de ligne soit en début de ligne ; lister ces cas dans les tests.
- [ ] **PO-08 — Textes non fixés.** Les textes de `aide`, de Modifier, de la scission, de `mes commandes` (dont le libellé affiché des statuts, ex. `non_traitee` → « Non traitée »), et des erreurs autres que les deux exemples, ne sont pas définis. *Proposition :* le client fournit ou valide un catalogue de messages avant l'étape 5 (Bot).
- [ ] **PO-09 — `annuler` sans brouillon / `mes commandes` sans commande.** Réponse non spécifiée. *Proposition :* « Aucune commande en attente à annuler. » et « Vous n'avez encore aucune commande. »
- [ ] **PO-10 — Clic sur le brouillon d'un autre vendeur ou `public_id` inconnu / identifiant de bouton mal formé.** Le DAT interdit l'action mais ne fixe pas la réponse. *Proposition :* répondre « Ce récapitulatif n'est plus valide, renvoyez la commande. » pour ne divulguer aucune information.
- [ ] **PO-11 — Modifier / Annuler sur un brouillon non `pending`.** Comportement non spécifié, en particulier sur un brouillon `confirmed` (risque de laisser croire que la commande enregistrée est annulée). *Proposition :* ne rien modifier ; pour `confirmed`, répondre que la commande CMD-... est déjà enregistrée et que seule l'administration peut l'annuler ; pour `expired`/`cancelled`, message « n'est plus valide ».
- [ ] **PO-12 — Annulation d'une commande déjà enregistrée par le vendeur.** Aucun moyen prévu côté vendeur (seul l'admin change les statuts). *Proposition :* confirmer que c'est voulu (le vendeur contacte l'admin hors application).
- [ ] **PO-13 — Ordre des contrôles pour les messages non texte.** Le module WhatsApp répond au type non supporté, mais le bot contrôle la liste blanche en premier. Un numéro inconnu qui envoie une image doit-il recevoir le message « non autorisé » ou « seuls les messages texte » ? *Proposition :* contrôler d'abord la liste blanche (cohérent avec « numéros inconnus : aucune donnée renvoyée »).
- [ ] **PO-14 — Code d'erreur pour une correction refusée** (`PATCH /orders/:id` hors `non_traitee`/`validee`) et règles de validation des champs corrigés (téléphone à 10 chiffres ? limites articles identiques au parsing ? longueurs max 120/255/190 caractères ?). *Proposition :* `409`, et réutiliser les mêmes règles que `parseOrder` pour téléphone, quantités, prix et nombre d'articles. Préciser aussi si une correction est tracée dans l'historique (aujourd'hui seuls les statuts le sont).
- [ ] **PO-15 — Normalisation du numéro vendeur.** « E.164 sans `+` » n'indique pas comment traiter une saisie à 10 chiffres locale (`0707070707`) ni si les numéros étrangers sont acceptés. *Proposition :* une saisie à 10 chiffres est préfixée par `225` ; accepter `+225`, `00225`, `225` ; refuser le reste (à confirmer).
- [ ] **PO-16 — Code d'erreur pour un numéro vendeur en doublon.** *Proposition :* `409 Conflict`.
- [ ] **PO-17 — Utilisateur `is_active = 0`.** Le champ existe mais aucune règle ni route ne le gère (pas de changement de mot de passe non plus). *Proposition :* refuser la connexion d'un compte inactif (`401`) ; gestion du compte uniquement via seed/base, à confirmer.
- [ ] **PO-18 — Ré-exécution du seed.** Comportement non spécifié si l'admin existe déjà. *Proposition :* seed idempotent (ne recrée pas, ne remplace pas le mot de passe).
- [ ] **PO-19 — Reçus groupés : cas limites.** Identifiants inexistants, doublons, liste vide, ordre des pages, commandes `annulee`. *Proposition :* liste de 1 à 100 identifiants ; `404` si un identifiant est inconnu ; doublons dédoublonnés ; ordre de la liste reçue ; reçu possible quel que soit le statut.
- [ ] **PO-20 — Définition précise des statistiques.** (a) La période `from`/`to` porte-t-elle sur `created_at` des commandes ou sur la date du changement de statut ? (b) Bornes incluses ? (c) Période par défaut si absente ? (d) Le « montant total » inclut-il les commandes `annulee` / `echec` ? (e) Taux quand `livree + echec = 0` ? (f) Délai moyen quand aucune commande n'est validée ? (g) `by-day` renvoie-t-il les jours sans commande à 0 ? (h) `by-vendor` inclut-il les vendeurs sans commande ou inactifs ? *Proposition :* période sur `created_at`, bornes incluses en jours entiers ; montant hors `annulee` ; taux et délai à `null` quand le dénominateur est nul ; jours à 0 inclus ; tous les vendeurs listés.
- [ ] **PO-21 — Validation de la pagination et des filtres.** `limit > 100` : refus `400` ou plafonnement à 100 ? Bornes `from`/`to` de `GET /orders` inclusives ? Recherche par téléphone sur valeur normalisée ? Pagination de `GET /vendors` ? *Proposition :* `400` si `limit > 100` ; bornes incluses (jour entier) ; recherche téléphone sur les chiffres saisis ; pas de pagination des vendeurs (5 au maximum).
- [ ] **PO-22 — Durée de vie du brouillon.** Le DAT fixe « 30 minutes » en section 6 et prévoit `DRAFT_TTL_MINUTES` en section 8. *Proposition :* la variable fait foi, 30 par défaut.
- [ ] **PO-23 — Dépassement de la séquence journalière.** Le format `NNN` est limité à 999 commandes par jour. Non critique au volume prévu, mais le comportement au-delà n'est pas défini. *Proposition :* autoriser 4 chiffres au-delà de 999 (la colonne `reference` fait 24 caractères).
- [ ] **PO-24 — Perte de message en cas d'échec après enregistrement du `wamid`.** Le `wamid` est inséré avant le traitement ; si le traitement échoue ensuite, un renvoi de Meta sera ignoré et le vendeur peut rester sans réponse. *Proposition :* accepter ce risque au volume prévu (l'erreur est journalisée), ou décision de l'architecte.
- [ ] **PO-25 — Purge de `processed_messages`.** Aucune purge n'est prévue (contrairement à `webhook_logs` et aux brouillons). *Proposition :* sans impact au volume prévu ; éventuellement aligner sur 90 jours (à valider).
- [ ] **PO-26 — Journalisation des appels GET de vérification.** « Journalisation de tout appel » (section 8) alors que seule la journalisation des POST dans `webhook_logs` est décrite. *Proposition :* journaliser les GET dans les logs applicatifs uniquement.
- [ ] **PO-27 — Ambiguïté de vocabulaire « Valider ».** Le bouton vendeur « Valider » crée une commande `non_traitee`, tandis que le statut `validee` est posé par l'admin. Le délai moyen de validation mesure la validation admin. *Proposition :* documenter cette distinction dans le backoffice et l'aide du bot.
- [ ] **PO-28 — Notification du vendeur lors des changements de statut.** Rien n'est prévu (cohérent avec l'absence de templates payants). *Proposition :* confirmer que le vendeur s'informe uniquement via `mes commandes`.
- [ ] **PO-29 — Payload webhook non JSON ou de structure inattendue** (signature valide). Non spécifié. *Proposition :* journaliser, répondre `200`, ne rien traiter.
- [ ] **PO-30 — Version de Node.js.** Le DAT cite Node 20 LTS (sections 2 et 9) alors que le scaffold réel utilise NestJS 12 / TypeScript 6 (CLAUDE.md). La compatibilité est à vérifier par l'architecte avant la mise en ligne (point technique, hors décision BA).
