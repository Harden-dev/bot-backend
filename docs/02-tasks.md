# Plan de tâches

Référence : `docs/01-architecture.md` (conventions obligatoires), `docs/00-specs.md`, DAT section 9. Règle : une étape à la fois ; à la fin de l'étape, tests lancés (`pnpm test`, `pnpm lint`, `pnpm build`, e2e si prévus), puis arrêt pour validation avant l'étape suivante. Aucune fonctionnalité hors section 1 du DAT.
Statut possible : à faire / en cours / terminé. Étape 1 : BE-001, BE-002 et BE-004 **terminés** (lancement A) ; DB-001 **terminé** (lancement B, migration appliquée sur `commandes` et `commandes_test`) ; BE-003, BE-005 et BE-006 **terminés** (lancement C, notes N-14 à N-18). Étape 1 revue ; corrections de la revue appliquées (N-19, N-20), en attente de validation ; les tâches des étapes suivantes sont **à faire**.
Agents utilisés : backend-builder (BB), db-architect (DB), code-reviewer (CR), qa-analyst (QA), pentester-security (PEN), devops-sre (OPS). Pas de ux-ui-designer, frontend-builder ni ai-engineer (frontend dans un dépôt séparé).

Ajustement par rapport au plan de l'architecture : DB-001 dépend de BE-001 (Prisma doit être installé pour valider le schéma et générer la migration).

