# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NestJS backend for a WhatsApp ordering platform (Côte d'Ivoire, French-language UI/messages). Vendors send structured order messages to a WhatsApp bot; the backend parses them, asks for confirmation via buttons, stores orders in MySQL, and serves a REST API to a single-admin Vue.js backoffice (order processing, PDF receipts, stats).

**The spec is `DAT – Backend NestJS – Plateforme de commandes WhatsApp.md`** (repo root). Follow it. Work one implementation step at a time (DAT section 9), write and run that step's tests, then stop for validation. Do not add anything out of scope (DAT section 1: no delivery tracking, payments, product catalog, Redis, queues, or WebSockets).

Planning docs: `docs/00-specs.md` (functional specs, open points PO-xx), `docs/01-architecture.md` (binding conventions and decisions; "VALIDÉ PAR LE CLIENT" vs "HYPOTHÈSE À VALIDER"), `docs/02-tasks.md` (task list with status and implementation notes N-xx — update it when finishing a task). Progress is tracked there.

Local dev DB: Laragon MySQL 8 on 127.0.0.1:3306, databases `commandes` (`.env`) and `commandes_test` (`.env.test`, used by e2e; the e2e helper refuses to run unless the DB name ends in `_test`). Under Git Bash, `TZ` isn't passed to Node — rely on `.env` or use PowerShell.

## Commands

Package manager is **pnpm**.

```bash
pnpm install
pnpm run start:dev            # watch mode
pnpm run build                # nest build -> dist/
pnpm run lint                 # oxlint src/ test/
pnpm run format               # prettier (single quotes, trailing commas)
pnpm run test                 # unit tests (vitest, **/*.spec.ts)
pnpm run test:e2e             # e2e tests (vitest, **/*.e2e-spec.ts, config vitest.config.e2e.ts)
pnpm run test:cov

# single test file / single test
pnpm vitest run src/app.controller.spec.ts
pnpm vitest run -t "test name"
pnpm vitest run --config ./vitest.config.e2e.ts test/app.e2e-spec.ts

pnpm prisma:generate          # client generated into src/generated/prisma (gitignored, also runs on postinstall)
pnpm prisma:migrate           # prisma migrate dev
pnpm prisma:migrate:deploy
pnpm prisma db seed           # creates the admin from ADMIN_* env vars; idempotent
```

Import the Prisma client from `src/generated/prisma`, not `@prisma/client`. `PrismaService` extends it with the `@prisma/adapter-mariadb` adapter; the seed script builds its own client because tsx doesn't emit decorator metadata.

## Tooling deviations from the DAT

The DAT was written against an older stack; the actual scaffold differs and the scaffold wins:

- **Vitest, not Jest** (globals enabled, `vite-tsconfig-paths` for aliases). Use `vi.fn()` / `vi.mock()`.
- **NestJS 12, TypeScript 6, ESM** (`"type": "module"`, `module: nodenext`). Relative imports **must** use the `.js` extension (`import { X } from './x.js'`). `main.ts` uses top-level `await`.
- **pnpm** instead of npm; **oxlint** instead of ESLint.

## Target architecture (from the DAT)

Modular monolith, single NestJS process, MySQL 8 via **Prisma**. All routes under `/api/v1`; global JWT guard (admin role) with `@Public()` for `POST /auth/login`, the WhatsApp webhook, and `/health`.

Planned modules under `src/`: `common`, `config` (`@nestjs/config` + Joi; app refuses to start on missing env vars), `prisma`, `auth`, `users`, `vendors`, `orders`, `whatsapp`, `bot`, `receipts` (pdfmake), `stats`. Prisma schema/migrations/seed in `prisma/`.

**Dependency direction is one-way:** `whatsapp` → `bot` → (`orders`, `vendors`). `orders` must know nothing about WhatsApp or the bot.

Key cross-cutting rules that span modules:

- **Webhook** (`POST /whatsapp/webhook`): requires `rawBody: true` in `NestFactory.create`; verify `X-Hub-Signature-256` as HMAC-SHA256 of the raw bytes with `crypto.timingSafeEqual`; log every payload to `webhook_logs`; respond 200 immediately, then process asynchronously in-process. Idempotency via unique insert of `wamid` into `processed_messages`. Exceptions in processing must never reach the webhook response.
- **Bot is stateless**: the only conversational state is an `order_drafts` row (TTL 30 min). Button IDs are `valider|modifier|annuler:<public_id>`. Validating a draft is a single transaction (lock draft, create order + items + first status history row, generate reference, mark draft `confirmed`); a double-click returns the existing reference.
- **`parseOrder(text)`** is a pure function with exhaustive unit tests (label variants, accent/case-insensitive, phone normalization to 10 digits, price formats, limits). Errors are returned all at once, in French.
- **Order reference** `CMD-YYYYMMDD-NNN`, generated inside the creation transaction by incrementing `daily_counters.last_seq` with a row lock.
- **Status transitions** (enforced in `orders`, 409 otherwise): `non_traitee→validee|annulee`, `validee→prete|annulee`, `prete→livree|echec|annulee`, `echec→prete`. Every change writes `order_status_history`.
- **Money** is integer XOF (no decimals); totals are always computed server-side. Dates stored in UTC.
- **API conventions**: camelCase JSON, snake_case DB (Prisma `@map`); pagination `?page&limit` (max 100) → `{ data, meta: { page, limit, total } }`; global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`.
- **Logs**: never log tokens/passwords; mask customer phones in app logs (`07****0707`).
- In tests, always mock `WhatsappClient` (no real Meta calls).
