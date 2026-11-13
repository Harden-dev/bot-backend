# Architecture technique

> Référence technique du projet, produite par le Team Lead / Architecte.
> Sources : `docs/00-specs.md` (spécifications), `DAT – Backend NestJS – Plateforme de commandes WhatsApp.md` (fait foi pour la stack, le schéma MySQL, les modules et le plan en 8 étapes), `CLAUDE.md` et le scaffold réel (le scaffold l'emporte sur le DAT pour l'outillage).
> Périmètre : strictement la section 1 du DAT. Aucune fonctionnalité n'est ajoutée.
> Statut : retour client intégré. **Validés par le client : Node 24 (PO-30) et le plafond `MAX_ORDER_TOTAL` (PO-01).** Les autres décisions restent marquées **[HYPOTHÈSE À VALIDER PAR LE CLIENT]** (valeurs par défaut prises faute de validation des autres points ouverts), non contestées à ce jour.
> Les conventions de ce document sont obligatoires pour tous les agents (backend-builder, db-architect, code-reviewer, qa-analyst, pentester-security, devops-sre).
> Plan de tâches détaillé : `docs/02-tasks.md`.

Limites de cette rédaction : aucune commande réseau n'a pu être exécutée pendant l'analyse. La compatibilité des bibliothèques (section « Stack retenue ») est donc établie à partir des peer-dependencies connues et du scaffold, pas d'une installation. Chaque point non vérifié est listé avec une vérification explicite à faire en étape 1 (tâche BE-001) et une solution de repli.

---

## Stack retenue

### Backend : NestJS (imposé)