## Étape 1 : Socle
Terminé quand : `pnpm build` et `pnpm start` démarrent (et refusent de démarrer s'il manque une variable) ; la migration s'applique sur une base vide ; `/api/v1/health` répond 200 (503 si base coupée) ; le seed crée l'admin et une seconde exécution ne change rien ; `pnpm test` et `pnpm lint` passent ; le test d'injection de dépendances sous Vitest passe.

| ID | Titre | Agent | Dépend de | Fichiers | Validation | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| BE-001 | Dépendances, points V-1 à V-4, nettoyage du starter, `.env.example`, config Vitest | BB | : | `package.json`, `vitest.config.ts`, `vitest.config.e2e.ts`, `.env.example`, `.gitignore`, `src/app.*` | Dépendances installées ; test d'injection Vitest OK (sinon unplugin-swc) ; démarrage ESM OK ; e2e en série | terminé (notes N-1 à N-6) |
| DB-001 | `schema.prisma` d'après DAT section 4, migration initiale, `prisma.config.ts` | DB | BE-001 | `prisma/schema.prisma`, `prisma/migrations/*`, `prisma.config.ts` | Migration appliquée sur base vide ; 9 tables, index et contraintes identiques au DAT ; aucun ajout | terminé ; migration appliquée sur `commandes` et `commandes_test`, sans dérive (notes N-9 à N-13) |
| BE-002 | Module `config` (Joi, config typée) | BB | BE-001 | `src/config/*` | Démarrage refusé si variable manquante ; défauts documentés | terminé (note N-7) |
| BE-003 | `PrismaModule`/`PrismaService`, `PrismaTx` | BB | DB-001, BE-002 | `src/prisma/*` | Connexion OK, arrêt propre | terminé (note N-14) |
| BE-004 | `main.ts` (préfixe `api/v1`, rawBody, ValidationPipe, filtre d'exceptions, CORS, trust proxy, 127.0.0.1, pino avec redaction), `common/` (décorateurs, pagination, `maskPhone`) | BB | BE-002 | `src/main.ts`, `src/common/*`, `src/app.module.ts` | Tests unitaires `maskPhone` et filtre ; erreurs au format `{ statusCode, message, error }` | terminé (note N-8) |
| BE-005 | `GET /health` public | BB | BE-003, BE-004 | `src/health/*` | 200 base up, 503 base coupée | terminé (note N-15) |
| BE-006 | `prisma/seed.ts` idempotent (argon2, PO-18) | BB | DB-001, BE-002 | `prisma/seed.ts` | Admin créé ; second passage sans effet | terminé (notes N-16, N-17) |

### Notes de l'étape 1 (lancement A, backend-builder)

- **N-1 Dépendances installées (pnpm)** : `@prisma/client` 7.10.1, `@prisma/adapter-mariadb` 7.10.1, `prisma` 7.10.1 (dev), `dotenv` 18.0.10, `tsx` 4.23.15 (dev), `@nestjs/config` 12.1.1, `joi` 18.3.2, `class-validator` 0.15.1, `class-transformer` 0.5.1, `@nestjs/jwt` 12.0.4, `@nestjs/passport` 12.0.1, `passport` 0.7.0, `passport-jwt` 4.0.1 (+ `@types/passport-jwt` 4.0.1), `argon2` 0.45.2, `@nestjs/axios` 12.0.1, `axios` 1.21.1, `pdfmake` 0.3.14 (+ `@types/pdfmake` 0.3.3), `@nestjs/schedule` 12.0.3, `@nestjs/throttler` 6.7.1, `nestjs-pino` 5.3.1, `pino` 10.4.0, `pino-http` 11.0.0, `@nestjs/swagger` 12.1.1. Aucun conflit de peer-dependencies avec Nest 12 ; seul avertissement : `tsconfck` (via `vite-tsconfig-paths`, préexistant) attend TypeScript 5.
- **N-2 Écart de version** : `joi` 18 au lieu de `^17` (dernière stable). `@nestjs/config` 12 n'accepte plus qu'un schéma « Standard Schema », que Joi 18 implémente ; il applique `abortEarly: false`, `allowUnknown: true` et retire la valeur des messages `pattern`. Aucune décision d'architecture modifiée.
- **N-3 Scripts d'installation pnpm** : autorisés dans `pnpm-workspace.yaml` (`allowBuilds`) pour `argon2`, `prisma`, `@prisma/engines`, `esbuild` ; refusé pour `@scarf/scarf` (télémétrie). Le `postinstall: prisma generate` (V-2) n'est pas ajouté : il échouerait tant que `schema.prisma` n'existe pas ; à ajouter avec DB-001.
- **N-4 V-1 levé sans repli** : l'injection par constructeur fonctionne sous Vitest 4 sans `unplugin-swc` (test « injecte ConfigService typé par le constructeur (V-1) » dans `src/config/env.validation.spec.ts`).
- **N-5 V-3 et V-4 levés sans repli** : `nestjs-pino` 5.3.1 déclare `@nestjs/common ^11.0.8 || ^12.0.2` en peer (pas d'override) et fonctionne au démarrage ; `@nestjs/passport` + `passport-jwt` vérifiés par un test temporaire (stratégie instanciée, JWT signé) sous Nest 12 ESM, supprimé ensuite (l'implémentation relève de BE-011).
- **N-6 Starter et outillage** : `app.controller`, `app.service` et leur spec supprimés ; `test/app.e2e-spec.ts` réécrit (contrôleur de test : préfixe, ValidationPipe, rawBody, limite 256 ko, erreur 500) ; e2e en série (`fileParallelism: false`) avec `test/helpers/test-env.ts` (valeurs factices) ; `start:prod` = `node dist/main.js` ; `.gitignore` complété (`/src/generated`, `*.tsbuildinfo`) ; `.env.example` créé sans secret. Sous Git Bash (MSYS), `TZ` n'est pas transmise aux programmes Windows natifs : lancer l'application depuis PowerShell ou via le `.env`.
- **N-7 BE-002** : `src/config/` (`env.validation.ts`, `config.module.ts`, `index.ts`). Toutes les variables du DAT section 8 sont requises sauf les défauts documentés (`PORT`, `DRAFT_TTL_MINUTES`, `RECEIPT_FORMAT`, `JWT_EXPIRES_IN`). Contrôles de format : `NODE_ENV` ∈ development/production/test, `DATABASE_URL` en `mysql://`, `JWT_SECRET` ≥ 32 caractères, `CORS_ORIGIN` URL http(s), `GRAPH_API_VERSION` de forme `vX.Y`, `ADMIN_EMAIL` e-mail, `DRAFT_TTL_MINUTES` entier ≥ 1. Démarrage refusé vérifié (`node dist/main.js` sans variables : code de sortie 1, toutes les variables manquantes listées).
- **N-8 BE-004** : `ValidationPipe` et `AllExceptionsFilter` en `APP_PIPE`/`APP_FILTER` dans `AppModule` ; logger, `trust proxy`, limite JSON 256 ko, préfixe et CORS dans `src/app.setup.ts` (`configureApp`, partagé entre `main.ts` et les e2e) ; `rawBody` et écoute `127.0.0.1` dans `main.ts`. Le filtre reconnaît les erreurs Prisma par nom et code (client généré pas encore disponible). Logs pino : redaction de `authorization` et `x-hub-signature-256`, et chaîne de requête retirée de l'URL journalisée (elle peut contenir `hub.verify_token` ou un téléphone recherché, PO-26). Swagger non branché (BE-061, étape 7) ; `@CurrentUser()` reporté à BE-011.

### Notes de l'étape 1 (lancement B, db-architect)

- **N-9 Fichiers DB-001** : `prisma.config.ts` (racine : `import 'dotenv/config'`, schéma, dossier `prisma/migrations`, `datasource.url = process.env['DATABASE_URL']`) ; `prisma/schema.prisma` (générateur `prisma-client`, `output = "../src/generated/prisma"`, `moduleFormat = "esm"`, `importFileExtension = "js"` ; datasource `mysql` sans URL, Prisma 7) ; `prisma/migrations/migration_lock.toml` ; `prisma/migrations/20261113121425_init/migration.sql` (montée) et `down.sql` (retour arrière manuel, non exécuté par Prisma). Scripts `package.json` : `postinstall` et `prisma:generate` (`prisma generate`), `prisma:migrate` (`prisma migrate dev`), `prisma:migrate:deploy` (`prisma migrate deploy`). La commande de seed n'est pas déclarée dans `prisma.config.ts` : à ajouter avec BE-006 (`migrations.seed = 'tsx prisma/seed.ts'`). Client importé par `src/generated/prisma/client.js` (exports `PrismaClient`, `Prisma`, `OrderStatus`, `DraftStatus`, `UserRole`). Écart V-2 : `env()` de `prisma/config` lève une erreur si la variable manque, ce qui ferait échouer `postinstall` sans `.env` ; `process.env` est donc utilisé dans `prisma.config.ts`.
- **N-10 Migration non appliquée** : un MySQL 8.0.44 (Laragon) écoute sur 3306, mais le projet n'a pas de `.env` (donc pas de `DATABASE_URL`) ; aucun identifiant n'a été deviné. Le SQL a été produit par `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`. **À faire (lancement C ou développeur)** : créer `.env` avec `DATABASE_URL` vers une base vide dédiée (ex. `commandes`), puis `pnpm prisma migrate deploy` (applique `20261113121425_init` tel quel) et `pnpm prisma migrate status` ; contrôle de dérive conseillé : `pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` doit être vide. Même procédure pour `commandes_test` (`.env.test`). `migrate dev` reste utilisable ensuite (il demande une base fantôme : droit `CREATE DATABASE` ou `shadowDatabaseUrl`).
- **N-11 Conformité au DAT section 4** : 9 tables, colonnes, types, nullabilité, valeurs par défaut, ENUM, clés uniques (`whatsapp_number`, `email`, `reference`, `public_id`, `wamid`), index (`idx_orders_status`, `idx_orders_vendor`, `idx_orders_created`, `idx_hist_order`, `idx_drafts_vendor`, `idx_drafts_expires`, `idx_logs_created`), clé primaire `day`, clés étrangères (`fk_orders_vendor`, `fk_items_order`, `fk_hist_order`, `fk_drafts_vendor`) et `ON DELETE CASCADE` (items, historique) identiques, y compris les noms (les uniques portent le nom que MySQL donne à un `UNIQUE` en ligne). Aucune table ni colonne ajoutée. Les actions des clés étrangères vers `vendors` et l'`ON UPDATE` sont forcés à `NO ACTION` (défaut MySQL du DDL du DAT), car Prisma met sinon `ON DELETE RESTRICT ON UPDATE CASCADE`.
- **N-12 Écarts résiduels (à arbitrer par le Team Lead, aucun bloquant)** :
  1. `vendors.updated_at` et `orders.updated_at` : `DEFAULT CURRENT_TIMESTAMP(3)` présent, mais **sans `ON UPDATE CURRENT_TIMESTAMP(3)`** (non modélisable par Prisma ; `@updatedAt` met la valeur à jour côté client). Conséquence : une mise à jour en SQL brut ne modifie pas `updated_at`. Aucun SQL brut prévu ne met à jour `orders` ni `vendors` (SQL brut limité aux verrous, au compteur et aux statistiques), donc sans effet. Si le Team Lead veut la clause en base, l'ajouter à la main dans `migration.sql` avant toute application, puis vérifier l'absence de dérive.
  2. Jeu de caractères : Prisma ajoute `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` à **toutes** les tables, y compris `daily_counters`, `processed_messages`, `webhook_logs` pour lesquelles le DAT ne précise rien (elles auraient pris le défaut du serveur). Conforme à la collation retenue dans 01-architecture.md.
  3. `ENGINE=InnoDB` non écrit (défaut de MySQL 8) ; `TINYINT(1)` écrit `BOOLEAN` et `INT` écrit `INTEGER` (alias MySQL strictement identiques).
  4. `order_items` : l'index sur `order_id`, implicite dans le DAT (créé par MySQL pour la clé étrangère), est déclaré explicitement sous le même nom `fk_items_order` : structure identique.
  5. `order_status_history.changed_by_user_id` : sans clé étrangère, comme le DAT (aucune relation Prisma vers `User`).
- **N-13 Risques de migration** : migration initiale de création uniquement (aucune donnée existante, aucun verrou sur une table en production). `down.sql` est **destructif** (supprime les 9 tables) : sauvegarde `mysqldump --single-transaction` obligatoire avant usage, jamais en production sans validation. Ne pas modifier `migration.sql` après sa première application (somme de contrôle Prisma) ; toute évolution passe par une nouvelle migration.

### Notes de l'étape 1 (lancement C, backend-builder)

- **N-14 BE-003** : `src/prisma/` (`prisma.service.ts`, `prisma.module.ts`, `to-number-id.ts`, `index.ts`). `PrismaModule` global importé par `AppModule` ; `PrismaService` étend le `PrismaClient` généré avec `new PrismaMariaDb(DATABASE_URL)` (URL lue via `ConfigService`, donc validée par Joi ; l'adaptateur réécrit lui-même `mysql://` en `mariadb://`), `$connect` dans `onModuleInit`, `$disconnect` dans `onModuleDestroy`. Type `PrismaTx = Prisma.TransactionClient` exporté. Ids `bigint` : aucun patch de `BigInt.prototype.toJSON` ; fonction `toNumberId(id)` (refuse au-delà de 2^53 - 1) exportée par `src/prisma/index.ts` pour les `*ResponseDto` des étapes suivantes (aucune route ne renvoie d'id en étape 1). Constat : avec l'adaptateur, la connexion est paresseuse ; l'application démarre même si MySQL est arrêté (`/health` répond alors 503).
- **N-15 BE-005** : `src/health/` (module, contrôleur `@Public()`, `HealthService`, `HealthResponseDto`). `GET /api/v1/health` exécute `SELECT 1` via `$queryRaw` ; 200 `{ "status": "ok" }`, sinon erreur journalisée et 503 `{ statusCode: 503, message: 'Base de données indisponible', error: 'Service Unavailable' }`. Vérifié en réel : 200 sur l'application lancée par `node dist/main.js` ; 503 avec une `DATABASE_URL` vers un port fermé, mais après **environ 10 s** (délai d'attente par défaut du pool `mariadb`, `acquireTimeout`).
- **N-16 BE-006** : `prisma/seed.ts` (point d'entrée : `import 'dotenv/config'`, validation de `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` avec les règles extraites du schéma Joi de `src/config/env.validation.ts`, code de sortie 1 si invalide) et `prisma/seed-admin.ts` (`seedAdmin` : recherche par e-mail, sinon création avec hachage argon2id). PO-18 : un compte existant n'est ni recréé ni modifié (log « Compte admin déjà présent : aucune modification », code 0). Déclaré dans `prisma.config.ts` (`migrations.seed = 'tsx prisma/seed.ts'`) : `pnpm prisma db seed`. Le seed n'utilise pas Nest (tsx/esbuild n'émet pas `emitDecoratorMetadata`, l'injection de `PrismaService` y échouerait) : il instancie son propre `PrismaClient` avec le même adaptateur.
- **N-17 E2E sur MySQL réel** : `test/helpers/test-env.ts` charge désormais `.env.test` (`override: true`) et refuse de lancer les e2e si le fichier manque, si `NODE_ENV` n'est pas `test` ou si le nom de base ne finit pas par `_test` (garde contre la base de développement). `test/helpers/reset-db.ts` : `TRUNCATE` des 9 tables dans une transaction (même connexion que `FOREIGN_KEY_CHECKS = 0`), gabarits étiquetés uniquement. Nouveaux e2e : `test/health.e2e-spec.ts` (200 sans jeton ; 503 sans détail interne, `$queryRaw` simulé en échec) et `test/seed.e2e-spec.ts` (script réel lancé deux fois via `node --import tsx` : admin actif, rôle `admin`, hachage `$argon2id$` vérifié, ni doublon ni modification au second passage ; variable invalide : code 1, rien créé). Un `.env.test` (non versionné) est un prérequis de `pnpm test:e2e`.
- **N-18 Points ouverts (étape 1)** : (1) délai d'environ 10 s avant le 503 quand MySQL est injoignable (N-15) : si l'outil de supervision a un délai plus court, réduire `acquireTimeout` du pool (arbitrage Team Lead) ; (2) une URL hors préfixe (ex. `GET /health`) répond 404 en HTML Express et non au format `{ statusCode, message, error }` (comportement issu de BE-004, non modifié).

### Note de suivi : corrections revue étape 1 (backend-builder, approuvées par le client)

- **N-19 Corrections appliquées** :
  1. `src/main.ts` : `app.enableShutdownHooks()` avant `listen` (`PrismaService.onModuleDestroy` exécuté sur SIGINT/SIGTERM).
  2. `AllExceptionsFilter` : une `HttpException` dont la réponse est une chaîne (erreurs body-parser 413/415/400 converties par l'adaptateur Express) renvoie `{ statusCode, message, error: http.STATUS_CODES[status] }` ; e2e 413 vérifie le corps complet.
  3. Même filtre : pour toute erreur `PrismaClient*` non convertie (Known/Unknown/Validation…), seuls `name`, `code` et `meta.modelName` sont journalisés (le message et la stack peuvent contenir téléphone ou nom client) ; stack complète conservée pour les autres erreurs.
  4. `pino-http-options.spec.ts` : logger construit par `pinoHttp(buildPinoHttpOptions('production'))` sur une vraie requête HTTP ; vérifie l'absence du jeton `Authorization`, de `X-Hub-Signature-256` et de `hub.verify_token`. Contrôle de mutation : le test échoue sans `redact` et sans `serializers`.
  5. Scripts `typecheck` (`tsc --noEmit -p tsconfig.json` ; `tsconfig.json` sans `include`, donc tous les `.ts` du dépôt : `src`, `test`, `prisma`, `prisma.config.ts`, configs Vitest) et `lint` étendu à `prisma/`.
  6. `vitest.config.e2e.ts` : `testTimeout: 30_000` ; `test/seed.e2e-spec.ts` lance le seed par `spawn` asynchrone.
  7. `test/helpers/reset-db.ts` : `FOREIGN_KEY_CHECKS = 1` remis dans un `finally`.
  8. E2E seed en échec : vérifie aussi « Configuration invalide » et « ADMIN_PASSWORD » sur stderr (mot de passe vide et de 11 caractères).
  9. `test/health.e2e-spec.ts` : le test du 503 indique qu'il simule l'échec de `$queryRaw` (pas une vraie coupure MySQL).
  10. `env.validation.ts` : `CORS_ORIGIN` sans chemin ni `/` final (`/^https?:\/\/[^/]+$/`) ; `ADMIN_PASSWORD` ≥ 12 caractères (le seed réutilise la règle par `extract`). `.env` et `.env.test` conformes.
  11. `package.json` : script `deploy` et `@nestjs/mau` retirés ; `engines.node >=24`.
  12. `oxlint.json` : `no-explicit-any` en `error` (aucun `any` présent).
  13. `.gitignore` : `.env`, `.env.*`, exception `!.env.example` (vérifié par `git check-ignore`).
  14. `src/app.setup.ts` : `app.disable('x-powered-by')`, e2e de l'absence de l'en-tête.
- **N-20 Points acceptés et documentés (non corrigés)** : (1) délai d'environ 10 s avant le 503 de `/api/v1/health` quand MySQL est injoignable (`acquireTimeout` du pool, N-15) ; (2) 404 HTML Express hors `/api/v1` (N-18) : à couvrir côté Nginx (OPS-002) en ne transmettant à l'application que `/api/v1/`.

## Étape 2 : Accès
Terminé quand : toute route hors login, webhook et health répond 401 sans jeton ; login OK avec JWT 8 h ; un vendeur se crée (numéro normalisé), se modifie, se désactive ; doublon en 409 ; aucune route DELETE ni inscription ; e2e login/me/vendors passent.

| ID | Titre | Agent | Dépend de | Fichiers | Validation | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| BE-010 | Module `users` (lecture) | BB | BE-003 | `src/users/*` | Tests unitaires | à faire |
| BE-011 | `auth` : login, `me`, stratégie JWT, `JwtAuthGuard` global, `@Public()`, `@CurrentUser()` | BB | BE-010 | `src/auth/*`, `src/common/guards/*`, `src/common/decorators/*` | 401 sans jeton ; compte inactif 401 ; hachage argon2 | à faire |
| BE-012 | `normalizeVendorNumber`, `normalizeCiPhone` (pures) | BB | BE-004 | `src/common/phone/*` | Tests, 100 % des branches | à faire |
| BE-013 | Module `vendors` (GET/POST/PATCH, 409 doublon, `findActiveByWhatsappNumber`) | BB | BE-011, BE-012 | `src/vendors/*` | Tests unitaires et e2e | à faire |

## Étape 3 : Commandes
Terminé quand : chaque transition autorisée et les refus de US-CMD-06 sont testés (409, historique inchangé) ; deux créations simultanées donnent deux références distinctes ; filtres, pagination (`limit > 100` en 400), compteurs corrects ; correction refusée hors `non_traitee`/`validee` ; champs non autorisés refusés.

| ID | Titre | Agent | Dépend de | Fichiers | Validation | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| BE-020 | Table de transitions et `assertTransition` | BB | BE-004 | `src/orders/order-status.ts` (+spec) | Toutes transitions testées | à faire |
| BE-021 | `computeTotal` + plafond `MAX_ORDER_TOTAL` (PO-01) | BB | BE-004 | `src/common/money/*` | Tests limites | à faire |
| BE-022 | `OrdersService.create(input, tx?)` : référence journalière verrouillée, articles, historique initial | BB | BE-020, BE-021, BE-003 | `src/orders/orders.service.ts` | Référence `CMD-AAAAMMJJ-NNN`, reset journalier | à faire |
| BE-023 | Liste, filtres, compteurs, détail, objets de réponse (ids en `number`) | BB | BE-022, BE-013 | `src/orders/*`, `src/common/pagination/*` | Filtres cumulables, tri décroissant | à faire |
| BE-024 | `PATCH /orders/:id` et `PATCH /orders/:id/status` | BB | BE-023, BE-011 | `src/orders/*` | 409 selon PO-14 et transitions ; historique avec utilisateur | à faire |
| BE-025 | E2E de concurrence (MySQL de test) | BB | BE-022 | `test/orders.e2e-spec.ts`, `test/helpers/*` | N créations simultanées : références distinctes consécutives | à faire |

## Étape 4 : Webhook
Terminé quand : GET renvoie le challenge (200) ou 403 ; POST signé accepté et journalisé `signature_valid = 1` ; POST non signé ou falsifié en 403, `signature_valid = 0`, sans traitement ; un même `wamid` envoyé deux fois n'est traité qu'une fois ; une exception de traitement ne change pas le 200 ; aucun appel réel à Meta.

| ID | Titre | Agent | Dépend de | Fichiers | Validation | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| BE-030 | `verifyMetaSignature` (pure, temps constant) | BB | BE-004 | `src/whatsapp/meta-signature.ts` (+spec) | Valide, absente, falsifiée, corps modifié d'un octet | à faire |
| BE-031 | `WhatsappClientModule` : `sendText`, `sendButtons`, limites, retry unique 2 s, journal des 4xx | BB | BE-002 | `src/whatsapp/client/*` | Tests avec `HttpService` simulé et timers factices | à faire |
| BE-032 | Contrôleur GET/POST, `webhook_logs`, normalisation, `statuses[]` ignorés, PO-29 | BB | BE-030, BE-003 | `src/whatsapp/*` | Comportements US-BOT-01/02/04 | à faire |
| BE-033 | Idempotence (`P2002`), `MessageProcessor`, interface `BotService.handle` | BB | BE-032 | `src/whatsapp/*`, `src/bot/bot.service.ts` | Idempotence testée | à faire |
| BE-034 | Purge nocturne `webhook_logs` > 90 jours | BB | BE-032 | `src/whatsapp/webhook-logs.cleanup.ts` | Test de purge | à faire |

## Étape 5 : Bot
Terminé quand : un message signé simulé produit un récapitulatif (mock) ; Valider crée la commande `non_traitee` avec référence et historique ; un second clic ne crée rien et renvoie la référence ; brouillon `expired`/`cancelled` : « n'est plus valide » ; seul le brouillon du vendeur est actionnable ; la tâche d'expiration et la purge respectent la règle ; atomicité vérifiée.

| ID | Titre | Agent | Dépend de | Fichiers | Validation | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| BE-040 | `parseOrder` (R-P1 à R-P8, PO-01, PO-07) | BB | BE-021 | `src/bot/parse-order.ts` (+spec) | Tests exhaustifs, erreurs toutes listées | à faire |
| BE-041 | `messages.ts`, `formatRecap` (PO-05, PO-06, PO-08) | BB | BE-040 | `src/bot/messages.ts`, `src/bot/format-recap.ts` (+spec) | Format DAT ; longueur ≤ 1 024 contrôlée | à faire |
| BE-042 | `DraftsService` : création, annulation/modification conditionnelles, confirmation transactionnelle | BB | BE-022, BE-041 | `src/bot/drafts.service.ts` (+spec) | Double clic, expiration, autre vendeur | à faire |
| BE-043 | `BotService.handle`, `BotModule` (ordre imposé, secours, PO-09/10/11/13) | BB | BE-042, BE-013, BE-031 | `src/bot/bot.service.ts`, `src/bot/bot.module.ts` | Flux US-BOT-05 à 14 | à faire |
| BE-044 | Tâche horaire d'expiration et purge | BB | BE-042 | `src/bot/drafts.cleanup.ts` (+spec) | US-BOT-15 | à faire |
| BE-045 | E2E bot (WhatsappClient simulé) | BB | BE-043, BE-033 | `test/bot.e2e-spec.ts` | Webhook signé, récap, Valider, commande en base | à faire |

## Étape 6 : Reçus et statistiques
Terminé quand : PDF unitaire et groupé s'ouvrent (A5 et TICKET80, un reçu par page) ; agrégats conformes aux valeurs de test (8 livrées / 2 échecs = 80 % / 20 %) ; cas PO-20 (taux `null`, jours à 0) testés.

| ID | Titre | Agent | Dépend de | Fichiers | Validation | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| BE-050 | Spike pdfmake (V-5) : ESM, polices, glyphes | BB | BE-024 | `assets/fonts/*`, `nest-cli.json` | PDF de test avec `× — •` et accents | à faire |
| BE-051 | `ReceiptsService` (A5, TICKET80, contenu DAT section 8) | BB | BE-050 | `src/receipts/*` | Contenu complet ; hypothèse hauteur ticket à valider par essai d'impression | à faire |
| BE-052 | `GET /receipts/:orderId`, `POST /receipts/batch` (PO-19) | BB | BE-051 | `src/receipts/*` | 404, 1 à 100 ids, doublons dédoublonnés | à faire |
| BE-053 | Stats : overview, by-vendor, by-day (PO-20) | BB | BE-024 | `src/stats/*` | Valeurs calculées à la main | à faire |

## Étape 7 : Durcissement
Terminé quand : `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e` passent ; 6e login/minute refusé ; Swagger absent en production ; `README` complet ; QA et sécurité GO.

| ID | Titre | Agent | Dépend de | Fichiers | Validation | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| BE-060 | Throttler sur `/auth/login` uniquement | BB | BE-011 | `src/auth/*` | E2E du 6e appel refusé | à faire |
| BE-061 | Swagger hors production, `@ApiProperty` | BB | BE-053 | `src/main.ts`, `src/**/dto/*` | `/api/docs` absent en production | à faire |
| BE-062 | Vérification du masquage des logs | BB | BE-004 | `src/common/phone/*`, config pino | Aucun secret ni téléphone en clair | à faire |
| BE-063 | Suite e2e complète, `README.md` | BB | étapes 1 à 6 | `test/*`, `README.md` | Tous tests verts ; README installation, variables, déploiement | à faire |
| REV-001 | Revue de code (à chaque étape, puis globale) | CR | BE-063 | : | Verdict favorable | à faire |
| QA-001 | Rapport QA | QA | REV-001 | `docs/04-qa-report.md` | GO | à faire |
| SEC-001 | Audit sécurité | PEN | QA-001 | `docs/05-security-report.md` | GO, aucun finding critique/haut | à faire |

## Étape 8 : Mise en ligne
Terminé quand : un vrai message WhatsApp depuis un destinataire autorisé crée une commande visible via `GET /api/v1/orders`.

| ID | Titre | Agent | Dépend de | Fichiers | Validation | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | Provisioning (Node 24, MySQL, Nginx, utilisateur MySQL, `.env`, Certbot) ; peut démarrer en parallèle | OPS | : | config d'infra | Serveur prêt | à faire |
| OPS-002 | Déploiement (build, `migrate deploy`, seed, PM2 une instance, Nginx, sauvegardes, logs, supervision `/api/v1/health`) | OPS | QA-001 et SEC-001 GO, OPS-001 | config d'infra | `/health` 200 en HTTPS | à faire |
| OPS-003 | Branchement Meta (avec le client) | OPS | OPS-002 | : | Vérification du webhook réussie | à faire |

## Prochaine action

Lancements A, B et C de l'étape 1 réalisés. **Action suivante : revue de l'étape 1 (code-reviewer), puis arrêt pour validation avant l'étape 2.** Historique ci-dessous.

**Agent désigné pour démarrer l'étape 1 : backend-builder**, en premier lancement, puis db-architect, puis un second lancement de backend-builder. Le projet n'a pas de tâche UX.

Ordre et périmètre :
1. **Lancement A, backend-builder : BE-001 puis BE-002 puis BE-004** (dans cet ordre). Il n'a pas besoin du schéma : installation des dépendances (dont `prisma`, `@prisma/client`, `@prisma/adapter-mariadb`, `dotenv`), config Joi, bootstrap et utilitaires. S'arrête là.
2. **Lancement B, db-architect : DB-001** (nécessite que Prisma soit installé par BE-001).
3. **Lancement C, backend-builder : BE-003, BE-005, BE-006**, puis revue (code-reviewer) de l'étape 1 et arrêt pour validation.

Brief prêt à envoyer (lancement A) :

> Tu es backend-builder sur le projet NestJS « bot_backend » (C:\laragon\www\PROJECTS\bot_backend). Lis en entier docs/01-architecture.md (conventions obligatoires), docs/02-tasks.md et CLAUDE.md ; le DAT (racine) fait foi pour le fonctionnel, le scaffold pour l'outillage (NestJS 12, TS 6, ESM avec imports relatifs en `.js`, pnpm, Vitest, oxlint). Périmètre : étape 1 (Socle), uniquement BE-001, puis BE-002, puis BE-004, dans cet ordre. Ne touche ni à `prisma/schema.prisma` ni aux migrations (db-architect, DB-001, vient après toi), ni au `PrismaService` (BE-003 plus tard). BE-001 : installer la stack de la section « Stack retenue » (Prisma 7 + adapter mariadb, dotenv, tsx, config, joi, class-validator/transformer, jwt/passport-jwt, argon2, axios, pdfmake, schedule, throttler, nestjs-pino/pino, swagger) ; lever les points V-1 (test d'injection de dépendances sous Vitest, repli unplugin-swc), V-3 et V-4 si concernés ; supprimer le starter (app.controller/service/spec) ; créer `.env.example` (variables du DAT section 8, sans secret) ; compléter `.gitignore` (`.env`, `src/generated`) ; e2e Vitest en série ; `start:prod` en `node dist/main.js`. Consigne tout écart ou repli dans docs/02-tasks.md (colonne Validation ou note) sans modifier les décisions de 01-architecture.md. BE-002 : module `config` avec schéma Joi (démarrage refusé s'il manque une variable). BE-004 : `main.ts`, `common/` (décorateurs, pagination, `maskPhone`), logger pino avec redaction, filtre d'exceptions, selon la section API. Écris les tests unitaires de ton périmètre, lance `pnpm test`, `pnpm lint`, `pnpm build`, puis arrête-toi et rends compte (tâches faites, écarts, points V levés ou non). N'ajoute rien hors section 1 du DAT et ne lance aucun autre agent.
