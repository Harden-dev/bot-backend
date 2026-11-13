# API commandes WhatsApp

Backend NestJS d'une plateforme de prise de commandes par WhatsApp (Côte d'Ivoire).

- Les **vendeurs** envoient leurs commandes au bot WhatsApp, dans un modèle de message structuré. Le bot lit le message, renvoie un récapitulatif avec les boutons Valider / Modifier / Annuler, puis enregistre la commande avec une référence `CMD-AAAAMMJJ-NNN`.
- L'**administrateur** traite les commandes depuis un backoffice (dépôt séparé) via l'API REST : liste filtrée, corrections, statuts, reçus PDF et statistiques.

La spécification fonctionnelle et technique est le DAT, à la racine du dépôt (`DAT – Backend NestJS – Plateforme de commandes WhatsApp.md`).

## Stack

NestJS 12 (TypeScript 6, ESM), MySQL 8 via Prisma 7 (adaptateur `mariadb`), JWT (passport-jwt, argon2), `@nestjs/throttler`, `nestjs-pino`, `@nestjs/swagger`, `@nestjs/schedule`, pdfmake. Tests : Vitest et Supertest. Lint : oxlint. Formatage : Prettier.

Modules (`src/`) : `config`, `prisma`, `common`, `health`, `auth`, `users`, `vendors`, `orders`, `whatsapp` (webhook et client d'envoi Meta), `bot`, `receipts`, `stats`.

## Prérequis

- **Node.js 24** ou plus récent ;
- **pnpm** (gestionnaire de paquets du projet) ;
- **MySQL 8**, avec une base pour l'application et une base de test dont le nom finit par `_test`.

## Installation

```bash
pnpm install
```

`pnpm install` génère aussi le client Prisma (`postinstall`) dans `src/generated/prisma` (non versionné).

## Variables d'environnement

Copier `.env.example` en `.env`, puis renseigner chaque variable. Le fichier `.env` n'est jamais versionné. **Aucune valeur réelle ne doit figurer dans le dépôt.** Au démarrage, la configuration est validée par Joi : s'il manque une variable ou si une valeur est invalide, l'application refuse de démarrer et liste les erreurs.

| Variable | Rôle | Contrôle ou valeur par défaut |
| --- | --- | --- |
| `NODE_ENV` | `development`, `production` ou `test` | obligatoire ; `production` désactive Swagger |
| `PORT` | Port d'écoute (sur `127.0.0.1` uniquement) | défaut `3000` |
| `TZ` | Fuseau du processus (tâches planifiées) : `Africa/Abidjan` | obligatoire |
| `DATABASE_URL` | Connexion MySQL, schéma `mysql://` | obligatoire |
| `JWT_SECRET` | Clé de signature des JWT, aléatoire | 32 caractères au moins |
| `JWT_EXPIRES_IN` | Durée des JWT (`8h`, `30m`…) | défaut `8h` |
| `CORS_ORIGIN` | Origine du backoffice (`https://…`, sans `/` final) | obligatoire ; `https://` exigé en production |
| `META_APP_SECRET` | App Secret Meta : vérification de la signature du webhook | obligatoire |
| `WEBHOOK_VERIFY_TOKEN` | Jeton choisi, saisi aussi dans la console Meta | obligatoire |
| `WHATSAPP_TOKEN` | Jeton d'accès à l'API WhatsApp Cloud (permanent en production) | obligatoire |
| `PHONE_NUMBER_ID`, `WABA_ID` | Identifiants relevés dans la console Meta | obligatoires |
| `GRAPH_API_VERSION` | Version de l'API Graph, forme `vX.Y` | obligatoire |
| `DRAFT_TTL_MINUTES` | Durée de validité d'un récapitulatif | défaut `30` |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Compte admin créé par le seed | mot de passe de 12 caractères au moins |
| `RECEIPT_COMPANY_NAME` | Nom imprimé sur les reçus | obligatoire |
| `RECEIPT_FORMAT` | `A5` ou `TICKET80` (ticket de 80 mm) | défaut `A5` |

Sous Git Bash (Windows), `TZ` n'est pas transmise aux programmes Windows : la définir dans `.env` ou lancer l'application depuis PowerShell.

## Base de données

Créer la base (jeu de caractères `utf8mb4`), puis appliquer les migrations et créer le compte admin :

```bash
pnpm prisma:migrate:deploy     # applique prisma/migrations
pnpm prisma db seed            # crée l'admin à partir de ADMIN_* (idempotent)
```

Le seed est idempotent : si un compte existe déjà pour `ADMIN_EMAIL`, il n'est ni recréé ni modifié. Il n'existe aucune route d'inscription.

En développement, `pnpm prisma:migrate` (`prisma migrate dev`) crée une nouvelle migration à partir de `prisma/schema.prisma`. Une migration déjà appliquée n'est jamais modifiée.

## Lancement

```bash
pnpm start:dev                 # développement, rechargement à chaud
pnpm build                     # compile dans dist/
pnpm start:prod                # node dist/main.js
```

Toutes les routes sont sous `/api/v1` (plus `/api/docs` hors production). Sans jeton, seules trois routes répondent : `POST /api/v1/auth/login`, `GET|POST /api/v1/whatsapp/webhook` (authentifiée par la signature Meta) et `GET /api/v1/health` (200, ou 503 si MySQL ne répond pas). Les autres routes exigent un JWT Bearer d'admin, refusé s'il n'a pas de date d'expiration ou s'il a été émis il y a plus de `JWT_EXPIRES_IN`.

La connexion est limitée par l'application à **5 tentatives par minute et par IP** (réponse `429`). Le compteur est en mémoire : il repart de zéro à chaque redémarrage et suppose une seule instance. Une adresse IPv6 est comptée par préfixe /64. Le webhook n'est jamais limité par l'application ; ses limites de débit sont posées dans Nginx (voir Déploiement).

Un POST non signé sur le webhook est refusé (`403`). Seuls sa taille et ses 256 premiers octets sont enregistrés dans `webhook_logs`, et au plus 60 par minute ; au-delà, rien n'est écrit en base et un compteur agrégé apparaît dans les logs applicatifs. Les POST correctement signés sont enregistrés en entier.

Toutes les réponses portent `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` et `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (sauf l'interface Swagger, hors production).

## Tests

```bash
pnpm test                      # tests unitaires (*.spec.ts)
pnpm test:e2e                  # tests e2e (test/*.e2e-spec.ts) sur MySQL réel
pnpm test:cov                  # couverture
pnpm typecheck && pnpm lint    # types et lint
pnpm format                    # Prettier (src, test, prisma)
```

Les tests e2e utilisent une vraie base MySQL décrite dans un fichier **`.env.test`** (non versionné, même variables que `.env`) :

- `NODE_ENV=test` et une `DATABASE_URL` dont la base finit par `_test` ; sinon, les e2e refusent de démarrer (protection de la base de développement) ;
- migrations appliquées sur cette base, par exemple en définissant `DATABASE_URL` vers la base `_test` dans le shell avant `pnpm prisma:migrate:deploy` (la variable du shell l'emporte sur `.env`).

Les fichiers e2e s'exécutent en série et vident la base entre les tests. Les appels à Meta sont toujours simulés (aucun message réel n'est envoyé).

## Documentation de l'API (Swagger)

Hors production, la documentation est servie sur **`/api/docs`** (JSON OpenAPI : `/api/docs-json`). Pour essayer les routes protégées : `POST /api/v1/auth/login`, puis bouton « Authorize » avec l'`accessToken` obtenu.

Avec `NODE_ENV=production`, Swagger n'est pas monté : `/api/docs` répond 404. Ces chemins sont de toute façon hors de `/api/v1/`, seul préfixe transmis par Nginx.

## Déploiement

Résumé de la mise en ligne sur un VPS Debian (DAT section 9). Les chemins (`/srv/commandes-api`, `/var/backups/commandes`) et le domaine `api.example.com` sont des exemples.

1. **Serveur** : Node.js 24, pnpm, MySQL 8 et Nginx.
   - Utilisateur système dédié, non root (ex. `commandes`), propriétaire du code et du `.env` ; PM2 tourne sous cet utilisateur.
   - MySQL : `bind-address = 127.0.0.1`, base `commandes`, utilisateur MySQL dédié limité aux droits de cette base.
   - Pare-feu (`ufw`) : seulement les ports 22, 80 et 443 ouverts. Mises à jour de sécurité automatiques (`unattended-upgrades`).
2. **Application** : déployer le code dans `/srv/commandes-api`, créer le `.env` de production (`NODE_ENV=production`, `CORS_ORIGIN` en `https://`, droits `600`, propriétaire l'utilisateur du service), puis, depuis ce dossier :

   ```bash
   cd /srv/commandes-api
   pnpm audit --prod                         # aucune vulnérabilité connue attendue
   pnpm install --frozen-lockfile --prod=false
   pnpm build
   pnpm prisma:migrate:deploy
   pnpm prisma db seed
   ```

   `--prod=false` installe aussi les dépendances de développement (CLI Nest, Prisma), nécessaires au build, même si `NODE_ENV=production` est exporté dans le shell.

3. **PM2**, une seule instance (limitation de débit et file des messages en mémoire), lancé **depuis la racine du projet** (le `.env` est lu dans le dossier courant), par l'utilisateur du service :

   ```bash
   cd /srv/commandes-api && pm2 start dist/main.js --name commandes-api
   pm2 save
   pm2 startup                               # démarrage automatique au boot (commande à lancer ensuite en root)
   pm2 install pm2-logrotate                 # rotation des logs
   pm2 set pm2-logrotate:retain 14           # 14 fichiers conservés
   ```

   Les logs applicatifs sont en JSON (pino) ; ils ne contiennent ni jeton, ni mot de passe, ni signature, et les numéros de téléphone y sont masqués (`07****0707`). Ils contiennent les adresses IP et les user-agents des requêtes.

4. **Nginx** en reverse proxy HTTPS vers `127.0.0.1:3000`. Seul le préfixe `/api/v1/` est transmis. Trois limitations de débit (valeurs à ajuster selon le trafic observé) :
   - **webhook** : large, pour ne jamais gêner Meta. L'emplacement est une expression régulière insensible à la casse et tolérante à la barre finale : elle est prioritaire sur les préfixes et couvre `/api/v1/whatsapp/webhook/` ou `/api/v1/WhatsApp/Webhook`, qu'Express accepte aussi ;
   - **connexion** : en plus de la limite de l'application ;
   - **reste de l'API** : limite générale.

   ```nginx
   # Contexte http (ex. /etc/nginx/conf.d/commandes-api.conf)
   server_tokens off;
   limit_req_status 429;
   limit_req_zone $binary_remote_addr zone=webhook:10m rate=30r/s;
   limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
   limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

   server {
       listen 80;
       server_name api.example.com;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl;
       server_name api.example.com;
       # ssl_certificate et ssl_certificate_key : posés par Certbot

       add_header Strict-Transport-Security "max-age=31536000" always;
       client_max_body_size 300k;

       # Attention : ces en-têtes ne sont hérités par les « location » que si
       # aucune d'elles ne déclare son propre proxy_set_header. Si vous en ajoutez
       # un dans une location, recopiez-y aussi ces trois lignes, sinon
       # X-Forwarded-For n'est plus transmis et tous les clients partagent le
       # même compteur de limitation (n'importe qui pourrait bloquer l'admin).
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;

       # Expressions régulières : prioritaires sur « location /api/v1/ ».
       location ~* ^/api/v1/whatsapp/webhook/?$ {
           limit_req zone=webhook burst=200 nodelay;
           proxy_pass http://127.0.0.1:3000;
       }

       location ~* ^/api/v1/auth/login/?$ {
           limit_req zone=login burst=5 nodelay;
           proxy_pass http://127.0.0.1:3000;
       }

       location /api/v1/ {
           limit_req zone=api burst=50 nodelay;
           proxy_pass http://127.0.0.1:3000;
       }

       location / {
           return 404;
       }
   }
   ```

   - L'application fait confiance à un seul proxy (`trust proxy` à 1) : elle retient la dernière adresse de `X-Forwarded-For`, celle posée par Nginx (`$remote_addr`, qui écrase toute valeur envoyée par le client). Les limitations portent ainsi sur l'IP réelle du client.
   - `$binary_remote_addr` compte chaque adresse IPv6 séparément (/128), alors qu'un client en dispose souvent d'un /64 entier. Si Nginx écoute en IPv6 (`listen [::]:443`), les limites Nginx sont donc contournables en changeant d'adresse dans le /64 ; la limite de connexion de l'application, elle, compte par /64. À défaut d'une clé /64 dans Nginx, n'écouter qu'en IPv4.
   - Les autres en-têtes de sécurité (`nosniff`, `X-Frame-Options`, `Referrer-Policy`, CSP) sont posés par l'application ; Nginx ajoute HSTS et masque sa version (`server_tokens off`).
   - Test de recette : un POST sur `/api/v1/whatsapp/webhook/` (barre finale) et sur `/api/v1/WhatsApp/Webhook` doit être limité comme le chemin exact.

5. **HTTPS** : certificat Let's Encrypt avec Certbot (`certbot --nginx -d api.example.com`), renouvellement automatique ; le port 80 redirige vers 443.

6. **Sauvegardes chiffrées** : chaque nuit, `mysqldump --single-transaction` compressé puis chiffré avec [`age`](https://github.com/FiloSottile/age), conservé 14 jours, puis copié hors du serveur **une fois chiffré**. Seule la clé publique est sur le VPS ; la clé privée reste hors du VPS (poste d'administration, coffre de mots de passe), avec une copie de secours.

   ```bash
   # Une fois, hors du VPS : génère la paire de clés et affiche la clé publique.
   age-keygen -o commandes-backup.key
   age-keygen -y commandes-backup.key      # « age1… » à copier dans /etc/commandes-backup/age.pub sur le VPS

   Script `/usr/local/bin/commandes-backup.sh` (identifiants MySQL dans le
   `~/.my.cnf` de l'utilisateur de sauvegarde, en mode 600, jamais sur la ligne
   de commande) :

   ```bash
   #!/usr/bin/env bash
   # Arrêt au premier échec, y compris d'une commande au milieu d'un pipe :
   # un mysqldump en échec ne doit jamais produire une « sauvegarde » vide.
   set -euo pipefail

   dir=/var/backups/commandes
   out="$dir/commandes-$(date +%F).sql.gz.age"
   tmp="$out.tmp"

   mysqldump --single-transaction --no-tablespaces commandes \
     | gzip \
     | age -R /etc/commandes-backup/age.pub \
     > "$tmp"

   # Contrôle de taille : une base réelle ne donne jamais moins de 1 Ko.
   if [ "$(stat -c %s "$tmp")" -lt 1024 ]; then
     echo "Sauvegarde anormalement petite : $tmp" >&2
     exit 1
   fi
   mv "$tmp" "$out"

   find "$dir" -name '*.sql.gz.age' -mtime +14 -delete
   # puis copie des fichiers .age vers le stockage hors serveur (accès restreint)
   ```

   Crontab de l'utilisateur de sauvegarde : appeler le script plutôt que d'y
   coller les commandes (dans une crontab, `%` a un sens spécial et casserait
   `date +%F`). Une sortie en erreur doit déclencher une alerte (mail cron ou
   supervision) :

   ```cron
   30 2 * * * /usr/local/bin/commandes-backup.sh
   ```

   **Restauration**, avec la clé privée, sur une base vide (à tester au moins une fois avant la mise en ligne, puis régulièrement) :

   ```bash
   mysql -e "CREATE DATABASE commandes_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
   age -d -i commandes-backup.key commandes-AAAA-MM-JJ.sql.gz.age | gunzip | mysql commandes_restore
   ```

   Vérifier ensuite le nombre de commandes et la dernière référence, puis, en cas de sinistre réel, arrêter l'application (`pm2 stop commandes-api`), restaurer dans `commandes` et redémarrer.

7. **Supervision** :
   - vérification d'état sur `https://api.example.com/api/v1/health` (200 attendu) ;
   - **alerte sur l'espace disque** du VPS (ex. avertissement à 80 % d'occupation de la partition de MySQL) ;
   - **alerte sur la taille de `webhook_logs`** et sur le nombre de lignes non signées par jour, par exemple :

     ```sql
     SET SESSION information_schema_stats_expiry = 0;
     SELECT ROUND((data_length + index_length) / 1024 / 1024) AS taille_mo
       FROM information_schema.TABLES
      WHERE table_schema = 'commandes' AND table_name = 'webhook_logs';
     SELECT COUNT(*) FROM webhook_logs
      WHERE signature_valid = 0 AND created_at > NOW() - INTERVAL 1 DAY;
     ```

     Le message « Plafond de 60 requêtes webhook non signées par minute atteint » dans les logs signale une rafale de requêtes non signées.

Tâches planifiées, dans le processus : expiration et purge des brouillons (toutes les heures) et purge de `webhook_logs` au-delà de 90 jours (chaque nuit).

**Données personnelles** : les commandes (nom, téléphone et lieu de livraison des clients) sont conservées sans limite de durée, les payloads WhatsApp signés 90 jours dans `webhook_logs`, les logs selon la rotation PM2 et les sauvegardes 14 jours. Il revient au client de fixer la durée de conservation des données et d'effectuer la déclaration ou la demande d'autorisation du traitement auprès de l'ARTCI (loi ivoirienne n° 2013-450 relative à la protection des données à caractère personnel).

## Branchement du webhook Meta

1. Dans la console Meta (application WhatsApp), section Configuration du webhook :
   - URL de rappel : `https://api.example.com/api/v1/whatsapp/webhook` ;
   - jeton de vérification : la valeur de `WEBHOOK_VERIFY_TOKEN`.

   Meta appelle alors `GET /api/v1/whatsapp/webhook` ; l'application renvoie le challenge si le jeton correspond (sinon `403`).
2. S'abonner au champ **`messages`**.
3. Reporter dans `.env` l'App Secret (`META_APP_SECRET`, il sert à vérifier la signature `X-Hub-Signature-256` de chaque POST), le jeton d'accès permanent (`WHATSAPP_TOKEN`), `PHONE_NUMBER_ID`, `WABA_ID` et `GRAPH_API_VERSION`, puis redémarrer l'application (`pm2 restart commandes-api`).
4. Enregistrer les vendeurs autorisés (`POST /api/v1/vendors`) : un numéro inconnu ou désactivé ne peut pas passer commande.

**Test local avant déploiement** : exposer le port local en HTTPS avec un tunnel (cloudflared ou ngrok), saisir l'URL du tunnel suivie de `/api/v1/whatsapp/webhook` et le jeton dans la console Meta, puis écrire au numéro de test depuis un numéro destinataire autorisé.