Le choix NestJS est imposé par le DAT et par le scaffold existant ; il n'y a pas d'arbitrage Laravel/NestJS à faire. Critère favorable supplémentaire : écosystème TypeScript existant, traitement asynchrone dans le processus (webhook), pas de partage de types avec le frontend (le backoffice Vue consomme l'API REST).

| Couche | Choix retenu | Version cible | Statut de compatibilité NestJS 12 / TS 6 / ESM |
| --- | --- | --- | --- |
| Runtime | Node.js | **24 LTS** (validé par le client) | Le DAT cite Node 20, mais Node 20 est en fin de vie et le scaffold utilise `@types/node ^24`. Décision PO-30 ci-dessous. |
| Langage | TypeScript strict | `^6.0` (scaffold) | OK. `module: nodenext`, imports relatifs en `.js`. |
| Framework | NestJS + Express | `^12` (scaffold) | OK (scaffold). Express 5 : les motifs de route utilisent la syntaxe `path-to-regexp` v8 (pas de `*` nu). |
| Gestionnaire de paquets | pnpm | celui du lockfile | Remplace npm du DAT. |
| Lint / format | oxlint, prettier | scaffold | Remplace ESLint du DAT. |
| Tests | Vitest + supertest | `vitest ^4` (scaffold) | Remplace Jest du DAT. Voir point de vigilance V-1. |
| Base de données | MySQL | **8.4 LTS** (8.0 accepté s'il est déjà installé) | Voir section Base de données. |
| ORM | Prisma | **`prisma` et `@prisma/client` ^7** | ESM natif, compatible TS 6. Spécificités Prisma 7 ci-dessous (V-2). |
| Adaptateur Prisma MySQL | `@prisma/adapter-mariadb` | version alignée sur Prisma | Prisma 7 s'exécute via un driver adapter ; pour MySQL c'est l'adaptateur `mariadb`. |
| Config | `@nestjs/config` + `joi` | `@nestjs/config` version compatible Nest 12, `joi ^17` | OK. `import Joi from 'joi'` fonctionne en ESM (interop CJS). |
| Validation | `class-validator` + `class-transformer` | dernières stables | CJS, importables en ESM. Voir règle sur `import type` (conventions). |
| Auth | `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt` | versions compatibles Nest 12 | CJS, OK en ESM via interop. Repli V-4. |
| Hachage | `argon2` | `^0.4x` | Module natif avec binaires précompilés (Windows et Linux x64). Repli : `@node-rs/argon2`. |
| Appels Meta | `@nestjs/axios` + `axios` | compatible Nest 12 | OK. Le retry est codé à la main (pas de lib de retry). |
| PDF | `pdfmake` | **`^0.3`** | Point de vigilance V-5 (API et typage ESM). |
| Planification | `@nestjs/schedule` | compatible Nest 12 | OK. |
| Limitation de débit | `@nestjs/throttler` | compatible Nest 12 | OK, guard appliqué par route uniquement (voir API). |
| Logs | `nestjs-pino` + `pino` + `pino-http` | dernières stables | Paquet tiers dont la peer-dependency Nest peut retarder. Repli V-3. |
| Documentation API | `@nestjs/swagger` | compatible Nest 12 | OK. |
| Seed / scripts TS | `tsx` (devDependency) | dernière stable | Exécute `prisma/seed.ts` en ESM. |
| Identifiants publics aléatoires | `node:crypto` (`randomBytes`) | natif | Aucune dépendance (pas de `nanoid`). |
| Exposition | Nginx (HTTPS, Let's Encrypt) + PM2 | selon DAT | Inchangé. |

#### Points de vigilance et blocages potentiels (à lever en étape 1, tâche BE-001)

Aucun blocage **confirmé**. Cinq risques à vérifier avant d'écrire du code métier :

- **V-1 Vitest 4 (Vite 8) et décorateurs NestJS.** L'injection de dépendances Nest repose sur `emitDecoratorMetadata`. Le transformateur par défaut de Vite ne l'émet pas toujours. Vérification : un test unitaire qui instancie un provider avec injection de constructeur via `Test.createTestingModule` doit passer. Repli : ajouter `unplugin-swc` (avec `jsc.transform.decoratorMetadata: true`) aux deux fichiers `vitest.config*.ts`. Le test existant `src/app.controller.spec.ts` est le premier indicateur.
- **V-2 Prisma 7.** Points à respecter : générateur `prisma-client` avec `output` explicite (client généré dans `src/generated/prisma`, ignoré par Git, régénéré par `prisma generate` en `postinstall`) ; fichier `prisma.config.ts` (URL de base, dossier de migrations, commande de seed) ; chargement du `.env` explicite (`import 'dotenv/config'` dans `prisma.config.ts`) ; driver adapter `@prisma/adapter-mariadb` instancié dans `PrismaService`. Si le comportement diffère de cette description, le backend-builder et le db-architect s'alignent sur la documentation Prisma de la version installée et consignent l'écart dans `docs/02-tasks.md`. Repli : Prisma 6 (générateur `prisma-client-js`) si l'ESM pose problème, au prix d'imports CJS du client.
- **V-3 `nestjs-pino`.** Si sa peer-dependency refuse Nest 12, deux solutions : forcer la résolution via `pnpm.overrides` si l'API est inchangée, ou implémenter un `LoggerService` Nest minimal sur `pino` (même format JSON, mêmes règles de masquage). Les conventions de logs de ce document restent valables dans les deux cas.
- **V-4 `passport-jwt`.** Même logique : si l'intégration `@nestjs/passport` pose problème, la stratégie est remplacée par un `JwtAuthGuard` maison qui appelle `JwtService.verifyAsync` (`@nestjs/jwt`). Le contrat externe (JWT 8 h, `@Public()`, 401) ne change pas.
- **V-5 `pdfmake`.** Le typage (`@types/pdfmake`) et l'API serveur diffèrent entre 0.2 (`PdfPrinter`, imports profonds) et 0.3 (`createPdf(...).getBuffer()` asynchrone). À valider par un spike au début de l'étape 6 : import en ESM, polices Roboto embarquées (fichiers TTF dans `assets/fonts/`, copiés au build via `nest-cli.json` > `assets`), rendu des caractères `×`, `—`, `•` et des accents, hauteur automatique pour le ticket 80 mm. Repli : pdfmake 0.2 avec `createRequire`.

Autres remarques de compatibilité :

- **PO-30 (Node)** : **Node 24 LTS** retenu pour le VPS Debian et le poste de développement (Node 20 est hors support, Nest 12 attend une version récente). **[VALIDÉ PAR LE CLIENT]** (Node 24 sur le VPS confirmé).
- **`start:prod`** : le scaffold lance `node dist/main`. En ESM, utiliser `node dist/main.js` (et `pm2 start dist/main.js`) pour éviter toute ambiguïté de résolution.
- **`tsconfig.build.json`** doit exclure `**/*.spec.ts`, `test/`, `prisma/` et `src/generated` du `rootDir` de build si cela perturbe `dist/main.js` (vérifier que le point d'entrée reste `dist/main.js`).
- **Express 5** : `req.rawBody` (option `rawBody: true`) reste disponible ; le webhook lit les octets bruts.

### Frontend et mobile

Précision du client : les commandes sont saisies dans le bot WhatsApp et envoyées au backend ; l'interface admin Vue.js (dépôt séparé) les gère ensuite. L'architecture est déjà conforme.

Hors périmètre de ce dépôt : le backoffice Vue.js est un projet séparé qui consomme l'API REST. Aucune stack frontend ni mobile n'est définie ici. Le client mobile n'existe pas (le canal vendeur est WhatsApp). `ux-ui-designer` et `frontend-builder` ne sont pas invoqués pour ce dépôt.

### Base de données : MySQL 8.4 LTS (utf8mb4)

- Imposé par le DAT ; il convient bien à un volume de 20 commandes par jour, transactions InnoDB et verrous de ligne (`SELECT ... FOR UPDATE`) nécessaires à la référence journalière et à la validation du brouillon.
- 8.4 LTS est recommandé car MySQL 8.0 est arrivé en fin de support ; 8.0 reste accepté si MySQL est déjà installé (Laragon en développement). Aucune fonctionnalité spécifique à 8.4 n'est utilisée.
- Collation `utf8mb4_unicode_ci` (ou la collation par défaut de l'instance si elle est en `utf8mb4`) ; fuseau MySQL non modifié, toutes les dates sont lues et écrites en UTC par Prisma.

### Composante IA

Aucune. `ai-engineer` n'est pas invoqué. Le « parsing » est une fonction déterministe (`parseOrder`), pas du NLP.

---

## Architecture

### Architecture backend

Monolithe modulaire NestJS, un seul processus, une base MySQL. Pas de microservice, pas de file externe, pas de Redis, pas de WebSocket (DAT section 1).

**Patrons retenus (et uniquement ceux-ci)**

| Patron | Décision | Justification |
| --- | --- | --- |
| MVC léger Nest (Controller, Service, DTO) | Oui | Standard Nest, suffisant. |
| Service Layer | Oui : toute la logique métier est dans les `*.service.ts` | Controllers fins, services testables sans HTTP. |
| Repository Pattern | **Non** | Prisma est déjà la couche d'accès aux données typée ; une couche repository doublerait chaque requête sans bénéfice à 9 tables. Les services utilisent `PrismaService` directement. |
| Action / CQRS / DDD / Event Driven / Clean Architecture | **Non** | Sur-ingénierie pour 20 commandes par jour. L'interprétation du message vendeur est une fonction pure + un service, pas un bus de commandes. |
| Fonctions pures | Oui | `parseOrder`, `formatRecap`, `computeTotal`, `normalizeCiPhone`, transitions de statut : sans I/O, testées exhaustivement. |
| State machine de statuts | Oui, sous forme d'une table de transitions (objet constant) | Les transitions sont statiques et peu nombreuses. |
| Machine à états de conversation | **Non** (DAT : le bot est sans état) | Le seul état est une ligne `order_drafts`. |

**Graphe de modules Nest (sens unique, sans cycle)**

```text
WhatsappModule (webhook)  ──►  BotModule  ──►  OrdersModule ──► PrismaModule
        │                        │  │          VendorsModule ─► PrismaModule
        │                        │  └────────► WhatsappClientModule
        └──────────────────────────────────────► WhatsappClientModule (non utilisé directement, voir ci-dessous)
AuthModule ──► UsersModule ──► PrismaModule
ReceiptsModule ──► OrdersModule
StatsModule ──► PrismaModule
```

**Précision par rapport au DAT.** Le tableau du DAT (section 3) indique `whatsapp` → `bot` et `bot` → `whatsapp`, ce qui forme un cycle de modules Nest, alors que la règle est `whatsapp → bot → orders/vendors`. Décision : scinder `whatsapp` en deux modules Nest dans le même dossier, sans changer le périmètre :

- `WhatsappClientModule` (`src/whatsapp/client/`) : uniquement `WhatsappClient` (`sendText`, `sendButtons`) et son retry. Il ne dépend de rien d'autre que de `@nestjs/axios` et de la config. Il est importé par `BotModule`.
- `WhatsappModule` (`src/whatsapp/`) : webhook (GET/POST), signature, journaux, idempotence, normalisation des messages. Il importe `BotModule`.

Ainsi `whatsapp` (webhook) → `bot` → `whatsapp/client`, `orders`, `vendors`. `orders` ne connaît ni WhatsApp ni le bot ; `vendors` non plus. Le webhook ne répond jamais lui-même au vendeur : même le message « type non pris en charge » est produit par le bot (voir PO-13).

**Transaction partagée entre `bot` et `orders`.** La validation d'un brouillon est une seule transaction qui touche `order_drafts` (bot) et `orders`/`order_items`/`order_status_history`/`daily_counters` (orders). Règle : `OrdersService.create(input: CreateOrderInput, tx?: PrismaTx)` accepte un client transactionnel optionnel (type `PrismaTx` exporté par `src/prisma/`). `BotService` (via `DraftsService`) ouvre `prisma.$transaction(async (tx) => {...})` et passe `tx` à `OrdersService`. `CreateOrderInput` est un type générique (client, téléphone, lieu, articles, vendeur, notes optionnelles) : `orders` ne connaît pas la notion de brouillon.

**Traitement asynchrone du webhook (sans file).**

1. Le contrôleur lit `req.rawBody`, vérifie la signature, insère dans `webhook_logs`, répond `200`.
2. Seulement après avoir `await` l'insertion du log, le contrôleur déclenche `void this.processor.process(payload).catch(err => logger.error(...))`. Aucune exception de traitement ne remonte à la réponse HTTP (NF-F3).
3. Le traitement est séquentiel au sein d'un payload (boucle `for ... of`, `await` à chaque message) pour préserver l'ordre.
4. Si l'insertion du log échoue, la réponse est une erreur `500` : Meta renverra l'événement (aucune perte).

**Idempotence.** `processed_messages.wamid` unique. Insertion via `prisma.processedMessage.create` ; le code d'erreur Prisma de violation d'unicité (`P2002`) signifie « déjà traité » : on ignore. Aucun `SELECT` préalable (condition de concurrence).

**Verrous et références.** Dans la transaction de création de commande :

1. `INSERT INTO daily_counters (day, last_seq) VALUES (?, 1) ON DUPLICATE KEY UPDATE last_seq = last_seq + 1` (via `$executeRaw` paramétré) : cette instruction pose le verrou de ligne jusqu'au `COMMIT`.
2. `SELECT last_seq FROM daily_counters WHERE day = ?` dans la même transaction (lecture cohérente après verrou).
3. Référence : `CMD-` + `AAAAMMJJ` (jour UTC) + `-` + séquence complétée à 3 chiffres ; au-delà de 999, la séquence s'écrit sur 4 chiffres ou plus (PO-23).

Verrou du brouillon : première instruction de la transaction `SELECT id, vendor_id, status, expires_at, payload FROM order_drafts WHERE public_id = ? FOR UPDATE` (`$queryRaw` paramétré). Les décisions (statut, propriétaire, expiration) se prennent sur cette lecture verrouillante, jamais sur une lecture antérieure.

**Accès aux données.** Prisma uniquement ; SQL brut limité à : verrous `FOR UPDATE`, compteur journalier, agrégats de statistiques. Toujours en gabarits étiquetés (`$queryRaw\`...\``, `$executeRaw\`...\``) ou paramètres liés ; `$queryRawUnsafe` et `$executeRawUnsafe` sont **interdits** (NF-S4).

**Identifiants BIGINT.** Le DAT impose `BIGINT UNSIGNED` ; Prisma les expose en `bigint` JavaScript, que `JSON.stringify` ne sait pas sérialiser. Règles :

- Aucun patch global de `BigInt.prototype.toJSON`.
- Les controllers ne renvoient jamais d'entité Prisma brute : ils renvoient des **objets de réponse** (classes `*ResponseDto` + mapper dans le service ou une fonction `toXxxResponse`) où les ids sont convertis en `number` (aux volumes visés, jamais au-delà de 2^53).
- Les paramètres `:id` sont validés par `ParseIntPipe` (entier > 0) puis convertis en `BigInt` à l'entrée du service.
- Les montants (`INT UNSIGNED`) et quantités restent des `number`.

**Montants.** Entiers en XOF. Le total est toujours calculé côté serveur par `computeTotal(items)` (fonction pure dans `src/common/money/`), qui renvoie aussi une erreur si le total dépasse le plafond (PO-01).

**Dates.** Stockées et manipulées en UTC (= heure d'Abidjan). Le jour de la référence et des statistiques est le jour UTC. Formatage d'affichage (reçu, messages) avec `Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan' })`.

### Architecture frontend

Non applicable (voir Stack).

### API

- **REST uniquement**, JSON `camelCase`, tout sous `/api/v1` via `app.setGlobalPrefix('api/v1')` **sans exclusion** (webhook et `/health` inclus, PO-03).
- **Versionnement** : préfixe d'URL `/api/v1` en dur ; pas de versionnement Nest par en-tête.
- **Authentification** : JWT Bearer (8 h, `JWT_SECRET`), garde globale `APP_GUARD` (`JwtAuthGuard`) ; décorateur `@Public()` sur `POST /auth/login`, `GET|POST /whatsapp/webhook`, `GET /health` (PO-02). La stratégie JWT recharge l'utilisateur et refuse un compte inactif ou de rôle autre qu'`admin`. Le rôle `admin` est vérifié par la stratégie (rôle unique) : pas de `RolesGuard` générique.
- **Pagination** : `?page=1&limit=20`, `limit` maximal 100, réponse `{ data, meta: { page, limit, total } }`. `limit > 100` : `400` (PO-21).
- **Erreurs** : format Nest standard `{ statusCode, message, error }`. Pas de format personnalisé. Exceptions métier = exceptions HTTP Nest (`NotFoundException`, `ConflictException`, `BadRequestException`, `UnauthorizedException`) avec message en français. Messages de `class-validator` laissés tels quels (le backoffice ne les affiche pas à la lettre) **[HYPOTHÈSE À VALIDER PAR LE CLIENT]**.
- **Filtre d'exceptions global** : transforme les erreurs Prisma connues (`P2002` en `409`, `P2025` en `404`) et toute erreur inattendue en `500 { statusCode: 500, message: 'Erreur interne', error: 'Internal Server Error' }`, sans fuite de trace ni de SQL ; l'erreur réelle est journalisée.
- **Validation globale** : `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- **CORS** limité à `CORS_ORIGIN` ; **Swagger** sur `/api/docs` uniquement si `NODE_ENV !== 'production'` ; écoute sur `127.0.0.1` ; `app.set('trust proxy', 1)` (Nginx devant) pour que le throttler voie l'IP réelle.
- **Throttler** : `ThrottlerModule` configuré, mais **aucun guard global**. `ThrottlerGuard` est appliqué par `@UseGuards` uniquement sur `POST /auth/login` avec `@Throttle({ default: { limit: 5, ttl: 60_000 } })` (le webhook Meta ne doit jamais être limité).
- **Taille de corps** : limite JSON 256 ko (les payloads Meta sont petits ; limite l'abus de `webhook_logs`).
- **Webhook** : voir DAT section 5, avec ces précisions : comparaison de signature via `timingSafeEqual` après contrôle de longueur égale ; vérification extraite dans une fonction pure `verifyMetaSignature(rawBody, header, secret)` ; un payload JSON valide mais de structure inattendue est journalisé, répond `200` et n'est pas traité (PO-29). Un corps JSON syntaxiquement invalide est rejeté `400` par l'analyseur Express avant le contrôleur (Meta n'en envoie jamais) **[HYPOTHÈSE À VALIDER PAR LE CLIENT]**.
- **Routes** : celles du DAT section 7, inchangées. Aucune route de suppression de vendeur, aucune route d'inscription.

---

## Conventions

### Backend

**Structure d'un module** (dossier `src/<module>/`)

```text
src/orders/
  orders.module.ts
  orders.controller.ts          # fin : DTO -> service -> réponse
  orders.service.ts             # logique métier, transactions
  orders.service.spec.ts        # test unitaire colocalisé
  order-status.ts               # constantes et table de transitions (fonctions pures)
  order-status.spec.ts
  dto/
    list-orders.query.dto.ts
    update-order.dto.ts
    change-status.dto.ts
    order-response.dto.ts
  index.ts                      # API publique du module (exports autorisés pour les autres modules)
```

**Dossiers transverses**

```text
src/
  main.ts                       # bootstrap (préfixe, pipes, filtres, CORS, rawBody, Swagger, logger)
  app.module.ts
  common/
    decorators/                 # @Public(), @CurrentUser()
    guards/                     # JwtAuthGuard
    filters/                    # AllExceptionsFilter
    pagination/                 # PaginationQueryDto, paginate(), PageResponse<T>
    phone/                      # normalizeCiPhone(), normalizeVendorNumber(), maskPhone()
    money/                      # computeTotal(), formatXof()
    text/                       # normalizeForMatch() (minuscules, sans accents, espaces compactés)
  config/                       # env.validation.ts (schéma Joi), config.module.ts, typage de la config
  prisma/                       # PrismaModule, PrismaService, type PrismaTx
  generated/prisma/             # client Prisma généré (ignoré par Git)
  auth/ users/ vendors/ orders/ whatsapp/ (client/) bot/ receipts/ stats/
prisma/                         # schema.prisma, migrations/, seed.ts (+ prisma.config.ts à la racine)
assets/fonts/                   # polices Roboto pour pdfmake
test/                           # *.e2e-spec.ts, helpers (app de test, reset de base, mock WhatsappClient)
```

**Règles**

1. **Controllers fins** : pas de logique, pas d'accès Prisma, pas de calcul. Ils déclarent routes, DTO, Swagger, appellent un service, renvoient un objet de réponse.
2. **Logique métier dans les Services** ; fonctions pures dans des fichiers dédiés (`parse-order.ts`, `format-recap.ts`, `order-status.ts`) importés par les services.
3. **Pas de couche Repository.** Les services utilisent `PrismaService`.
4. **Pas d'Actions, pas de CQRS, pas d'événements** (voir Patrons).
5. **Dépendances entre modules** : un module n'importe que l'`index.ts` d'un autre module (jamais un chemin profond). Les dépendances autorisées sont exactement celles du graphe ci-dessus. `orders`, `vendors`, `users`, `stats` n'importent jamais `bot` ni `whatsapp`. Le code-reviewer rejette toute violation.
6. **DTO** : une classe par entrée, `class-validator` + `class-transformer`, suffixes `.dto.ts` (`CreateVendorDto`, `ListOrdersQueryDto`). Les entrées (corps, requête) sont validées par DTO ; les sorties sont des `*ResponseDto` explicites. Les noms de propriétés sont en `camelCase`. `@ApiProperty` sur les DTO exposés.
7. **`import type` et métadonnées de décorateurs.** Avec `isolatedModules` + `emitDecoratorMetadata`, tout type (interface, alias) apparaissant dans une signature décorée s'importe avec `import type` ; toute classe injectée ou utilisée comme DTO s'importe normalement (jamais `import type`, sinon l'injection échoue). Les enums de DTO sont des tableaux `as const` + `@IsIn(...)`.
8. **Imports relatifs en `.js`** (ESM) : `import { X } from './x.js'`. Pas d'alias de chemin supplémentaire.
9. **Typage** : pas de `any` (sauf `unknown` + garde de type). Les payloads Meta sont typés par des interfaces minimales dans `src/whatsapp/meta.types.ts` et validés à la main (garde de type), pas par DTO.
10. **Nommage** : fichiers en `kebab-case` (`parse-order.ts`), classes en `PascalCase`, constantes en `UPPER_SNAKE_CASE`, colonnes en `snake_case` avec `@map` / `@@map` dans `schema.prisma` (modèles Prisma en `PascalCase` singulier : `Vendor`, `Order`, `OrderItem`, `OrderStatusHistory`, `OrderDraft`, `DailyCounter`, `ProcessedMessage`, `WebhookLog`, `User`).
11. **Erreurs** : exceptions HTTP Nest dans les services ; messages en français ; aucune chaîne en dur répétée (constantes). Le bot, lui, ne lève pas d'exception pour une erreur d'usage : il répond au vendeur ; toute exception inattendue est capturée au niveau du processor et journalisée.
12. **Catalogue de messages du bot** : tous les textes envoyés aux vendeurs sont dans `src/bot/messages.ts` (fonctions pures retournant des chaînes), jamais en ligne dans les services (PO-08).
13. **Configuration** : lecture via `ConfigService` typé ; jamais `process.env` hors `config/` et `prisma.config.ts`. Schéma Joi complet (toutes les variables du DAT section 8, `Joi.required()` hors valeurs par défaut documentées : `PORT=3000`, `DRAFT_TTL_MINUTES=30`, `RECEIPT_FORMAT=A5`, `JWT_EXPIRES_IN=8h`). L'application refuse de démarrer si une variable manque.
14. **Logs** (pino, JSON) : redaction de `req.headers.authorization` et `req.headers["x-hub-signature-256"]` ; jamais de token, mot de passe, `WHATSAPP_TOKEN`, `META_APP_SECRET` ni payload brut Meta dans les logs applicatifs (le payload brut va uniquement dans `webhook_logs`) ; téléphones clients masqués via `maskPhone()` (`07****0707`) ; numéros WhatsApp vendeurs masqués de la même façon. Journalisation des erreurs 4xx de Meta avec le corps de la réponse (sans l'en-tête `Authorization`).
15. **Sécurité des requêtes** : voir « Accès aux données » (pas d'`Unsafe`).
16. **Transactions** : `prisma.$transaction(async (tx) => ...)` pour toute écriture multi-tables ; un service qui accepte un `tx` optionnel utilise `const db = tx ?? this.prisma`.
17. **Pas de suppression physique** de vendeurs, commandes ou utilisateurs. Seules suppressions : purge des brouillons, des `webhook_logs` (90 jours) et le `ON DELETE CASCADE` du schéma.

**Tests (Vitest)**

- **Unitaires** : `*.spec.ts` colocalisés dans `src/`. Fonctions pures testées sans Nest. Services testés avec un `PrismaService` simulé (`vi.fn()`), via `Test.createTestingModule(...).useMocker` ou `overrideProvider`.
- **E2E** : `test/*.e2e-spec.ts`, avec `supertest` sur une application Nest complète et une **vraie base MySQL de test** (`commandes_test`, variable `DATABASE_URL` dans `.env.test`, jamais la base de développement). Raison : les verrous `FOR UPDATE`, la concurrence des références et les contraintes d'unicité ne se testent pas avec des mocks. Les fichiers e2e s'exécutent en série (`fileParallelism: false` dans `vitest.config.e2e.ts`) ; chaque fichier remet la base à zéro (`TRUNCATE` dans un helper `test/helpers/reset-db.ts`).
- **`WhatsappClient` toujours simulé** : `overrideProvider(WhatsappClient).useValue({ sendText: vi.fn(), sendButtons: vi.fn() })`. Aucun appel réel à Meta, jamais, y compris en e2e. Le test de `WhatsappClient` lui-même mocke `HttpService` (retry une fois après 2 s avec `vi.useFakeTimers()`, pas de retry en 4xx).
- Helper de signature `test/helpers/sign.ts` : calcule `sha256=` + HMAC pour construire des POST webhook réalistes.
- Convention de nommage des tests : `describe('<unité>')` + `it('<comportement attendu en français>')`. Un test par critère d'acceptation sensible (voir les US de `docs/00-specs.md`).
- Seuil : couverture non imposée en pourcentage, mais `parseOrder`, `verifyMetaSignature`, la table de transitions, `computeTotal`, `normalizeCiPhone` et la génération de référence doivent être couverts à 100 % des branches.
- Commandes : `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm build` doivent passer à la fin de chaque étape.

**Dépendances** : toute nouvelle dépendance hors de la liste « Stack retenue » nécessite l'accord du Team Lead.

### Frontend

Non applicable (dépôt backend uniquement).

### Git

- Branche principale : `main`. Une branche par étape ou tâche : `feat/step-<n>-<slug>` (ex. `feat/step-3-orders`), `fix/<slug>`, `chore/<slug>`.
- Commits : Conventional Commits en français ou anglais, cohérents dans un même commit : `feat(orders): ajouter les transitions de statut`, `fix(bot): ...`, `test(...)`, `chore(...)`, `docs(...)`. Scopes = noms de modules.
- Un commit ne mélange jamais le schéma Prisma et du code métier sans lien.
- `.env` jamais versionné ; `.env.example` versionné (toutes les variables, sans secret). `src/generated/` ignoré. Le dossier `docs/` est versionné.
- Revue avant fusion : code-reviewer (cf. orchestration), puis qa-analyst, puis pentester-security.

---

## Modules

Huit modules métier du DAT, plus deux modules techniques (`prisma`, `common`/`config`) qui ne portent aucune fonctionnalité. Aucun module n'est ajouté par rapport au DAT ; `WhatsappClientModule` est une scission interne de `whatsapp` (voir Architecture).

| Module | Responsabilité | Dépend de | User stories |
| --- | --- | --- | --- |
| `config` | Validation Joi du `.env`, config typée | : | NF-S2 |
| `prisma` | `PrismaService` (driver adapter MySQL), type `PrismaTx`, arrêt propre | `config` | : |
| `common` | Décorateurs, garde JWT, filtre d'erreurs, pagination, utilitaires `phone`, `money`, `text` | : | transverse |
| `users` | Lecture de l'utilisateur admin (par id, par e-mail) | `prisma` | AUTH-04 (seed) |
| `auth` | `POST /auth/login`, `GET /auth/me`, stratégie JWT, argon2 | `users` | AUTH-01 à 03 |
| `vendors` | CRUD sans suppression, recherche par numéro WhatsApp, normalisation du numéro | `prisma`, `common` | VEN-01 à 03 |
| `orders` | Création transactionnelle (référence), liste/filtres, compteurs, détail, correction, transitions de statut, historique | `prisma`, `common` | CMD-01 à 06 |
| `whatsapp/client` | `WhatsappClient` : `sendText`, `sendButtons`, retry unique, journalisation des 4xx | `config` | BOT-16 |
| `whatsapp` | GET/POST webhook, signature, `webhook_logs`, idempotence, normalisation, purge 90 jours | `bot`, `prisma`, `config` | BOT-01 à 04 |
| `bot` | `parseOrder`, commandes de secours, brouillons, récapitulatif, boutons, messages, tâche d'expiration | `vendors`, `orders`, `whatsapp/client`, `prisma` | BOT-05 à 15 |
| `receipts` | PDF unitaire et groupé (pdfmake) | `orders`, `config` | REC-01, REC-02 |
| `stats` | Agrégats : overview, by-vendor, by-day | `prisma`, `common` | STAT-01 à 03 |
| `health` (contrôleur dans `app`) | `GET /health` (public) : application + `SELECT 1` | `prisma` | NF-F5 |

Sens unique de dépendance (inchangé) : `whatsapp` → `bot` → (`orders`, `vendors`) ; `bot` → `whatsapp/client`. `orders` ne connaît ni WhatsApp ni le bot.

---

## Décisions sur les points ouverts

Rappel : PO-01 et PO-30 sont **validés par le client**. Toutes les autres décisions ci-dessous restent des **hypothèses à valider par le client** (non contestées à ce jour). Elles sont codées derrière des constantes ou fonctions isolées pour être modifiables sans refonte.

### Décisions prioritaires

#### PO-01 : INT UNSIGNED contre total maximal
- **Décision** : le schéma reste celui du DAT (`total_amount INT UNSIGNED`, `unit_price INT UNSIGNED`). Un plafond métier est imposé par le serveur : **`MAX_ORDER_TOTAL = 4 294 967 295` F**, exactement le maximum du type (constante dans `src/common/money/`). `computeTotal` rejette tout total supérieur ; le sous-total d'une ligne n'est pas stocké, donc seul le total compte. Les calculs JavaScript restent exacts (le maximum théorique 299,7 milliards est inférieur à 2^53).
- **Effets** : dans `parseOrder`, l'erreur « Le total de la commande dépasse 4 294 967 295 F : scindez la commande. » est ajoutée à la liste d'erreurs (même plafond lors de `PATCH /orders/:id` avec `items`, réponse `400`). Les agrégats de statistiques peuvent dépasser le type de colonne : les sommes sont lues en `bigint`/`Decimal` côté SQL et converties en `number`.
- **Pourquoi** : le plafond du type est la contrainte réelle ; elle ne change pas le DAT et n'invente aucun seuil métier. Si le client veut un plafond plus réaliste (ex. 100 000 000 F), seule la constante change. Élargir le type en `BIGINT` est écarté (écart avec le DAT).
- **[VALIDÉ PAR LE CLIENT]** (plafond `MAX_ORDER_TOTAL` = 4 294 967 295 F confirmé).

#### PO-06 : récapitulatif de plus de 1 024 caractères
- **Décision** : `formatRecap(draftPayload)` est appelé **avant** toute écriture en base. Si le texte dépasse 1 024 caractères : **aucun brouillon n'est créé**, le bot répond avec le message fixe « Cette commande est trop longue pour être récapitulée en un seul message. Scindez-la en deux messages (moins d'articles par message) et renvoyez-les séparément. ».
- **Flux modifié (étapes 5 et 6 du déroulement)** : parse → calcul du total → formatage du récapitulatif → contrôle de longueur → création du brouillon → envoi. Le titre des boutons (≤ 20 caractères) est une constante vérifiée par test.
- **[HYPOTHÈSE À VALIDER PAR LE CLIENT]**

#### PO-07 : ambiguïtés de parsing des articles
Règles ajoutées à R-P1 à R-P8 (toutes testées dans `parse-order.spec.ts`) :
- **Libellés de champ uniquement en début de ligne** (après espaces éventuels), suivis de `:`, `=` ou `-`. Le motif le plus long gagne (`lieu de livraison` avant `livraison`). Un mot « livraison » au milieu d'une phrase n'est donc jamais un libellé. Un message d'une seule ligne (« Nom: X Tel: Y ... ») n'est pas pris en charge et produit les erreurs de champs manquants avec le modèle.
- **Libellé en double** : erreur « Champ en double : <champ> ». **Texte avant le premier libellé** : ligne ignorée si vide, sinon erreur « Ligne non reconnue : ... ».
- **Signe de multiplication** (`x`, `X`, `×`, `*`) : on retient la **dernière occurrence** d'un signe qui est précédé d'un espace ou d'un chiffre (ou du début) et suivi d'un prix valide jusqu'à la fin de l'article. Ainsi `robe XL x 15000` donne le libellé « robe XL » ; `taxi x 5000` donne « taxi » ; `box 5000` n'a pas de signe et provoque « Prix manquant pour : box ». Forme collée acceptée : `2x15000`.
- **Quantité** : un entier de 1 à 3 chiffres en tête de l'article, suivi d'un espace, est toujours la quantité (« 3 pièces wax x 5000 » = quantité 3, libellé « pièces wax »). Un entier en tête hors 1 à 999 (ex. « 1000 perles ») déclenche l'erreur de quantité hors limites, jamais une interprétation silencieuse.
- **Séparateurs d'articles** : retour à la ligne, `;`, `,`. La virgule **n'est pas** un séparateur de milliers : un motif `\d,\d{3}` dans un article déclenche l'erreur « Prix invalide dans « ... » : écrivez 15000 ou 15 000 (sans virgule). »
- **Prix** acceptés : `15000`, `15 000`, `15.000`, `15000F`, `15000 FCFA` (insensible à la casse, `F`/`FCFA`/`CFA` en suffixe). `15.5` ou `15.50` (décimal) : erreur « Prix invalide ».
- **Normalisation du libellé d'article** : espaces compactés, 190 caractères maximum (colonne `label`) sinon erreur. Nom ≤ 120, lieu ≤ 255 caractères sinon erreur.
- **[HYPOTHÈSE À VALIDER PAR LE CLIENT]**

#### PO-11 : Modifier / Annuler sur un brouillon non `pending`
- **Décision** : aucune modification en base. Modifier et Annuler (bouton) utilisent une mise à jour conditionnelle (`UPDATE ... WHERE public_id = ? AND vendor_id = ? AND status = 'pending'`, vérifier le nombre de lignes affectées) pour éviter les courses.
  - Brouillon `confirmed` : « La commande CMD-... est déjà enregistrée. Pour la modifier ou l'annuler, contactez l'administration. » (référence réelle de la commande liée).
  - Brouillon `expired` / `cancelled` ou expiré par date : « Ce récapitulatif n'est plus valide, renvoyez la commande. »
  - Brouillon inconnu, d'un autre vendeur ou identifiant de bouton mal formé : même message « n'est plus valide » (PO-10), sans divulgation.
- **Lien brouillon confirmé / commande** : la commande liée est retrouvée sans colonne supplémentaire (le schéma DAT n'a pas de `draft_id` sur `orders`). Décision : **`order_drafts.payload` reçoit, à la confirmation, une propriété `orderReference`** (le payload est du JSON libre) ; le message de double clic et celui de PO-11 la lisent.
- **[HYPOTHÈSE À VALIDER PAR LE CLIENT]**

#### PO-20 : définitions des statistiques
- **(a) Période** : `from` et `to` portent sur `orders.created_at`. **(b)** Bornes incluses en jours entiers UTC (`from` à 00:00:00.000, `to` à 23:59:59.999) ; `from > to` : `400`. **(c)** Période par défaut si absente : les 30 derniers jours, aujourd'hui inclus.
- **Nombre total de commandes** : toutes les commandes de la période, tous statuts confondus. **(d) Montant total** : somme de `total_amount` **hors statut `annulee`** (les `echec` sont inclus : la commande a eu lieu).
- **Répartition par statut** : les 6 statuts toujours présents (0 si vide), sur les mêmes commandes.
- **Taux de livraison / taux d'échec** : en pourcentage avec une décimale (ex. `80`, `33.3`), `livree ÷ (livree + echec)` et `echec ÷ (livree + echec)`, calculés sur les commandes **créées** dans la période **dont le statut actuel** est `livree` ou `echec`. **(e)** Si le dénominateur vaut 0 : `null` pour les deux taux (jamais 0 ni erreur).
- **Délai moyen de validation** : moyenne en heures (une décimale) entre `orders.created_at` et la **première** entrée `to_status = 'validee'` de `order_status_history`, pour les commandes créées dans la période ayant une telle entrée. **(f)** Aucune : `null`.
- **by-day (g)** : un élément par jour de la période, jours sans commande à `count: 0`, `amount: 0` ; jour = date UTC de `created_at`. Le nombre de commandes compte tous les statuts, le montant exclut `annulee` (cohérence avec overview).
- **by-vendor (h)** : tous les vendeurs (actifs et inactifs) sont listés, y compris ceux sans commande (`count: 0`, `amount: 0`), même règle de comptage que by-day.
- Implémentation : `groupBy` Prisma pour statuts et vendeurs, `$queryRaw` (gabarit étiqueté) pour le délai et le regroupement par jour.
- **[HYPOTHÈSE À VALIDER PAR LE CLIENT]**

### Autres points ouverts

| PO | Décision par défaut | À valider |
| --- | --- | --- |
| PO-02 | `GET /health` est public, au même titre que login et webhook. | Oui |
| PO-03 | Tout sous `/api/v1`, y compris `/health` et le webhook (`/api/v1/health`, `/api/v1/whatsapp/webhook`). | Oui |
| PO-04 | Pas de libellé `Notes` dans le modèle ; `notes` n'est alimenté que par l'admin (`PATCH /orders/:id`). | Oui |
| PO-05 | Sous-total affiché uniquement si quantité supérieure à 1 (comme l'exemple du DAT). | Oui |
| PO-08 | Tous les textes dans `src/bot/messages.ts` ; libellés des statuts dans `mes commandes` : « Non traitée », « Validée », « Prête », « Livrée », « Échec », « Annulée ». Les textes d'`aide`, de Modifier et de `mes commandes` sont rédigés par le backend-builder en français simple et revus par le client avant l'étape 5 terminée. | Oui, catalogue à relire |
| PO-09 | `annuler` sans brouillon : « Aucune commande en attente à annuler. » ; `mes commandes` sans commande : « Vous n'avez encore aucune commande. » | Oui |
| PO-10 | Clic sur brouillon inconnu, d'un autre vendeur ou identifiant mal formé : « Ce récapitulatif n'est plus valide, renvoyez la commande. » | Oui |
| PO-12 | Aucune annulation d'une commande enregistrée côté vendeur ; seul l'admin change les statuts. | Oui |
| PO-13 | La liste blanche est contrôlée **en premier**, y compris pour les messages non texte : un inconnu reçoit « Ce numéro n'est pas autorisé à passer commande. », jamais le message « Seuls les messages texte… ». Le module `whatsapp` normalise un type non pris en charge en `{ type: 'unsupported' }` et laisse le bot répondre. | Oui |
| PO-14 | Correction refusée hors `non_traitee`/`validee` : `409`. Règles de validation de `PATCH /orders/:id` identiques à `parseOrder` (téléphone 10 chiffres après normalisation, quantité 1-999, prix 1-10 000 000, 1 à 30 articles, nom ≤ 120, lieu ≤ 255, libellé ≤ 190, notes ≤ 1 000 caractères, plafond de total PO-01). Les corrections ne sont pas tracées dans `order_status_history` (seulement les statuts). | Oui |
| PO-15 | Numéro vendeur : après retrait des espaces, points, tirets et du `+`, accepter `225` + 10 chiffres, `00225` + 10 chiffres, ou 10 chiffres locaux (préfixés par `225`) ; tout le reste (numéro étranger, longueur incorrecte) : `400`. Résultat stocké : `225` + 10 chiffres (13 chiffres). | Oui |
| PO-16 | Numéro vendeur en doublon : `409 Conflict`. | Oui |
| PO-17 | Utilisateur `is_active = 0` : connexion refusée en `401` (même message que des identifiants faux) ; JWT d'un compte désactivé refusé en `401`. Pas de route de gestion de compte. | Oui |
| PO-18 | Seed idempotent : si un utilisateur existe déjà pour `ADMIN_EMAIL`, il n'est ni recréé ni modifié ; message de log, code de sortie 0. | Oui |
| PO-19 | Reçus groupés : 1 à 100 identifiants (`400` sinon) ; doublons dédoublonnés ; si un identifiant n'existe pas : `404` sans rien générer ; ordre des pages = ordre reçu ; tous statuts acceptés. | Oui |
| PO-21 | `limit > 100` : `400` ; bornes `from`/`to` de `GET /orders` incluses en jours entiers UTC ; recherche `search` : référence (préfixe ou égalité), nom (contient), téléphone (contient, sur les chiffres saisis) ; pas de pagination sur `GET /vendors`. | Oui |
| PO-22 | `DRAFT_TTL_MINUTES` fait foi (défaut 30). | Oui |
| PO-23 | Séquence au-delà de 999 : 4 chiffres et plus, sans plafond ; colonne `reference` de 24 caractères suffisante. | Oui |
| PO-24 | Risque accepté (wamid enregistré avant traitement). Atténuation : en cas d'exception pendant le traitement d'un message, le processor journalise l'erreur puis tente d'envoyer au vendeur « Une erreur est survenue, veuillez renvoyer votre message. » (échec de cet envoi : journalisé et ignoré). | Oui |
| PO-25 | Pas de purge de `processed_messages` (fidèle au DAT). | Oui |
| PO-26 | Les GET de vérification du webhook sont journalisés dans les logs applicatifs (sans le jeton), pas dans `webhook_logs`. | Oui |
| PO-27 | Distinction « Valider » (bouton vendeur, crée une commande `non_traitee`) / statut `validee` (admin) mentionnée dans le texte d'`aide`. | Oui |
| PO-28 | Aucune notification du vendeur sur changement de statut ; il consulte `mes commandes`. | Oui |
| PO-29 | JSON valide à structure inattendue : journalisé dans `webhook_logs`, réponse `200`, aucun traitement. | Oui |
| PO-30 | Node 24 LTS, voir Stack. | **Validé par le client** |

---

## Schéma de données

Neuf tables, **exactement celles du DAT section 4** (noms, types, index, contraintes). Le détail est réservé au db-architect, qui traduit le DAT en `prisma/schema.prisma` sans rien ajouter ni retirer (règles de mapping ci-dessous).

Entités et relations :

```text
users                 (indépendante)
vendors 1 ──── * orders
vendors 1 ──── * order_drafts
orders  1 ──── * order_items            (ON DELETE CASCADE)
orders  1 ──── * order_status_history   (ON DELETE CASCADE ; changed_by_user_id NULL = bot, sans FK dans le DAT)
daily_counters, processed_messages, webhook_logs   (indépendantes)
```

**Règles de traduction vers Prisma (à respecter par le db-architect)**

- `@@map` en `snake_case` pour les tables, `@map` pour les colonnes ; modèles en `PascalCase`.
- Types MySQL non signés : `@db.UnsignedBigInt`, `@db.UnsignedInt`, `@db.UnsignedSmallInt` ; `DATETIME(3)` : `@db.DateTime(3)` ; `JSON` : `Json` ; `TINYINT(1)` : `Boolean` ; `DATE` : `@db.Date` ; `CHAR(12)` : `@db.Char(12)`.
- Énumérations de statut : `enum` Prisma mappés sur `ENUM` MySQL pour `orders.status`, `order_drafts.status`, `users.role` ; les colonnes `order_status_history.from_status/to_status` restent `VARCHAR(20)` comme dans le DAT.
- Valeurs par défaut `CURRENT_TIMESTAMP(3)` : `@default(now())` ; `updated_at` : `@updatedAt`.
- **Aucune colonne ni table supplémentaire** par rapport au DAT (ex. pas de `draft_id` sur `orders` : voir PO-11). Si le db-architect estime un ajout nécessaire, il le signale au Team Lead sans l'implémenter.
- Index requis : ceux du DAT (`reference` unique, `status`, `vendor_id`, `created_at`, `public_id` unique, `vendor_id`/`expires_at` sur brouillons, `wamid` unique, `order_id` sur l'historique, `created_at` sur `webhook_logs`). La recherche `search` (contient) sur nom et téléphone fonctionne sans index à ce volume.
- Migration initiale unique, appliquée avec `prisma migrate deploy` en production.

---

## Infrastructure

Besoins réels et non-besoins :

| Besoin | Décision |
| --- | --- |
| Hébergement | VPS Debian existant (DAT) ; pas de fournisseur cloud imposé. |
| Reverse proxy / HTTPS | Nginx + Let's Encrypt (Certbot), l'application n'écoute que sur `127.0.0.1:3000`. HTTPS exigé par Meta. |
| Processus | PM2 (`pm2 start dist/main.js --name commandes-api`), `pm2 save`, démarrage au boot, rotation des logs PM2. |
| Base | MySQL 8.4 LTS (ou 8.0), base `commandes`, utilisateur dédié aux droits limités ; sauvegarde `mysqldump` nocturne conservée 14 jours avec copie hors serveur. |
| Cache, file, Redis, WebSocket | **Aucun** (hors périmètre). |
| Planificateur | `@nestjs/schedule` dans le processus : toutes les heures (brouillons : `pending` expirés en `expired`, purge des finalisés de plus de 7 jours) et chaque nuit (purge `webhook_logs` de plus de 90 jours). Fuseau `Africa/Abidjan` (`TZ`). |
| Stockage de fichiers | Aucun (PDF générés à la volée, non stockés). |
| Moteur de recherche | Aucun (`LIKE` sur colonnes). |
| Notifications | Uniquement les réponses WhatsApp dans la fenêtre de 24 h ; aucun template payant. |
| Supervision | Vérification externe de `GET /api/v1/health` par l'outil de supervision existant du client. Pas d'outil de monitoring ajouté. |
| Développement local | Laragon (MySQL local), tunnel HTTPS (cloudflared ou ngrok) pour tester le webhook avec Meta. |
| Instance multiple | Interdit : le traitement asynchrone et les tâches planifiées supposent **une seule instance** (PM2 en mode `fork`, 1 instance). Les verrous MySQL protègent néanmoins la cohérence des données. |

Variables d'environnement : celles du DAT section 8 (`NODE_ENV`, `PORT`, `TZ`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `META_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `WABA_ID`, `GRAPH_API_VERSION`, `DRAFT_TTL_MINUTES`, `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, `RECEIPT_COMPANY_NAME`, `RECEIPT_FORMAT`). Aucune variable ajoutée. `GRAPH_API_VERSION` n'a pas de valeur par défaut codée en dur (valeur à relever dans la documentation Meta lors de l'étape 4).

---

## Plan de réalisation

Suit les 8 étapes du DAT section 9. **Règle de travail : une étape à la fois ; à la fin de chaque étape, écrire et lancer les tests, puis s'arrêter pour validation avant d'attaquer la suivante.** Après chaque étape : code-reviewer, puis qa-analyst, puis (avant l'étape 8) pentester-security, selon l'orchestration du Team Lead. Le détail atomique (identifiants, dépendances, critères, statut) est dans `docs/02-tasks.md`, qui fait foi pour le découpage ; ce plan fait foi pour le périmètre. Ajustement : DB-001 dépend de BE-001 (Prisma installé avant le schéma).

Agents : `db-architect` (schéma/migrations), `backend-builder` (code NestJS), `code-reviewer`, `qa-analyst`, `pentester-security`, `devops-sre`. Pas de `ux-ui-designer`, `frontend-builder` ni `ai-engineer`.

### Étape 1 : Socle

Tâches : DB-001 (schema.prisma, migration, prisma.config.ts), BE-001 (dépendances, points V-1 à V-4, nettoyage du starter, `.env.example`, config Vitest), BE-002 (module `config`), BE-003 (`PrismaService`), BE-004 (`main.ts`, `common/`, pino), BE-005 (`/health`), BE-006 (seed idempotent).

Terminé quand : `pnpm build` et `pnpm start` démarrent (et refusent de démarrer s'il manque une variable) ; la migration s'applique sur une base vide ; `/api/v1/health` répond 200 (et 503 base coupée) ; le seed crée l'admin et une seconde exécution ne change rien ; `pnpm test`, `pnpm lint` passent ; le test d'injection de dépendances Vitest passe.

### Étape 2 : Accès

Tâches : BE-010 (`users`), BE-011 (`auth`, guard global, `@Public()`), BE-012 (normalisation des numéros), BE-013 (`vendors`).

Terminé quand : toute route hors login, webhook et health répond 401 sans jeton ; login OK et JWT 8 h ; un vendeur se crée (numéro normalisé), se modifie et se désactive ; doublon en 409 ; aucune route `DELETE` ni inscription ; tests e2e login/me/vendors passent.

### Étape 3 : Commandes

Tâches : BE-020 (transitions), BE-021 (`computeTotal`, plafond PO-01), BE-022 (création avec référence verrouillée), BE-023 (liste, compteurs, détail), BE-024 (PATCH commande et statut), BE-025 (test de concurrence).

Terminé quand : chaque transition autorisée et au moins les refus listés dans US-CMD-06 sont testés (409, historique inchangé) ; deux créations simultanées donnent deux références distinctes ; filtres, pagination (`limit > 100` en 400) et compteurs corrects ; correction refusée hors `non_traitee`/`validee` ; champ non autorisé refusé.

### Étape 4 : Webhook

Tâches : BE-030 (signature), BE-031 (`WhatsappClient`), BE-032 (GET/POST, `webhook_logs`), BE-033 (idempotence, processor), BE-034 (purge 90 jours).

Terminé quand : GET correct en 200 (challenge) ou 403 ; un POST signé est accepté et journalisé `signature_valid = 1` ; un POST non signé ou falsifié est refusé 403, journalisé `signature_valid = 0`, sans traitement ; le même `wamid` envoyé deux fois n'est traité qu'une fois ; une exception du traitement ne change pas le 200 ; aucun appel réel à Meta dans les tests.

### Étape 5 : Bot

Tâches : BE-040 (`parseOrder`), BE-041 (messages, `formatRecap`), BE-042 (`DraftsService`), BE-043 (`BotService`), BE-044 (tâche d'expiration), BE-045 (e2e).

Terminé quand : un message signé simulé produit un récapitulatif (via le mock) ; Valider crée la commande `non_traitee` avec sa référence et son historique ; un second clic ne crée rien et renvoie la référence ; un brouillon `expired`/`cancelled` répond « n'est plus valide » ; seul le brouillon du vendeur est actionnable ; la tâche d'expiration passe les `pending` échus en `expired` et purge selon la règle ; atomicité vérifiée.

### Étape 6 : Reçus et statistiques

Tâches : BE-050 (spike pdfmake), BE-051 (`ReceiptsService`, hauteur du ticket : hypothèse à valider par un essai d'impression), BE-052 (routes reçus), BE-053 (stats).

Terminé quand : le PDF unitaire et le PDF groupé s'ouvrent (en-tête `%PDF`, un reçu par page, A5 et `TICKET80`) ; agrégats conformes aux valeurs attendues (exemple 8 livrées / 2 échecs = 80 % / 20 %) ; cas limites PO-20 (division par zéro à `null`, jours à 0) testés.

### Étape 7 : Durcissement

Tâches : BE-060 (throttler login seulement), BE-061 (Swagger hors production), BE-062 (masquage des logs), BE-063 (e2e complète, `README.md`), REV-001, QA-001, SEC-001.

Terminé quand : `pnpm lint`, `pnpm build`, `pnpm test` et `pnpm test:e2e` passent ; le 6e login de la minute est refusé ; Swagger absent en production ; le `README` décrit installation, variables et déploiement ; verdicts QA et sécurité GO.

### Étape 8 : Mise en ligne

Tâches : OPS-001 (provisioning, peut démarrer plus tôt), OPS-002 (déploiement, après QA et sécurité GO), OPS-003 (branchement Meta avec le client).

Terminé quand : un vrai message WhatsApp envoyé depuis un destinataire autorisé crée une commande visible via `GET /api/v1/orders`.

---

## Annexes

### Récapitulatif des écarts assumés par rapport au DAT (outillage et précisions)

| Sujet | DAT | Décision | Raison |
| --- | --- | --- | --- |
| Tests | Jest | Vitest | Scaffold (CLAUDE.md). |
| Gestionnaire / lint | npm / ESLint | pnpm / oxlint | Scaffold. |
| Framework | NestJS 10+ | NestJS 12, ESM, imports `.js` | Scaffold. |
| Node | 20 LTS | 24 LTS (validé par le client) | Fin de support de Node 20 ; PO-30. |
| MySQL | 8 | 8.4 LTS recommandé, 8.0 toléré | Fin de support de 8.0. |
| Modules `whatsapp` / `bot` | dépendance mutuelle dans le tableau | `whatsapp/client` séparé | Éviter un cycle de modules Nest. |
| Throttler | « 5 tentatives par minute sur login » | Guard par route, jamais global | Ne pas limiter le webhook Meta. |
| Logs (pino) | Étape 7 | Mise en place en étape 1 (masquage vérifié en étape 7) | Logger disponible dès le début. |

### Hors périmètre rappelé

Livreurs, suivi de livraison, paiement en ligne, frais de livraison, catalogue produits, Redis, files de messages, WebSocket, templates WhatsApp payants, inscription publique, conversation libre. Toute demande en ce sens est refusée par le code-reviewer.
