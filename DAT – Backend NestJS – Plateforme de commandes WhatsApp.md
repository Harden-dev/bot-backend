# DAT – Backend NestJS – Plateforme de commandes WhatsApp

Nov 13, 2026 · @Michel

Le backend NestJS reçoit les commandes que des vendeurs écrivent à un bot WhatsApp, les enregistre en MySQL et alimente le backoffice Vue.js d'un administrateur unique, qui les traite et imprime les reçus à coller sur les colis.

## 1. Contexte, objectifs et périmètre

**Fonctionnement.** Le bot ne mène pas de conversation libre : il reçoit un message structuré, le vérifie, renvoie un récapitulatif et attend un clic sur **Valider**. Une fois validée, la commande entre en base avec le statut « non traitée ».

**Hypothèses de dimensionnement**

- 20 commandes par jour, 5 vendeurs au maximum, 1 seul utilisateur du backoffice (rôle admin).
- Les frais de livraison et la livraison elle-même se font hors application.
- Le vendeur écrit toujours en premier : le bot répond dans la fenêtre de 24 h de WhatsApp, sans message modèle (template) payant.
- Pays : Côte d'Ivoire (téléphones +225, 10 chiffres). Langue de l'interface et des messages : français.

**Inclus**

- Webhook WhatsApp Cloud API (vérification, signature, journalisation, idempotence).
- Identification du vendeur par son numéro WhatsApp (liste blanche).
- Parsing du modèle de commande, récapitulatif, boutons Valider / Modifier / Annuler.
- Création de la commande avec référence unique, articles, prix et total.
- API REST du backoffice : commandes, vendeurs, statuts, statistiques, authentification JWT.
- Génération de reçus PDF (unitaire et groupé).

**Exclus**

