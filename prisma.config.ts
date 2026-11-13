// Configuration Prisma 7 (CLI : generate, migrate, seed).
// Le .env est chargé explicitement : Prisma 7 ne le lit plus de lui-même.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // `process.env` plutôt que `env()` : `env()` lève une erreur si la variable
  // est absente, ce qui ferait échouer `prisma generate` (postinstall) sur une
  // machine sans .env. Les commandes migrate échouent proprement sans URL.
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