- Gestion des livreurs, suivi de livraison, paiement en ligne.
- Catalogue produits : les articles sont saisis librement par le vendeur.
- Redis, files de messages, WebSocket : inutiles à ce volume (le backoffice interroge l'API toutes les 20 à 30 s).

## 2. Architecture générale et stack technique

Un seul service NestJS (monolithe modulaire) porte le webhook, le bot et l'API du backoffice, au-dessus d'une base MySQL unique. Ce choix suffit pour 20 commandes par jour et reste simple à déployer sur le VPS Debian.

| Couche | Choix | Rôle |
| --- | --- | --- |
| Runtime | Node.js 20 LTS, TypeScript strict | Exécution du backend |
| Framework | NestJS 10+ (Express) | Modules, injection de dépendances, guards |
| Base de données | MySQL 8 (utf8mb4) | Stockage unique |
| ORM | Prisma | Schéma typé, migrations, transactions |
| Validation | class-validator + class-transformer | DTO des requêtes |
| Authentification | @nestjs/jwt, passport-jwt, argon2 | Connexion admin |
| Appels Meta | @nestjs/axios | Envoi de messages WhatsApp |
| PDF | pdfmake | Reçus A5 ou ticket 80 mm |
| Tâches planifiées | @nestjs/schedule | Nettoyage des brouillons expirés |
| Configuration | @nestjs/config + Joi | Validation du `.env` au démarrage |
| Logs | nestjs-pino | Logs JSON structurés |
| Tests | Jest + supertest | Unitaires et bout en bout |
| Exposition | Nginx (reverse proxy, HTTPS) + PM2 | Meta impose HTTPS |

**Principes**

- Le webhook répond `200` immédiatement après contrôle de signature et enregistrement du payload, puis traite le message en tâche asynchrone dans le même processus (pas de file externe).
- Chaque message Meta est traité une seule fois (idempotence sur `wamid`).
- Le backend est la seule source de vérité : le backoffice n'accède jamais directement à MySQL.

## 3. Structure du projet NestJS et modules

Le code est découpé en huit modules, un par domaine, avec une frontière claire entre le bot (WhatsApp) et le backoffice (REST).

```text
src/
  main.ts
  app.module.ts
  common/            guards, décorateurs, filtres d'erreur, utilitaires (phone, money)
  config/            validation du .env
  prisma/            PrismaModule + PrismaService
  auth/              login admin, JWT, guards de rôle
  users/             compte admin
  vendors/           vendeurs et liste blanche des numéros
  orders/            commandes, articles, statuts, historique
  whatsapp/          webhook, signature, client d'envoi Meta, journaux
  bot/               parsing, brouillons, machine à états, messages
  receipts/          génération PDF
  stats/             agrégats du tableau de bord
prisma/
  schema.prisma
  migrations/
  seed.ts            crée l'admin initial
test/                tests e2e
```

| Module | Responsabilité | Dépend de |
| --- | --- | --- |
| `whatsapp` | Recevoir et authentifier les webhooks, envoyer texte et boutons | `bot` |
| `bot` | Interpréter le message du vendeur, gérer le brouillon, créer la commande | `vendors`, `orders`, `whatsapp` |
| `orders` | Règles métier des commandes et des statuts | `prisma` |
| `vendors` | CRUD vendeurs, recherche par numéro | `prisma` |
| `receipts` | Produire les PDF | `orders` |
| `stats` | Compteurs et agrégats | `prisma` |
| `auth` / `users` | Connexion admin, protection des routes | `prisma` |

Dépendance à sens unique : `whatsapp` appelle `bot`, `bot` appelle `orders` et `vendors`. `orders` ne connaît ni WhatsApp ni le bot.

## 4. Modèle de données MySQL

Neuf tables suffisent. Les montants sont des entiers en francs CFA (XOF, sans décimale). Les dates sont stockées en UTC, qui coïncide avec l'heure d'Abidjan. Claude Code traduit ce schéma en `schema.prisma`, avec les mêmes noms, types, index et contraintes.

| Table | Rôle | Clés et index notables |
| --- | --- | --- |
| `vendors` | Vendeurs autorisés à commander | `whatsapp_number` unique |
| `users` | Compte admin du backoffice | `email` unique |
| `orders` | Une ligne par commande | `reference` unique ; index `status`, `vendor_id`, `created_at` |
| `order_items` | Articles d'une commande | FK `order_id` (suppression en cascade) |
| `order_status_history` | Traçabilité des changements de statut | index `order_id` |
| `order_drafts` | Brouillons en attente de validation | `public_id` unique ; index `vendor_id`, `expires_at` |
| `daily_counters` | Séquence journalière pour la référence | clé primaire `day` |
| `processed_messages` | Idempotence des webhooks | `wamid` unique |
| `webhook_logs` | Payload brut pour diagnostic | index `created_at` |

**Statuts de commande** : `non_traitee` → `validee` → `prete` → `livree`, avec sorties possibles vers `echec` ou `annulee`. Transitions autorisées : `non_traitee` → `validee` | `annulee` ; `validee` → `prete` | `annulee` ; `prete` → `livree` | `echec` | `annulee` ; `echec` → `prete` (nouvelle tentative).

**Référence** : `CMD-AAAAMMJJ-NNN` (ex. `CMD-20261110-003`), générée dans la transaction de création en incrémentant `daily_counters.last_seq` avec un verrou de ligne.

```sql
CREATE TABLE vendors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  whatsapp_number VARCHAR(20) NOT NULL UNIQUE,   -- E.164 sans '+', ex. 2250707070707
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin') NOT NULL DEFAULT 'admin',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(24) NOT NULL UNIQUE,
  vendor_id BIGINT UNSIGNED NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,           -- 10 chiffres ivoiriens, ex. 0707070707
  delivery_location VARCHAR(255) NOT NULL,
  notes TEXT NULL,
  status ENUM('non_traitee','validee','prete','livree','echec','annulee') NOT NULL DEFAULT 'non_traitee',
  total_amount INT UNSIGNED NOT NULL DEFAULT 0,  -- XOF
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_orders_status (status),
  KEY idx_orders_vendor (vendor_id),
  KEY idx_orders_created (created_at),
  CONSTRAINT fk_orders_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(190) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  unit_price INT UNSIGNED NOT NULL,              -- XOF
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NULL,       -- NULL = création par le bot
  comment VARCHAR(255) NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_hist_order (order_id),
  CONSTRAINT fk_hist_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_drafts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(12) NOT NULL UNIQUE,            -- inclus dans l'id des boutons
  vendor_id BIGINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,                         -- nom, téléphone, lieu, articles parsés, total
  status ENUM('pending','confirmed','cancelled','expired') NOT NULL DEFAULT 'pending',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  KEY idx_drafts_vendor (vendor_id),
  KEY idx_drafts_expires (expires_at),
  CONSTRAINT fk_drafts_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE daily_counters (
  day DATE PRIMARY KEY,
  last_seq INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE processed_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  wamid VARCHAR(120) NOT NULL UNIQUE,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE webhook_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  signature_valid TINYINT(1) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_logs_created (created_at)
) ENGINE=InnoDB;
```

## 5. Module WhatsApp : webhook, signature, idempotence, envoi

Le module `whatsapp` est la seule porte d'entrée et de sortie vers Meta. Il authentifie chaque appel, évite les doublons et transmet au module `bot` des messages déjà normalisés.

**Endpoints**

| Méthode et route | Usage | Comportement |
| --- | --- | --- |
| `GET /whatsapp/webhook` | Vérification par Meta | Si `hub.mode` = `subscribe` et `hub.verify_token` = `WEBHOOK_VERIFY_TOKEN`, renvoyer `hub.challenge` en texte brut avec le code 200 ; sinon 403 |
| `POST /whatsapp/webhook` | Réception des événements | Contrôler la signature, journaliser, répondre 200 tout de suite, traiter ensuite |

**Traitement d'un POST, dans l'ordre**

1. Activer `rawBody: true` dans `NestFactory.create` et lire `req.rawBody` : la signature se calcule sur les octets exacts reçus, pas sur le JSON réécrit.
2. Calculer `HMAC-SHA256(rawBody, META_APP_SECRET)` en hexadécimal, préfixer par `sha256=` et comparer à l'en-tête `X-Hub-Signature-256` avec `crypto.timingSafeEqual`. Signature absente ou fausse : enregistrer le payload avec `signature_valid = 0` dans `webhook_logs`, répondre 403, ne rien traiter.
3. Signature valide : enregistrer le payload brut dans `webhook_logs`, répondre 200 immédiatement.
4. Après la réponse, parcourir `entry[].changes[].value.messages[]`. Les événements `statuses[]` (accusés de lecture ou de livraison) sont ignorés.
5. Pour chaque message, insérer son `id` (le `wamid`) dans `processed_messages`. Une violation d'unicité signifie que Meta a renvoyé l'événement : le message est ignoré.
6. Normaliser en objet interne `{ wamid, from, type, text?, buttonId? }` puis appeler `BotService.handle(message)`.
7. Toute exception du traitement est capturée et journalisée : elle ne doit jamais remonter au webhook.

**Types de messages acceptés**

- `text` : le corps du message (`text.body`).
- `interactive` avec `button_reply` : l'identifiant du bouton (`interactive.button_reply.id`).
- Tout autre type (image, audio, document, sticker) : réponse « Seuls les messages texte sont acceptés. Tapez *modele* pour recevoir le modèle. »

**Envoi vers Meta** (`WhatsappClient`)

- Appel `POST https://graph.facebook.com/{GRAPH_API_VERSION}/{PHONE_NUMBER_ID}/messages`, en-tête `Authorization: Bearer {WHATSAPP_TOKEN}`. La version de l'API est une variable du `.env` : prendre la version stable indiquée dans la documentation Meta au moment du développement.
- `sendText(to, body)` envoie `{ messaging_product: "whatsapp", to, type: "text", text: { body } }`.
- `sendButtons(to, body, buttons)` envoie un message `type: "interactive"` avec `interactive.type = "button"`, au plus 3 boutons `{ type: "reply", reply: { id, title } }`. Limites WhatsApp : titre de bouton 20 caractères, corps 1024 caractères.
- Une erreur réseau ou 5xx déclenche une seule nouvelle tentative après 2 s ; une erreur 4xx est journalisée avec le corps de la réponse de Meta.
- Le champ `to` est le numéro au format international sans `+`, tel que reçu dans `from`.

**Cas du numéro de test.** Tant que le numéro définitif n'est pas enregistré, le bot répond uniquement aux destinataires ajoutés dans la console Meta (5 au maximum). Aucun changement de code n'est nécessaire au passage en production, seules les variables `PHONE_NUMBER_ID` et `WHATSAPP_TOKEN` changent.

## 6. Bot : parsing du modèle, brouillons, boutons, création de commande

Le bot est sans état : chaque message est interprété seul, et le seul état conservé est le brouillon en base. Il n'y a donc pas de machine à états de conversation à maintenir.

**Modèle envoyé par le vendeur** (renvoyé par le bot quand il reçoit `modele`)

```text
Nom: Awa Koné
Téléphone: 0707070707
Lieu: Cocody Angré 8e tranche
Articles: 2 robes bleues x 15000, 1 sac noir x 8000
```

**Règles de parsing** (module `bot`, fonction pure `parseOrder(text)`, entièrement testée)

- Les libellés sont reconnus sans tenir compte de la casse ni des accents, suivis de `:`, `=` ou `-`. Variantes acceptées : nom (`nom`, `client`), téléphone (`telephone`, `tel`, `numero`, `contact`), lieu (`lieu`, `adresse`, `livraison`, `lieu de livraison`), articles (`articles`, `article`, `commande`, `produits`).
- La valeur d'un libellé va jusqu'au libellé suivant. Les lignes supplémentaires sous `Articles` (avec ou sans puce `-` ou `•`) font partie de la liste d'articles.
- **Téléphone** : retirer espaces, points, tirets, puis le préfixe `+225`, `00225` ou `225`. Le résultat doit contenir exactement 10 chiffres. Le préfixe opérateur n'est pas contrôlé.
- **Articles** : séparés par une virgule, un point-virgule ou un retour à la ligne. Chaque article suit `[quantité] libellé x prix`, où le prix est **unitaire** et le signe est `x`, `X`, `×` ou `*`. Quantité absente = 1. Prix tolérés : `15000`, `15 000`, `15.000`, `15000F`, `15000 FCFA`.
- **Limites** : 1 à 30 articles, quantité de 1 à 999, prix de 1 à 10 000 000, message de 2 000 caractères au plus.
- Le total est la somme de quantité × prix unitaire, calculée par le serveur.
- Les erreurs sont toutes listées en une fois, en français, par exemple « Téléphone invalide : 10 chiffres attendus » ou « Prix manquant pour : sac noir », suivies du modèle.

**Commandes de secours** (texte seul, insensible à la casse et aux accents)

| Texte | Réponse |
| --- | --- |
| `modele` | Le modèle à remplir |
| `aide` | Explication courte du fonctionnement |
| `mes commandes` | Les 5 dernières commandes du vendeur : référence, statut, total |
| `annuler` | Annule le brouillon en attente le plus récent |

**Déroulement d'un message**

1. Retrouver le vendeur actif dont `whatsapp_number` = `from`. Inconnu ou désactivé : répondre « Ce numéro n'est pas autorisé à passer commande. », journaliser, s'arrêter.
2. Si le message est un clic de bouton : lire `action:public_id` (voir plus bas).
3. Sinon, si le texte est une commande de secours : l'exécuter.
4. Sinon, appeler `parseOrder`. En cas d'erreur, répondre avec la liste des erreurs et le modèle.
5. Si le parsing réussit : créer un `order_drafts` (statut `pending`, `expires_at` = maintenant + 30 minutes, `public_id` aléatoire de 12 caractères) contenant les données parsées et le total.
6. Envoyer le récapitulatif avec trois boutons dont les identifiants sont `valider:<public_id>`, `modifier:<public_id>` et `annuler:<public_id>` (titres : Valider, Modifier, Annuler).

**Format du récapitulatif**

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

Si le récapitulatif dépasse 1 024 caractères, le bot demande de scinder la commande en deux.

**Actions des boutons**

| Bouton | Effet |
| --- | --- |
| Valider | Dans une transaction : verrouiller le brouillon, vérifier qu'il est `pending`, appartient au vendeur et n'est pas expiré ; créer `orders` (statut `non_traitee`), `order_items` et la première ligne de `order_status_history` ; générer la référence ; passer le brouillon à `confirmed`. Répondre « Commande CMD-... enregistrée. » |
| Modifier | Passer le brouillon à `cancelled` et demander de renvoyer le message corrigé (rappel du modèle) |
| Annuler | Passer le brouillon à `cancelled`, répondre « Commande annulée. » |

**Cas limites**

- Double clic sur Valider : si le brouillon est déjà `confirmed`, renvoyer la référence existante sans créer de doublon.
- Brouillon expiré ou annulé : « Ce récapitulatif n'est plus valide, renvoyez la commande. »
- Un vendeur ne peut agir que sur ses propres brouillons.
- Plusieurs brouillons en attente peuvent coexister : chaque bouton est lié à son `public_id`.
- Tâche planifiée toutes les heures : passer à `expired` les brouillons `pending` dont `expires_at` est dépassé, et supprimer ceux qui sont `expired`, `cancelled` ou `confirmed` depuis plus de 7 jours.

## 7. API REST du backoffice

Toutes les routes sont sous `/api/v1`, réservées au rôle `admin` (JWT), sauf `POST /auth/login` et le webhook WhatsApp, marqués `@Public()`.

**Conventions**

- JSON en `camelCase` côté API, `snake_case` en base (mapping Prisma).
- Pagination : `?page=1&limit=20` (limite max 100) ; réponse `{ data: [...], meta: { page, limit, total } }`.
- Erreurs au format NestJS standard : `{ statusCode, message, error }`.
- `ValidationPipe` global avec `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- JWT valable 8 heures, signé avec `JWT_SECRET`. Mot de passe haché avec argon2.
- Limitation de débit (`@nestjs/throttler`) : 5 tentatives par minute sur `/auth/login`.
- CORS limité à l'origine du backoffice (`CORS_ORIGIN`). Swagger sur `/api/docs`, désactivé en production.

**Routes**

| Route | Description |
| --- | --- |
| `POST /auth/login` | Corps `{ email, password }`, réponse `{ accessToken, user }` |
| `GET /auth/me` | Utilisateur courant |
| `GET /orders` | Liste filtrable : `search` (référence, client, téléphone), `status`, `vendorId`, `from`, `to` (dates `AAAA-MM-JJ`), `page`, `limit`. Tri par `created_at` décroissant |
| `GET /orders/counts` | Nombre de commandes par statut, pour les compteurs (dont les « non traitées ») |
| `GET /orders/:id` | Détail : informations, articles, vendeur, historique des statuts |
| `PATCH /orders/:id` | Corriger `customerName`, `customerPhone`, `deliveryLocation`, `notes` et, si fourni, remplacer `items` (total recalculé). Autorisé seulement en statut `non_traitee` ou `validee` |
| `PATCH /orders/:id/status` | Corps `{ status, comment? }`. Refus 409 si la transition n'est pas autorisée (section 4). Écrit une ligne dans `order_status_history` avec l'utilisateur |
| `GET /receipts/:orderId` | Reçu PDF d'une commande (`application/pdf`) |
| `POST /receipts/batch` | Corps `{ orderIds: [..] }` (jusqu'à 100) : un seul PDF, un reçu par page |
| `GET /vendors` | Liste des vendeurs |
| `POST /vendors` | Corps `{ name, whatsappNumber }`, numéro normalisé en E.164 sans `+`, unique |
| `PATCH /vendors/:id` | Modifier `name`, `whatsappNumber`, `isActive`. Pas de suppression : un vendeur lié à des commandes se désactive |
| `GET /stats/overview` | `from`, `to` : total de commandes, montant total, répartition par statut, taux de livraison, taux d'échec, délai moyen de validation |
| `GET /stats/by-vendor` | Commandes et montant par vendeur sur la période |
| `GET /stats/by-day` | Commandes par jour sur la période |
| `POST /whatsapp/webhook`, `GET /whatsapp/webhook` | Public, authentifié par signature Meta (section 5) |
| `GET /health` | Public, renvoie 200 si l'application et MySQL répondent |

**Définitions des indicateurs**

- Taux de livraison = commandes `livree` ÷ (commandes `livree` + `echec`), sur la période.
- Taux d'échec = commandes `echec` ÷ (commandes `livree` + `echec`).
- Délai moyen de validation = moyenne, en heures, entre `orders.created_at` et la première entrée `validee` dans l'historique.

**Compte admin initial.** Le script `prisma/seed.ts` crée l'admin à partir des variables `ADMIN_EMAIL`, `ADMIN_NAME` et `ADMIN_PASSWORD` ; il n'y a pas de route d'inscription publique.

## 8. Reçus PDF, sécurité et configuration

**Reçus PDF** (module `receipts`, pdfmake côté serveur)

- Format A5 (148 × 210 mm) par défaut, ou ticket de 80 mm de large si `RECEIPT_FORMAT=TICKET80`.
- Contenu : nom de l'entreprise (`RECEIPT_COMPANY_NAME`), référence en gros caractères, date et heure de création, nom du vendeur, nom, téléphone et lieu de livraison du client, tableau des articles (libellé, quantité, prix unitaire, sous-total), total, notes éventuelles.
- Le reçu groupé produit un seul PDF avec un reçu par page, pour imprimer d'un coup les colis du jour depuis le backoffice.
- La référence est lisible à distance : c'est elle qui relie le colis à la commande.

**Sécurité**

- Webhook : signature HMAC vérifiée en temps constant, jeton de vérification secret, journalisation de tout appel.
- Aucun secret dans le code ni dans Git : tout passe par `.env`, validé par Joi au démarrage (l'application refuse de démarrer s'il manque une variable).
- Numéros inconnus : aucune action, aucune donnée renvoyée.
- Les requêtes SQL passent par Prisma (requêtes paramétrées), jamais par concaténation.
- Les logs ne contiennent ni token, ni mot de passe. Les téléphones des clients sont masqués dans les logs applicatifs (`07****0707`) ; le contenu complet reste dans `webhook_logs`.
- `webhook_logs` est purgé au-delà de 90 jours (tâche planifiée quotidienne).
- HTTPS obligatoire via Nginx ; l'application écoute uniquement sur `127.0.0.1`.

**Variables d'environnement**

| Variable | Exemple ou rôle |
| --- | --- |
| `NODE_ENV`, `PORT`, `TZ` | `production`, `3000`, `Africa/Abidjan` |
| `DATABASE_URL` | `mysql://user:pass@127.0.0.1:3306/commandes` |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Clé longue aléatoire, `8h` |
| `CORS_ORIGIN` | URL du backoffice |
| `META_APP_SECRET` | App Secret Meta, pour la signature |
| `WEBHOOK_VERIFY_TOKEN` | Chaîne choisie, saisie aussi dans la console Meta |
| `WHATSAPP_TOKEN` | Token d'accès (temporaire en test, permanent en production) |
| `PHONE_NUMBER_ID`, `WABA_ID` | Identifiants relevés dans la console Meta |
| `GRAPH_API_VERSION` | Version de l'API Graph à utiliser |
| `DRAFT_TTL_MINUTES` | `30` |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Compte créé par le seed |
| `RECEIPT_COMPANY_NAME`, `RECEIPT_FORMAT` | Nom sur le reçu, `A5` ou `TICKET80` |

## 9. Déploiement, tests et plan de réalisation pour Claude Code

**Mode d'emploi pour Claude Code.** Placer ce document dans le dépôt (`docs/DAT.md`) et ajouter au `CLAUDE.md` : « Respecter docs/DAT.md. Travailler une étape à la fois, écrire les tests de l'étape, les lancer, puis s'arrêter pour validation. Ne rien ajouter qui soit hors périmètre (section 1). »

**Étapes de réalisation**

| Étape | Contenu | Terminé quand |
| --- | --- | --- |
| 1. Socle | Projet NestJS, `@nestjs/config` + Joi, Prisma, `schema.prisma` d'après la section 4, migration, seed de l'admin, `GET /health` | `npm run start` démarre, la migration s'applique sur une base vide, `/health` répond 200 |
| 2. Accès | Modules `auth`, `users`, `vendors` : login JWT, guard global, `@Public()`, CRUD vendeurs, normalisation des numéros | Les routes protégées répondent 401 sans token ; un vendeur se crée et se désactive |
| 3. Commandes | Module `orders` : création transactionnelle, référence journalière, transitions de statut, historique, filtres, compteurs | Tests des transitions autorisées et refusées ; deux créations simultanées donnent deux références distinctes |
| 4. Webhook | Module `whatsapp` : GET et POST, signature, `webhook_logs`, idempotence, `WhatsappClient` | Un POST signé est accepté, un POST non signé est refusé, le même `wamid` envoyé deux fois n'est traité qu'une fois |
| 5. Bot | Module `bot` : `parseOrder`, brouillons, récapitulatif, boutons, commandes de secours, tâche de nettoyage | Un message signé simulé produit un récapitulatif ; Valider crée la commande ; un second clic ne crée rien |
| 6. Reçus et stats | Modules `receipts` et `stats` | Le PDF unitaire et le PDF groupé s'ouvrent ; les agrégats correspondent à des données de test |
| 7. Durcissement | Throttler, Swagger (hors production), masquage des logs, tests e2e, `README` | Tous les tests passent, le `README` décrit installation, variables et déploiement |
| 8. Mise en ligne | Voir ci-dessous, puis branchement du webhook dans la console Meta | Un vrai message WhatsApp crée une commande visible via l'API |

**Tests à écrire**

- `parseOrder` : modèle complet, libellés en majuscules ou sans accents, téléphone avec `+225` et espaces, quantité absente, prix avec espaces ou points, article sans prix, téléphone à 9 chiffres, champ manquant, plus de 30 articles.
- Signature : valide, absente, falsifiée, corps modifié d'un octet.
- Idempotence : un même `wamid` reçu deux fois.
- Brouillons : validation, expiration, double clic, brouillon d'un autre vendeur.
- Commandes : chaque transition autorisée et plusieurs refus, historique renseigné.
- Bout en bout : webhook signé → récapitulatif → clic Valider → commande en base. L'envoi vers Meta est simulé (mock du `WhatsappClient`).

**Test local avec Meta.** Pour brancher le webhook avant le déploiement, exposer le port local en HTTPS avec un tunnel (cloudflared ou ngrok), saisir l'URL et le `WEBHOOK_VERIFY_TOKEN` dans la console Meta, puis écrire au numéro de test depuis un numéro destinataire autorisé.

**Mise en ligne sur le VPS Debian**

1. Installer Node 20 LTS, MySQL 8 (base `commandes`, utilisateur dédié aux droits limités) et Nginx.
2. Déployer le code, créer le `.env` de production, lancer `npm ci`, `npm run build`, `npx prisma migrate deploy` puis le seed.
3. Lancer l'application avec PM2 (`pm2 start dist/main.js --name commandes-api`), `pm2 save` et démarrage automatique au boot.
4. Configurer Nginx en reverse proxy vers `127.0.0.1:3000` avec un certificat Let's Encrypt (Certbot), sur un sous-domaine du type `api.votredomaine.com`.
5. Planifier chaque nuit un `mysqldump` compressé, conservé 14 jours, avec une copie hors du serveur.
6. Ajouter une vérification d'état sur `/health` dans votre supervision actuelle, et la rotation des logs PM2.
7. Dans la console Meta, saisir l'URL `https://api.votredomaine.com/api/v1/whatsapp/webhook`, le jeton de vérification, et s'abonner au champ `messages`.
